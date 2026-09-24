import { AuthProvider, Prisma, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../../integrations/email/email.service.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";
import {
  createEmailVerificationToken,
  createPasswordResetToken,
} from "./one-time-token.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import {
  createRefreshSession,
  hashOpaqueToken,
  type RefreshContext,
  rotateRefreshSession,
  signAccessToken,
} from "./token.service.js";

const publicUserSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

async function dispatchVerificationEmail(email: string, token: string): Promise<void> {
  try {
    await sendVerificationEmail(email, token);
  } catch (error) {
    logger.error({ err: error, email }, "Verification email delivery failed");
  }
}

async function issueSession(userId: string, role: UserRole, context: RefreshContext) {
  const refresh = await createRefreshSession(userId, context);
  const accessToken = await signAccessToken({ userId, role, sessionId: refresh.sessionId });
  return {
    accessToken,
    refreshToken: refresh.refreshToken,
    expiresInSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
  };
}

export async function register(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          role: input.role,
          status: UserStatus.PENDING_VERIFICATION,
        },
        select: publicUserSelect,
      });

      await transaction.authAccount.create({
        data: {
          userId: created.id,
          provider: AuthProvider.LOCAL,
          providerAccountId: input.email,
          providerEmail: input.email,
        },
      });

      if (input.role === UserRole.CANDIDATE) {
        await transaction.candidateProfile.create({ data: { userId: created.id } });
      }
      return created;
    });

    const verificationToken = await createEmailVerificationToken(user.id);
    await dispatchVerificationEmail(user.email, verificationToken);
    return { user, verificationToken };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
      );
    }
    throw error;
  }
}

export async function login(input: LoginInput, context: RefreshContext) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true, deletedAt: true },
  });

  if (!user?.passwordHash) {
    await hashPassword(input.password);
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  if (user.deletedAt || user.status === UserStatus.SUSPENDED) {
    throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is unavailable");
  }
  if (!user.emailVerifiedAt || user.status === UserStatus.PENDING_VERIFICATION) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const tokens = await issueSession(user.id, user.role, context);
  const { passwordHash: _passwordHash, deletedAt: _deletedAt, ...safeUser } = user;
  return { user: safeUser, tokens };
}

export async function refresh(refreshToken: string, context: RefreshContext) {
  const rotated = await rotateRefreshSession(refreshToken, context);
  const accessToken = await signAccessToken({
    userId: rotated.userId,
    role: rotated.role,
    sessionId: rotated.sessionId,
  });
  return {
    accessToken,
    refreshToken: rotated.refreshToken,
    expiresInSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
  };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await prisma.refreshSession.updateMany({
    where: { tokenHash: hashOpaqueToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashOpaqueToken(token);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, deletedAt: true } } },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date() || record.user.deletedAt) {
    throw new AppError(
      400,
      "INVALID_VERIFICATION_TOKEN",
      "The verification token is invalid or expired",
    );
  }

  await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new AppError(
        400,
        "INVALID_VERIFICATION_TOKEN",
        "The verification token was already used",
      );
    }
    await transaction.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
    });
  });
}

export async function resendVerification(email: string): Promise<string | undefined> {
  const user = await prisma.user.findFirst({
    where: { email, emailVerifiedAt: null, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return undefined;
  const token = await createEmailVerificationToken(user.id);
  await dispatchVerificationEmail(user.email, token);
  return token;
}

export async function forgotPassword(email: string): Promise<string | undefined> {
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return undefined;
  const token = await createPasswordResetToken(user.id);
  try {
    await sendPasswordResetEmail(user.email, token);
  } catch (error) {
    logger.error({ err: error, email }, "Password reset email delivery failed");
  }
  return token;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashOpaqueToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw new AppError(
      400,
      "INVALID_RESET_TOKEN",
      "The password reset token is invalid or expired",
    );
  }
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new AppError(400, "INVALID_RESET_TOKEN", "The password reset token was already used");
    }
    await transaction.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await transaction.refreshSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      ...publicUserSelect,
      candidateProfile: true,
      companyMemberships: {
        where: { status: "ACTIVE" },
        select: { role: true, company: { select: { id: true, name: true, slug: true } } },
      },
    },
  });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

export { issueSession };

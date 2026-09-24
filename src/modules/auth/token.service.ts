import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type UserRole, UserStatus } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

const jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const issuer = "devassess-api";
const audience = "devassess-clients";

export type AccessTokenPayload = {
  userId: string;
  role: UserRole;
  sessionId: string;
};

export type RefreshContext = {
  ipAddress?: string;
  userAgent?: string;
};

export function createOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, sid: payload.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_MINUTES}m`)
    .sign(jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret, { issuer, audience });
    if (!payload.sub || typeof payload.role !== "string" || typeof payload.sid !== "string") {
      throw new Error("Required claims are missing");
    }
    return {
      userId: payload.sub,
      role: payload.role as UserRole,
      sessionId: payload.sid,
    };
  } catch {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired");
  }
}

export async function createRefreshSession(
  userId: string,
  context: RefreshContext,
  familyId = randomUUID(),
): Promise<{ refreshToken: string; sessionId: string }> {
  const refreshToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const session = await prisma.refreshSession.create({
    data: {
      userId,
      familyId,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
    select: { id: true },
  });
  return { refreshToken, sessionId: session.id };
}

export async function rotateRefreshSession(
  refreshToken: string,
  context: RefreshContext,
): Promise<{ refreshToken: string; sessionId: string; userId: string; role: UserRole }> {
  const tokenHash = hashOpaqueToken(refreshToken);
  const existing = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true, status: true, deletedAt: true } } },
  });

  if (!existing) throw new AppError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid");

  if (existing.revokedAt) {
    await prisma.refreshSession.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, "REFRESH_TOKEN_REUSED", "Refresh-token reuse was detected");
  }

  if (existing.expiresAt <= new Date()) {
    await prisma.refreshSession.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, "REFRESH_TOKEN_EXPIRED", "The refresh token has expired");
  }

  if (existing.user.status !== UserStatus.ACTIVE || existing.user.deletedAt) {
    throw new AppError(401, "ACCOUNT_UNAVAILABLE", "The account is not active");
  }

  const newRefreshToken = createOpaqueToken();
  try {
    const newSession = await prisma.$transaction(
      async (transaction) => {
        const claimed = await transaction.refreshSession.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), lastUsedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("REFRESH_REPLAY");

        const created = await transaction.refreshSession.create({
          data: {
            userId: existing.userId,
            familyId: existing.familyId,
            tokenHash: hashOpaqueToken(newRefreshToken),
            expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
          select: { id: true },
        });
        await transaction.refreshSession.update({
          where: { id: existing.id },
          data: { replacedById: created.id },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      refreshToken: newRefreshToken,
      sessionId: newSession.id,
      userId: existing.user.id,
      role: existing.user.role,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "REFRESH_REPLAY") {
      await prisma.refreshSession.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError(401, "REFRESH_TOKEN_REUSED", "Refresh-token reuse was detected");
    }
    throw error;
  }
}

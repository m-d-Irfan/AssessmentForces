import { prisma } from "../../config/database.js";
import { createOpaqueToken, hashOpaqueToken } from "./token.service.js";

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = createOpaqueToken(32);
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    }),
  ]);
  return token;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = createOpaqueToken(32);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    }),
  ]);
  return token;
}

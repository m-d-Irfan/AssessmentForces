import { UserStatus } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database.js";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { AppError } from "../shared/errors/app-error.js";

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "A Bearer access token is required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const payload = await verifyAccessToken(token);
  const user = await prisma.user.findFirst({
    where: { id: payload.userId, status: UserStatus.ACTIVE, deletedAt: null },
    select: { id: true, role: true },
  });

  if (!user) throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is no longer valid");

  request.auth = { userId: user.id, role: user.role, sessionId: payload.sessionId };
  next();
}

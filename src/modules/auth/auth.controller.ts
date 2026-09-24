import type { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import {
  completeGoogleLogin,
  createGoogleAuthorizationUrl,
} from "../../integrations/google/google-oauth.service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  forgotPassword,
  getCurrentUser,
  login,
  logout,
  logoutAll,
  refresh,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth.service.js";
import type { RefreshContext } from "./token.service.js";

function requestContext(request: Request): RefreshContext {
  const userAgent = request.header("user-agent");
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function setRefreshCookie(response: Response, refreshToken: string): void {
  response.cookie(env.REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    path: `${env.API_PREFIX}/auth`,
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: `${env.API_PREFIX}/auth`,
  });
}

function readRefreshToken(request: Request): string | undefined {
  return request.cookies?.[env.REFRESH_COOKIE_NAME] ?? request.body?.refreshToken;
}

export async function registerHandler(request: Request, response: Response): Promise<Response> {
  const result = await register(request.body);
  return sendSuccess(response, {
    statusCode: 201,
    message: "Registration successful. Verify your email before signing in.",
    data: {
      user: result.user,
      ...(env.NODE_ENV !== "production"
        ? { developmentVerificationToken: result.verificationToken }
        : {}),
    },
  });
}

export async function loginHandler(request: Request, response: Response): Promise<Response> {
  const result = await login(request.body, requestContext(request));
  setRefreshCookie(response, result.tokens.refreshToken);
  return sendSuccess(response, {
    message: "Login successful",
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresInSeconds: result.tokens.expiresInSeconds,
    },
  });
}

export async function refreshHandler(request: Request, response: Response): Promise<Response> {
  const currentToken = readRefreshToken(request);
  if (!currentToken)
    throw new AppError(401, "REFRESH_TOKEN_REQUIRED", "A refresh token is required");
  const tokens = await refresh(currentToken, requestContext(request));
  setRefreshCookie(response, tokens.refreshToken);
  return sendSuccess(response, {
    message: "Access token refreshed",
    data: { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds },
  });
}

export async function logoutHandler(request: Request, response: Response): Promise<Response> {
  await logout(readRefreshToken(request));
  clearRefreshCookie(response);
  return sendSuccess(response, { message: "Logout successful", data: null });
}

export async function logoutAllHandler(request: Request, response: Response): Promise<Response> {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  await logoutAll(request.auth.userId);
  clearRefreshCookie(response);
  return sendSuccess(response, { message: "All sessions have been revoked", data: null });
}

export async function verifyEmailHandler(request: Request, response: Response): Promise<Response> {
  await verifyEmail(request.body.token);
  return sendSuccess(response, { message: "Email verified successfully", data: null });
}

export async function resendVerificationHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const token = await resendVerification(request.body.email);
  return sendSuccess(response, {
    message: "If the account requires verification, a new token has been sent.",
    data: env.NODE_ENV !== "production" && token ? { developmentVerificationToken: token } : null,
  });
}

export async function forgotPasswordHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const token = await forgotPassword(request.body.email);
  return sendSuccess(response, {
    message: "If the account exists, password reset instructions have been sent.",
    data: env.NODE_ENV !== "production" && token ? { developmentResetToken: token } : null,
  });
}

export async function resetPasswordHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  await resetPassword(request.body.token, request.body.password);
  clearRefreshCookie(response);
  return sendSuccess(response, { message: "Password reset successfully", data: null });
}

export async function googleStartHandler(request: Request, response: Response): Promise<void> {
  const authorizationUrl = await createGoogleAuthorizationUrl(
    request.query.role as Extract<UserRole, "CANDIDATE" | "RECRUITER">,
  );
  response.redirect(302, authorizationUrl);
}

export async function googleCallbackHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const result = await completeGoogleLogin(
    request.query.code as string,
    request.query.state as string,
    requestContext(request),
  );
  setRefreshCookie(response, result.tokens.refreshToken);
  return sendSuccess(response, {
    message: "Google login successful",
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresInSeconds: result.tokens.expiresInSeconds,
    },
  });
}

export async function meHandler(request: Request, response: Response): Promise<Response> {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const user = await getCurrentUser(request.auth.userId);
  return sendSuccess(response, { message: "Current user retrieved", data: user });
}

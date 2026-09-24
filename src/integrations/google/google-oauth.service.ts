import { createHash } from "node:crypto";
import { AuthProvider, UserRole, UserStatus } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { ensureRedisConnection, redis } from "../../config/redis.js";
import { issueSession } from "../../modules/auth/auth.service.js";
import { createOpaqueToken, type RefreshContext } from "../../modules/auth/token.service.js";
import { AppError } from "../../shared/errors/app-error.js";

type GoogleRole = Extract<UserRole, "CANDIDATE" | "RECRUITER">;

type OAuthState = {
  role: GoogleRole;
  nonce: string;
  codeVerifier: string;
};

function requireGoogleConfiguration(): { clientId: string; clientSecret: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(503, "GOOGLE_OAUTH_NOT_CONFIGURED", "Google login is not configured");
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

function oauthStateKey(state: string): string {
  return `${env.NODE_ENV}:oauth:google:${state}`;
}

export async function createGoogleAuthorizationUrl(role: GoogleRole): Promise<string> {
  const { clientId } = requireGoogleConfiguration();
  const state = createOpaqueToken(32);
  const nonce = createOpaqueToken(32);
  const codeVerifier = createOpaqueToken(64);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  await ensureRedisConnection();
  await redis.set(
    oauthStateKey(state),
    JSON.stringify({ role, nonce, codeVerifier } satisfies OAuthState),
    { ex: env.GOOGLE_OAUTH_STATE_TTL_SECONDS, nx: true },
  );

  const parameters = new URLSearchParams({
    client_id: clientId,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`;
}

async function consumeOAuthState(state: string): Promise<OAuthState> {
  await ensureRedisConnection();
  const raw = await redis.getdel<string>(oauthStateKey(state));
  if (!raw) throw new AppError(400, "INVALID_OAUTH_STATE", "OAuth state is invalid or expired");

  try {
    return JSON.parse(raw) as OAuthState;
  } catch {
    throw new AppError(400, "INVALID_OAUTH_STATE", "OAuth state is invalid");
  }
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  const { clientId, clientSecret } = requireGoogleConfiguration();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.id_token) {
    throw new AppError(
      401,
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      body.error_description ?? body.error ?? "Google authorization failed",
    );
  }
  return body.id_token;
}

export async function completeGoogleLogin(code: string, state: string, context: RefreshContext) {
  const storedState = await consumeOAuthState(state);
  const idToken = await exchangeAuthorizationCode(code, storedState.codeVerifier);
  const { clientId } = requireGoogleConfiguration();
  const googleClient = new OAuth2Client(clientId);
  const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  if (
    !payload?.sub ||
    !payload.email ||
    !payload.email_verified ||
    payload.nonce !== storedState.nonce
  ) {
    throw new AppError(401, "INVALID_GOOGLE_IDENTITY", "Google identity verification failed");
  }

  const email = payload.email.trim().toLowerCase();
  const user = await prisma.$transaction(async (transaction) => {
    const account = await transaction.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthProvider.GOOGLE,
          providerAccountId: payload.sub,
        },
      },
      include: { user: true },
    });
    if (account) return account.user;

    let linkedUser = await transaction.user.findUnique({ where: { email } });
    if (!linkedUser) {
      linkedUser = await transaction.user.create({
        data: {
          email,
          displayName: payload.name ?? email.split("@")[0] ?? "Google User",
          avatarUrl: payload.picture ?? null,
          role: storedState.role,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          ...(storedState.role === UserRole.CANDIDATE ? { candidateProfile: { create: {} } } : {}),
        },
      });
    } else if (!linkedUser.emailVerifiedAt) {
      linkedUser = await transaction.user.update({
        where: { id: linkedUser.id },
        data: { emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      });
    }

    await transaction.authAccount.create({
      data: {
        userId: linkedUser.id,
        provider: AuthProvider.GOOGLE,
        providerAccountId: payload.sub,
        providerEmail: email,
      },
    });
    return linkedUser;
  });

  if (user.deletedAt || user.status === UserStatus.SUSPENDED) {
    throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is unavailable");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const tokens = await issueSession(user.id, user.role, context);
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    tokens,
  };
}

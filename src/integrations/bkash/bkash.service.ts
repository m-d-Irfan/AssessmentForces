import { env } from "../../config/env.js";
import { ensureRedisConnection, redis } from "../../config/redis.js";
import { AppError } from "../../shared/errors/app-error.js";

type BkashPayload = Record<string, unknown>;

export type BkashPaymentResult = BkashPayload & {
  paymentID?: string;
  bkashURL?: string;
  transactionStatus?: string;
  trxID?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  statusCode?: string;
  statusMessage?: string;
};

const tokenKey = `${env.NODE_ENV}:bkash:id-token`;

function credentials() {
  if (!env.BKASH_APP_KEY || !env.BKASH_APP_SECRET || !env.BKASH_USERNAME || !env.BKASH_PASSWORD) {
    throw new AppError(503, "BKASH_NOT_CONFIGURED", "bKash sandbox credentials are not configured");
  }
  return {
    appKey: env.BKASH_APP_KEY,
    appSecret: env.BKASH_APP_SECRET,
    username: env.BKASH_USERNAME,
    password: env.BKASH_PASSWORD,
  };
}

async function request(
  path: string,
  body: BkashPayload,
  headers: Record<string, string>,
): Promise<BkashPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BKASH_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.BKASH_BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as BkashPayload;
    if (!response.ok) {
      throw new AppError(502, "BKASH_REQUEST_FAILED", "bKash rejected the request", payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "BKASH_UNAVAILABLE", "Could not communicate with bKash");
  } finally {
    clearTimeout(timeout);
  }
}

async function grantToken(): Promise<string> {
  const config = credentials();
  const payload = await request(
    "/token/grant",
    { app_key: config.appKey, app_secret: config.appSecret },
    { username: config.username, password: config.password },
  );
  const token = typeof payload.id_token === "string" ? payload.id_token : undefined;
  if (!token) throw new AppError(502, "BKASH_TOKEN_FAILED", "bKash did not return an access token");

  await ensureRedisConnection();
  const expiresIn = Number(payload.expires_in ?? 3600);
  await redis.set(tokenKey, token, "EX", Math.max(60, Math.min(expiresIn - 60, 3540)));
  return token;
}

async function accessToken(): Promise<string> {
  credentials();
  await ensureRedisConnection();
  return (await redis.get(tokenKey)) ?? grantToken();
}

async function authenticatedRequest(path: string, body: BkashPayload): Promise<BkashPaymentResult> {
  const config = credentials();
  const token = await accessToken();
  return (await request(path, body, {
    authorization: token,
    "x-app-key": config.appKey,
  })) as BkashPaymentResult;
}

export function createBkashPayment(input: {
  amount: string;
  invoice: string;
  payerReference: string;
}): Promise<BkashPaymentResult> {
  return authenticatedRequest("/create", {
    mode: "0011",
    payerReference: input.payerReference,
    callbackURL: env.BKASH_CALLBACK_URL,
    amount: input.amount,
    currency: "BDT",
    intent: "sale",
    merchantInvoiceNumber: input.invoice,
  });
}

export function executeBkashPayment(paymentID: string): Promise<BkashPaymentResult> {
  return authenticatedRequest("/execute", { paymentID });
}

export function queryBkashPayment(paymentID: string): Promise<BkashPaymentResult> {
  return authenticatedRequest("/payment/status", { paymentID });
}

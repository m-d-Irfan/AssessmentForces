import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";

function storeOptions(prefix: string) {
  return env.NODE_ENV === "test"
    ? {}
    : {
        store: new RedisStore({
          prefix: `${env.NODE_ENV}:rate-limit:${prefix}:`,
          sendCommand: (command: string, ...args: string[]) =>
            redis.exec([command, ...args]) as Promise<
              string | number | boolean | Array<string | number | boolean>
            >,
        }),
      };
}

const handler = (_request: unknown, response: import("express").Response) => {
  response.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
    requestId: response.locals.requestId,
  });
};

export const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ...storeOptions("global"),
  skip: (request) => request.path === "/health" || request.path === "/ready",
  handler,
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ...storeOptions("auth"),
  handler,
});

export const paymentRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  limit: env.PAYMENT_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ...storeOptions("payment"),
  handler,
});

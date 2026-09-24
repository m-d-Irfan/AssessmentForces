import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";

const storeOptions =
  env.NODE_ENV === "test"
    ? {}
    : {
        store: new RedisStore({
          prefix: `${env.NODE_ENV}:rate-limit:global:`,
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<
              string | number | boolean | Array<string | number | boolean>
            >,
        }),
      };

export const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  ...storeOptions,
  skip: (request) => request.path === "/health" || request.path === "/ready",
  handler: (_request, response) => {
    response.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      errors: [],
      requestId: response.locals.requestId,
    });
  },
});

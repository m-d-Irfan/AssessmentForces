import { Redis } from "@upstash/redis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
  enableTelemetry: false,
  signal: () => AbortSignal.timeout(5_000),
});

export async function ensureRedisConnection(): Promise<void> {
  // Upstash REST is connectionless; this keeps callers independent of the transport.
}

export async function checkRedisConnection(): Promise<void> {
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  logger.info("Upstash Redis REST client stopped");
}

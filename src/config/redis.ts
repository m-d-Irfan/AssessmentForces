import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 100, 2_000),
});

redis.on("error", (error) => logger.warn({ err: error }, "Redis connection error"));

export async function ensureRedisConnection(): Promise<void> {
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
}

export async function checkRedisConnection(): Promise<void> {
  await ensureRedisConnection();
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== "end") {
    await redis.quit();
    logger.info("Redis connection closed");
  }
}

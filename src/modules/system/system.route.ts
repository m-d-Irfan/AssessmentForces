import { Router } from "express";
import { checkDatabaseConnection } from "../../config/database.js";
import { checkRedisConnection } from "../../config/redis.js";
import { maintenanceJobStatus } from "../../jobs/maintenance.job.js";
import { sendSuccess } from "../../shared/responses/api-response.js";

export const systemRouter = Router();

systemRouter.get("/health", (_request, response) =>
  sendSuccess(response, {
    message: "API is healthy",
    data: {
      status: "up",
      uptimeSeconds: Math.floor(process.uptime()),
      maintenanceJobs: maintenanceJobStatus(),
    },
  }),
);

systemRouter.get("/ready", async (_request, response) => {
  const checks = await Promise.allSettled([checkDatabaseConnection(), checkRedisConnection()]);
  const databaseReady = checks[0]?.status === "fulfilled";
  const redisReady = checks[1]?.status === "fulfilled";
  const ready = databaseReady && redisReady;

  return response.status(ready ? 200 : 503).json({
    success: ready,
    message: ready ? "API dependencies are ready" : "API dependencies are unavailable",
    data: {
      status: ready ? "ready" : "not_ready",
      dependencies: {
        postgresql: databaseReady ? "up" : "down",
        redis: redisReady ? "up" : "down",
      },
    },
  });
});

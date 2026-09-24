import { createServer } from "node:http";
import { createApp } from "./app.js";
import { disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectRedis } from "./config/redis.js";
import { startMaintenanceJobs, stopMaintenanceJobs } from "./jobs/maintenance.job.js";

const server = createServer(createApp());
server.requestTimeout = env.REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
let shuttingDown = false;

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, `${env.APP_NAME} is running`);
  startMaintenanceJobs();
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMaintenanceJobs();
  logger.info({ signal }, "Graceful shutdown started");

  server.close(async (closeError) => {
    if (closeError) logger.error({ err: closeError }, "HTTP server failed to close cleanly");
    await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    process.exit(closeError ? 1 : 0);
  });

  setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) =>
  logger.error({ err: reason }, "Unhandled promise rejection"),
);
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException");
});

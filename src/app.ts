import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { openApiDocument } from "./config/swagger.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFound } from "./middlewares/not-found.js";
import { globalRateLimit } from "./middlewares/rate-limit.js";
import { requestId } from "./middlewares/request-id.js";
import { adminRouter } from "./modules/admin/admin.route.js";
import { analyticsRouter } from "./modules/analytics/analytics.route.js";
import { assessmentRouter } from "./modules/assessments/assessment.route.js";
import { attemptRouter } from "./modules/attempts/attempt.route.js";
import { authRouter } from "./modules/auth/auth.route.js";
import { evaluationRouter } from "./modules/evaluations/evaluation.route.js";
import { invitationRouter } from "./modules/invitations/invitation.route.js";
import { notificationRouter } from "./modules/notifications/notification.route.js";
import { paymentRouter } from "./modules/payments/payment.route.js";
import { problemRouter } from "./modules/problems/problem.route.js";
import { recruitmentRouter } from "./modules/recruitment/recruitment.route.js";
import { resultRouter } from "./modules/results/result.route.js";
import { systemRouter } from "./modules/system/system.route.js";
import { AppError } from "./shared/errors/app-error.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      customProps: (_request, response) => ({ requestId: response.locals.requestId }),
      serializers: {
        req(request) {
          const rawUrl = typeof request.url === "string" ? request.url : "";
          const sanitizedUrl = rawUrl
            .replace(/(\/invitations\/)[^/?]+/gi, "$1[REDACTED]")
            .replace(/([?&](?:code|token|state)=)[^&]+/gi, "$1[REDACTED]");
          return { method: request.method, url: sanitizedUrl };
        },
      },
    }),
  );
  app.use(
    helmet({
      referrerPolicy: { policy: "no-referrer" },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use((_request, response, next) => {
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed"));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());
  app.use(globalRateLimit);

  app.use(systemRouter);
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.get("/api-docs.json", (_request, response) => response.json(openApiDocument));

  const apiRouter = express.Router();
  apiRouter.use("/admin", adminRouter);
  apiRouter.use("/analytics", analyticsRouter);
  apiRouter.use("/auth", authRouter);
  apiRouter.use("/evaluations", evaluationRouter);
  apiRouter.use("/invitations", invitationRouter);
  apiRouter.use("/notifications", notificationRouter);
  apiRouter.use("/problems", problemRouter);
  apiRouter.use("/results", resultRouter);
  apiRouter.use("/recruitment-programs", recruitmentRouter);
  apiRouter.use("/assessments", assessmentRouter);
  apiRouter.use("/attempts", attemptRouter);
  apiRouter.use(paymentRouter);
  apiRouter.get("/", (_request, response) =>
    response.json({
      success: true,
      message: "Developer Assessment Platform API",
      data: { version: "v1", documentation: "/api-docs/" },
    }),
  );
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

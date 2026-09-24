import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  adminDashboardHandler,
  assessmentAnalyticsHandler,
  candidateDashboardHandler,
  companyDashboardHandler,
} from "./analytics.controller.js";
import {
  assessmentAnalyticsParamsSchema,
  companyAnalyticsQuerySchema,
} from "./analytics.validation.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

analyticsRouter.get(
  "/company",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: companyAnalyticsQuerySchema }),
  companyDashboardHandler,
);
analyticsRouter.get(
  "/assessments/:assessmentId",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: assessmentAnalyticsParamsSchema }),
  assessmentAnalyticsHandler,
);
analyticsRouter.get("/candidate", authorize(UserRole.CANDIDATE), candidateDashboardHandler);
analyticsRouter.get("/admin", authorize(UserRole.ADMIN), adminDashboardHandler);

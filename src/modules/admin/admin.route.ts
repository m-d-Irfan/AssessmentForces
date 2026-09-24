import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  adjustCompanyCreditsHandler,
  createCreditPackageHandler,
  deleteCreditPackageHandler,
  getCompanyHandler,
  getUserHandler,
  listAuditLogsHandler,
  listCompaniesHandler,
  listCreditPackagesHandler,
  listUsersHandler,
  updateCompanyStatusHandler,
  updateCreditPackageHandler,
  updateUserStatusHandler,
  verifyCompanyHandler,
} from "./admin.controller.js";
import {
  adjustCreditsBodySchema,
  auditLogListQuerySchema,
  companyListQuerySchema,
  createCreditPackageBodySchema,
  resourceIdParamsSchema,
  updateCompanyStatusBodySchema,
  updateCreditPackageBodySchema,
  updateUserStatusBodySchema,
  userListQuerySchema,
  verifyCompanyBodySchema,
} from "./admin.validation.js";

export const adminRouter = Router();
adminRouter.use(authenticate, authorize(UserRole.ADMIN));

adminRouter.get("/users", validate({ query: userListQuerySchema }), listUsersHandler);
adminRouter.get("/users/:id", validate({ params: resourceIdParamsSchema }), getUserHandler);
adminRouter.patch(
  "/users/:id/status",
  validate({ params: resourceIdParamsSchema, body: updateUserStatusBodySchema }),
  updateUserStatusHandler,
);
adminRouter.get("/companies", validate({ query: companyListQuerySchema }), listCompaniesHandler);
adminRouter.get("/companies/:id", validate({ params: resourceIdParamsSchema }), getCompanyHandler);
adminRouter.patch(
  "/companies/:id/status",
  validate({ params: resourceIdParamsSchema, body: updateCompanyStatusBodySchema }),
  updateCompanyStatusHandler,
);
adminRouter.patch(
  "/companies/:id/verification",
  validate({ params: resourceIdParamsSchema, body: verifyCompanyBodySchema }),
  verifyCompanyHandler,
);
adminRouter.post(
  "/companies/:id/credits/adjust",
  validate({ params: resourceIdParamsSchema, body: adjustCreditsBodySchema }),
  adjustCompanyCreditsHandler,
);
adminRouter.get("/credit-packages", listCreditPackagesHandler);
adminRouter.post(
  "/credit-packages",
  validate({ body: createCreditPackageBodySchema }),
  createCreditPackageHandler,
);
adminRouter.patch(
  "/credit-packages/:id",
  validate({ params: resourceIdParamsSchema, body: updateCreditPackageBodySchema }),
  updateCreditPackageHandler,
);
adminRouter.delete(
  "/credit-packages/:id",
  validate({ params: resourceIdParamsSchema }),
  deleteCreditPackageHandler,
);
adminRouter.get("/audit-logs", validate({ query: auditLogListQuerySchema }), listAuditLogsHandler);

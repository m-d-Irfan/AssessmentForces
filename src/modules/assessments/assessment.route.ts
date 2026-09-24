import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  addAssessmentItemHandler,
  archiveAssessmentHandler,
  createAssessmentHandler,
  deleteAssessmentHandler,
  deleteAssessmentItemHandler,
  getAssessmentHandler,
  listAssessmentsHandler,
  publishAssessmentHandler,
  updateAssessmentHandler,
  updateAssessmentItemHandler,
} from "./assessment.controller.js";
import {
  addAssessmentItemBodySchema,
  assessmentIdParamsSchema,
  assessmentItemParamsSchema,
  assessmentListQuerySchema,
  createAssessmentBodySchema,
  updateAssessmentBodySchema,
  updateAssessmentItemBodySchema,
} from "./assessment.validation.js";

export const assessmentRouter = Router();
assessmentRouter.use(authenticate, authorize(UserRole.RECRUITER, UserRole.ADMIN));

assessmentRouter.post("/", validate({ body: createAssessmentBodySchema }), createAssessmentHandler);
assessmentRouter.get("/", validate({ query: assessmentListQuerySchema }), listAssessmentsHandler);
assessmentRouter.get("/:id", validate({ params: assessmentIdParamsSchema }), getAssessmentHandler);
assessmentRouter.patch(
  "/:id",
  validate({ params: assessmentIdParamsSchema, body: updateAssessmentBodySchema }),
  updateAssessmentHandler,
);
assessmentRouter.delete(
  "/:id",
  validate({ params: assessmentIdParamsSchema }),
  deleteAssessmentHandler,
);
assessmentRouter.post(
  "/:id/items",
  validate({ params: assessmentIdParamsSchema, body: addAssessmentItemBodySchema }),
  addAssessmentItemHandler,
);
assessmentRouter.patch(
  "/:id/items/:itemId",
  validate({ params: assessmentItemParamsSchema, body: updateAssessmentItemBodySchema }),
  updateAssessmentItemHandler,
);
assessmentRouter.delete(
  "/:id/items/:itemId",
  validate({ params: assessmentItemParamsSchema }),
  deleteAssessmentItemHandler,
);
assessmentRouter.post(
  "/:id/publish",
  validate({ params: assessmentIdParamsSchema }),
  publishAssessmentHandler,
);
assessmentRouter.post(
  "/:id/archive",
  validate({ params: assessmentIdParamsSchema }),
  archiveAssessmentHandler,
);

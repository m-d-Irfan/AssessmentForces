import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  finalizeEvaluationHandler,
  getEvaluationHandler,
  gradeAnswerHandler,
  listEvaluationsHandler,
  runAutomaticGradingHandler,
} from "./evaluation.controller.js";
import {
  evaluationIdParamsSchema,
  evaluationListQuerySchema,
  finalizeEvaluationBodySchema,
  gradeAnswerBodySchema,
  gradeAnswerParamsSchema,
} from "./evaluation.validation.js";

export const evaluationRouter = Router();
evaluationRouter.use(authenticate, authorize(UserRole.RECRUITER, UserRole.ADMIN));

evaluationRouter.get("/", validate({ query: evaluationListQuerySchema }), listEvaluationsHandler);
evaluationRouter.get("/:id", validate({ params: evaluationIdParamsSchema }), getEvaluationHandler);
evaluationRouter.post(
  "/:id/auto-grade",
  validate({ params: evaluationIdParamsSchema }),
  runAutomaticGradingHandler,
);
evaluationRouter.patch(
  "/:id/answers/:answerId",
  validate({ params: gradeAnswerParamsSchema, body: gradeAnswerBodySchema }),
  gradeAnswerHandler,
);
evaluationRouter.post(
  "/:id/finalize",
  validate({ params: evaluationIdParamsSchema, body: finalizeEvaluationBodySchema }),
  finalizeEvaluationHandler,
);

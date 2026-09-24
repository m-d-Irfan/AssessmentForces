import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  getMyResultHandler,
  getResultHandler,
  listMyResultsHandler,
  listResultsHandler,
  releaseResultHandler,
  updateResultSummaryHandler,
} from "./result.controller.js";
import {
  candidateResultListQuerySchema,
  resultIdParamsSchema,
  resultListQuerySchema,
  updateResultBodySchema,
} from "./result.validation.js";

export const resultRouter = Router();
resultRouter.use(authenticate);

resultRouter.get(
  "/mine",
  authorize(UserRole.CANDIDATE),
  validate({ query: candidateResultListQuerySchema }),
  listMyResultsHandler,
);
resultRouter.get(
  "/mine/:id",
  authorize(UserRole.CANDIDATE),
  validate({ params: resultIdParamsSchema }),
  getMyResultHandler,
);
resultRouter.get(
  "/",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: resultListQuerySchema }),
  listResultsHandler,
);
resultRouter.get(
  "/:id",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: resultIdParamsSchema }),
  getResultHandler,
);
resultRouter.patch(
  "/:id",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: resultIdParamsSchema, body: updateResultBodySchema }),
  updateResultSummaryHandler,
);
resultRouter.post(
  "/:id/release",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: resultIdParamsSchema }),
  releaseResultHandler,
);

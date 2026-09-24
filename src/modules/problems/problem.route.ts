import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  createProblemHandler,
  createProblemVersionHandler,
  deleteProblemHandler,
  getProblemHandler,
  listProblemsHandler,
  updateProblemHandler,
} from "./problem.controller.js";
import {
  createProblemBodySchema,
  problemIdParamsSchema,
  problemListQuerySchema,
  problemVersionBodySchema,
  updateProblemBodySchema,
} from "./problem.validation.js";

export const problemRouter = Router();
problemRouter.use(authenticate, authorize(UserRole.RECRUITER, UserRole.ADMIN));

problemRouter.post("/", validate({ body: createProblemBodySchema }), createProblemHandler);
problemRouter.get("/", validate({ query: problemListQuerySchema }), listProblemsHandler);
problemRouter.get("/:id", validate({ params: problemIdParamsSchema }), getProblemHandler);
problemRouter.patch(
  "/:id",
  validate({ params: problemIdParamsSchema, body: updateProblemBodySchema }),
  updateProblemHandler,
);
problemRouter.delete("/:id", validate({ params: problemIdParamsSchema }), deleteProblemHandler);
problemRouter.post(
  "/:id/versions",
  validate({ params: problemIdParamsSchema, body: problemVersionBodySchema }),
  createProblemVersionHandler,
);

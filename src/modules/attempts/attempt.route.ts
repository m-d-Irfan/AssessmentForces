import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  getAttemptHandler,
  saveAnswerHandler,
  startAttemptHandler,
  submitAttemptHandler,
  tabChangeHandler,
} from "./attempt.controller.js";
import {
  answerParamsSchema,
  attemptIdParamsSchema,
  saveAnswerBodySchema,
  startAttemptBodySchema,
} from "./attempt.validation.js";

export const attemptRouter = Router();
attemptRouter.use(authenticate, authorize(UserRole.CANDIDATE));

attemptRouter.post("/start", validate({ body: startAttemptBodySchema }), startAttemptHandler);
attemptRouter.get("/:id", validate({ params: attemptIdParamsSchema }), getAttemptHandler);
attemptRouter.put(
  "/:id/answers/:itemId",
  validate({ params: answerParamsSchema, body: saveAnswerBodySchema }),
  saveAnswerHandler,
);
attemptRouter.post(
  "/:id/submit",
  validate({ params: attemptIdParamsSchema }),
  submitAttemptHandler,
);
attemptRouter.post(
  "/:id/tab-change",
  validate({ params: attemptIdParamsSchema }),
  tabChangeHandler,
);

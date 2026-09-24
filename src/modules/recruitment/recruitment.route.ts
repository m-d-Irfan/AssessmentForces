import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  acceptProgramInvitationHandler,
  createProgramHandler,
  createStageHandler,
  finalizeCandidateStageHandler,
  getProgramApplicationHandler,
  getProgramHandler,
  getProgramInvitationPreviewHandler,
  getStageTaskHandler,
  inviteToProgramHandler,
  listMyApplicationsHandler,
  listMyStageTasksHandler,
  listProgramApplicationsHandler,
  listProgramsHandler,
  reorderStagesHandler,
  scheduleInterviewHandler,
  startProgramHandler,
  submitStageReviewHandler,
  updateProgramHandler,
  updateStageAssigneesHandler,
} from "./recruitment.controller.js";
import {
  applicationParamsSchema,
  createProgramBodySchema,
  createStageBodySchema,
  finalizeStageBodySchema,
  invitationTokenParamsSchema,
  inviteToProgramBodySchema,
  programIdParamsSchema,
  programListQuerySchema,
  progressIdParamsSchema,
  reorderStagesBodySchema,
  scheduleInterviewBodySchema,
  stageAssigneesBodySchema,
  stageIdParamsSchema,
  submitReviewBodySchema,
  updateProgramBodySchema,
} from "./recruitment.validation.js";

export const recruitmentRouter = Router();
recruitmentRouter.use(authenticate);

recruitmentRouter.post(
  "/invitations/:token/accept",
  validate({ params: invitationTokenParamsSchema }),
  acceptProgramInvitationHandler,
);
recruitmentRouter.get(
  "/invitations/:token",
  validate({ params: invitationTokenParamsSchema }),
  getProgramInvitationPreviewHandler,
);
recruitmentRouter.get("/my-applications", authorize(UserRole.CANDIDATE), listMyApplicationsHandler);
recruitmentRouter.get(
  "/:id/applications",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema }),
  listProgramApplicationsHandler,
);
recruitmentRouter.get(
  "/:id/applications/:applicationId",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: applicationParamsSchema }),
  getProgramApplicationHandler,
);
recruitmentRouter.get(
  "/tasks/mine",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  listMyStageTasksHandler,
);
recruitmentRouter.get(
  "/tasks/:progressId",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: progressIdParamsSchema }),
  getStageTaskHandler,
);
recruitmentRouter.post(
  "/tasks/:progressId/reviews",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: progressIdParamsSchema, body: submitReviewBodySchema }),
  submitStageReviewHandler,
);
recruitmentRouter.post(
  "/tasks/:progressId/schedule",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: progressIdParamsSchema, body: scheduleInterviewBodySchema }),
  scheduleInterviewHandler,
);
recruitmentRouter.post(
  "/tasks/:progressId/finalize",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: progressIdParamsSchema, body: finalizeStageBodySchema }),
  finalizeCandidateStageHandler,
);
recruitmentRouter.post(
  "/",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ body: createProgramBodySchema }),
  createProgramHandler,
);
recruitmentRouter.get(
  "/",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: programListQuerySchema }),
  listProgramsHandler,
);
recruitmentRouter.get(
  "/:id",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema }),
  getProgramHandler,
);
recruitmentRouter.patch(
  "/:id",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema, body: updateProgramBodySchema }),
  updateProgramHandler,
);
recruitmentRouter.post(
  "/:id/stages",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema, body: createStageBodySchema }),
  createStageHandler,
);
recruitmentRouter.put(
  "/:id/stages/order",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema, body: reorderStagesBodySchema }),
  reorderStagesHandler,
);
recruitmentRouter.put(
  "/:id/stages/:stageId/assignees",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: stageIdParamsSchema, body: stageAssigneesBodySchema }),
  updateStageAssigneesHandler,
);
recruitmentRouter.post(
  "/:id/invitations",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema, body: inviteToProgramBodySchema }),
  inviteToProgramHandler,
);
recruitmentRouter.post(
  "/:id/start",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: programIdParamsSchema }),
  startProgramHandler,
);

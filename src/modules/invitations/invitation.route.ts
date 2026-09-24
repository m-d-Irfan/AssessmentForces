import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  createInvitationHandler,
  getInvitationByTokenHandler,
  getInvitationHandler,
  listInvitationsHandler,
  listMyInvitationsHandler,
  revokeInvitationHandler,
} from "./invitation.controller.js";
import {
  candidateInvitationListQuerySchema,
  createInvitationBodySchema,
  invitationIdParamsSchema,
  invitationListQuerySchema,
  invitationTokenParamsSchema,
} from "./invitation.validation.js";

export const invitationRouter = Router();

invitationRouter.use(authenticate);
invitationRouter.get(
  "/mine",
  authorize(UserRole.CANDIDATE),
  validate({ query: candidateInvitationListQuerySchema }),
  listMyInvitationsHandler,
);
invitationRouter.get(
  "/token/:token",
  authorize(UserRole.CANDIDATE),
  validate({ params: invitationTokenParamsSchema }),
  getInvitationByTokenHandler,
);
invitationRouter.post(
  "/",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ body: createInvitationBodySchema }),
  createInvitationHandler,
);
invitationRouter.get(
  "/",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: invitationListQuerySchema }),
  listInvitationsHandler,
);
invitationRouter.get(
  "/:id",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: invitationIdParamsSchema }),
  getInvitationHandler,
);
invitationRouter.post(
  "/:id/revoke",
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: invitationIdParamsSchema }),
  revokeInvitationHandler,
);

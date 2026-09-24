import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { getInvitationByTokenHandler, listMyInvitationsHandler } from "./invitation.controller.js";
import {
  candidateInvitationListQuerySchema,
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

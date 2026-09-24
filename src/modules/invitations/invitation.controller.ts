import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  createInvitation,
  getCandidateInvitationByToken,
  getInvitation,
  listCandidateInvitations,
  listInvitations,
  revokeInvitation,
} from "./invitation.service.js";

function actorContext(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const userAgent = request.header("user-agent");
  return {
    actorId: request.auth.userId,
    role: request.auth.role,
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(request.res?.locals.requestId ? { requestId: request.res.locals.requestId as string } : {}),
  };
}

export async function createInvitationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Candidate invitation created",
    data: await createInvitation(request.body, actorContext(request)),
  });
}

export async function listInvitationsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Invitations retrieved",
    data: await listInvitations(request.query as never, actorContext(request)),
  });
}

export async function getInvitationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Invitation retrieved",
    data: await getInvitation(request.params.id as string, actorContext(request)),
  });
}

export async function revokeInvitationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Invitation revoked and credit refunded",
    data: await revokeInvitation(request.params.id as string, actorContext(request)),
  });
}

export async function listMyInvitationsHandler(request: Request, response: Response) {
  const actor = actorContext(request);
  return sendSuccess(response, {
    message: "Candidate invitations retrieved",
    data: await listCandidateInvitations(request.query as never, actor.actorId),
  });
}

export async function getInvitationByTokenHandler(request: Request, response: Response) {
  const actor = actorContext(request);
  return sendSuccess(response, {
    message: "Invitation token verified",
    data: await getCandidateInvitationByToken(request.params.token as string, actor.actorId),
  });
}

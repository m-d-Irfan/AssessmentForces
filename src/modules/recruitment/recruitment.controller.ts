import type { Request, Response } from "express";
import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  acceptProgramInvitation,
  createProgram,
  createStage,
  finalizeCandidateStage,
  getProgram,
  getProgramApplication,
  getProgramInvitationPreview,
  getStageTask,
  inviteToProgram,
  listCandidateApplications,
  listMyStageTasks,
  listProgramApplications,
  listPrograms,
  reorderStages,
  scheduleInterview,
  startProgram,
  submitStageReview,
  updateProgram,
  updateStageAssignees,
} from "./recruitment.service.js";

function actor(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return { actorId: request.auth.userId, role: request.auth.role };
}

export async function createProgramHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Recruitment program created",
    data: await createProgram(request.body, actor(request)),
  });
}
export async function listProgramsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Recruitment programs retrieved",
    data: await listPrograms(request.query as never, actor(request)),
  });
}
export async function getProgramHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Recruitment program retrieved",
    data: await getProgram(request.params.id as string, actor(request)),
  });
}
export async function updateProgramHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Recruitment program updated",
    data: await updateProgram(request.params.id as string, request.body, actor(request)),
  });
}
export async function listProgramApplicationsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Program candidates retrieved",
    data: await listProgramApplications(request.params.id as string, actor(request)),
  });
}
export async function getProgramApplicationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Candidate application retrieved",
    data: await getProgramApplication(
      request.params.id as string,
      request.params.applicationId as string,
      actor(request),
    ),
  });
}
export async function createStageHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Recruitment stage created",
    data: await createStage(request.params.id as string, request.body, actor(request)),
  });
}
export async function reorderStagesHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Recruitment stages reordered",
    data: await reorderStages(request.params.id as string, request.body.stageIds, actor(request)),
  });
}
export async function updateStageAssigneesHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Stage assignees updated",
    data: await updateStageAssignees(
      request.params.id as string,
      request.params.stageId as string,
      request.body.assigneeIds,
      actor(request),
    ),
  });
}
export async function inviteToProgramHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Program invitation sent",
    data: await inviteToProgram(request.params.id as string, request.body, actor(request)),
  });
}
export async function acceptProgramInvitationHandler(request: Request, response: Response) {
  const context = actor(request);
  const user = await prisma.user.findUnique({
    where: { id: context.actorId },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!user) throw new AppError(401, "AUTHENTICATION_REQUIRED", "User not found");
  return sendSuccess(response, {
    message: "Program invitation accepted",
    data: await acceptProgramInvitation(request.params.token as string, user),
  });
}
export async function getProgramInvitationPreviewHandler(request: Request, response: Response) {
  const context = actor(request);
  return sendSuccess(response, {
    message: "Program invitation retrieved",
    data: await getProgramInvitationPreview(request.params.token as string, context.actorId),
  });
}
export async function listMyApplicationsHandler(request: Request, response: Response) {
  const context = actor(request);
  return sendSuccess(response, {
    message: "Candidate applications retrieved",
    data: await listCandidateApplications(context.actorId),
  });
}
export async function startProgramHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Recruitment program started",
    data: await startProgram(request.params.id as string, actor(request)),
  });
}
export async function listMyStageTasksHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Assigned stage tasks retrieved",
    data: await listMyStageTasks(actor(request)),
  });
}
export async function getStageTaskHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Stage task retrieved",
    data: await getStageTask(request.params.progressId as string, actor(request)),
  });
}
export async function submitStageReviewHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Stage review submitted",
    data: await submitStageReview(
      request.params.progressId as string,
      request.body,
      actor(request),
    ),
  });
}
export async function scheduleInterviewHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Interview scheduled",
    data: await scheduleInterview(
      request.params.progressId as string,
      request.body,
      actor(request),
    ),
  });
}
export async function finalizeCandidateStageHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Candidate stage finalized",
    data: await finalizeCandidateStage(
      request.params.progressId as string,
      request.body.decision,
      actor(request),
    ),
  });
}

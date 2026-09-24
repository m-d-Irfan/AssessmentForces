import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  getCandidateResult,
  getResult,
  listCandidateResults,
  listResults,
  releaseResult,
  updateResultSummary,
} from "./result.service.js";

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

export async function listResultsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Results retrieved",
    data: await listResults(request.query as never, actorContext(request)),
  });
}

export async function getResultHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Result retrieved",
    data: await getResult(request.params.id as string, actorContext(request)),
  });
}

export async function updateResultSummaryHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Result summary updated",
    data: await updateResultSummary(
      request.params.id as string,
      request.body.summary,
      actorContext(request),
    ),
  });
}

export async function releaseResultHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Result released to candidate",
    data: await releaseResult(request.params.id as string, actorContext(request)),
  });
}

export async function listMyResultsHandler(request: Request, response: Response) {
  const actor = actorContext(request);
  return sendSuccess(response, {
    message: "Candidate results retrieved",
    data: await listCandidateResults(request.query as never, actor.actorId),
  });
}

export async function getMyResultHandler(request: Request, response: Response) {
  const actor = actorContext(request);
  return sendSuccess(response, {
    message: "Candidate result retrieved",
    data: await getCandidateResult(request.params.id as string, actor.actorId),
  });
}

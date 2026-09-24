import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  autoSubmitForTabChange,
  getCandidateAttempt,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "./attempt.service.js";

function candidateId(request: Request): string {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return request.auth.userId;
}

export async function startAttemptHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Assessment attempt started",
    data: await startAttempt(request.body.invitationToken, candidateId(request)),
  });
}

export async function getAttemptHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Assessment attempt retrieved",
    data: await getCandidateAttempt(request.params.id as string, candidateId(request)),
  });
}

export async function saveAnswerHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Answer saved",
    data: await saveAnswer(
      request.params.id as string,
      request.params.itemId as string,
      request.body,
      candidateId(request),
    ),
  });
}

export async function submitAttemptHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Assessment attempt submitted",
    data: await submitAttempt(request.params.id as string, candidateId(request)),
  });
}

export async function tabChangeHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Assessment attempt automatically submitted after tab change",
    data: await autoSubmitForTabChange(request.params.id as string, candidateId(request)),
  });
}

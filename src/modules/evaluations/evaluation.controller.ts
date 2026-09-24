import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  finalizeEvaluation,
  getEvaluation,
  gradeAnswer,
  listEvaluations,
  runAutomaticGrading,
} from "./evaluation.service.js";

function actorContext(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return { actorId: request.auth.userId, role: request.auth.role };
}

export async function listEvaluationsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Evaluations retrieved",
    data: await listEvaluations(request.query as never, actorContext(request)),
  });
}

export async function getEvaluationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Evaluation retrieved",
    data: await getEvaluation(request.params.id as string, actorContext(request)),
  });
}

export async function runAutomaticGradingHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Automatic grading completed",
    data: await runAutomaticGrading(request.params.id as string, actorContext(request)),
  });
}

export async function gradeAnswerHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Answer grade saved",
    data: await gradeAnswer(
      request.params.id as string,
      request.params.answerId as string,
      request.body,
      actorContext(request),
    ),
  });
}

export async function finalizeEvaluationHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Evaluation finalized",
    data: await finalizeEvaluation(
      request.params.id as string,
      request.body.notes,
      actorContext(request),
    ),
  });
}

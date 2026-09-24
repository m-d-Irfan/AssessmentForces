import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  addAssessmentItem,
  archiveAssessment,
  createAssessment,
  deleteAssessmentItem,
  getAssessment,
  listAssessments,
  publishAssessment,
  softDeleteAssessment,
  updateAssessment,
  updateAssessmentItem,
} from "./assessment.service.js";

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

export async function createAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const assessment = await createAssessment(request.body, actorContext(request));
  return sendSuccess(response, {
    statusCode: 201,
    message: "Assessment created",
    data: assessment,
  });
}

export async function listAssessmentsHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const result = await listAssessments(request.query as never, actorContext(request));
  return sendSuccess(response, { message: "Assessments retrieved", data: result });
}

export async function getAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const assessment = await getAssessment(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Assessment retrieved", data: assessment });
}

export async function updateAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const assessment = await updateAssessment(
    request.params.id as string,
    request.body,
    actorContext(request),
  );
  return sendSuccess(response, { message: "Assessment updated", data: assessment });
}

export async function deleteAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  await softDeleteAssessment(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Assessment deleted", data: null });
}

export async function addAssessmentItemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const item = await addAssessmentItem(
    request.params.id as string,
    request.body,
    actorContext(request),
  );
  return sendSuccess(response, { statusCode: 201, message: "Assessment item added", data: item });
}

export async function updateAssessmentItemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const item = await updateAssessmentItem(
    request.params.id as string,
    request.params.itemId as string,
    request.body,
    actorContext(request),
  );
  return sendSuccess(response, { message: "Assessment item updated", data: item });
}

export async function deleteAssessmentItemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  await deleteAssessmentItem(
    request.params.id as string,
    request.params.itemId as string,
    actorContext(request),
  );
  return sendSuccess(response, { message: "Assessment item removed", data: null });
}

export async function publishAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const assessment = await publishAssessment(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Assessment published", data: assessment });
}

export async function archiveAssessmentHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const assessment = await archiveAssessment(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Assessment archived", data: assessment });
}

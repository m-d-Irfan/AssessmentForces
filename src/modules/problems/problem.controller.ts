import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  createProblem,
  createProblemVersion,
  getProblem,
  listProblems,
  softDeleteProblem,
  updateProblem,
} from "./problem.service.js";

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

export async function createProblemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const problem = await createProblem(request.body, actorContext(request));
  return sendSuccess(response, { statusCode: 201, message: "Problem created", data: problem });
}

export async function listProblemsHandler(request: Request, response: Response): Promise<Response> {
  const result = await listProblems(request.query as never, actorContext(request));
  return sendSuccess(response, { message: "Problems retrieved", data: result });
}

export async function getProblemHandler(request: Request, response: Response): Promise<Response> {
  const problem = await getProblem(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Problem retrieved", data: problem });
}

export async function updateProblemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const problem = await updateProblem(
    request.params.id as string,
    request.body,
    actorContext(request),
  );
  return sendSuccess(response, { message: "Problem updated", data: problem });
}

export async function createProblemVersionHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  const version = await createProblemVersion(
    request.params.id as string,
    request.body,
    actorContext(request),
  );
  return sendSuccess(response, {
    statusCode: 201,
    message: "Problem version created",
    data: version,
  });
}

export async function deleteProblemHandler(
  request: Request,
  response: Response,
): Promise<Response> {
  await softDeleteProblem(request.params.id as string, actorContext(request));
  return sendSuccess(response, { message: "Problem deleted", data: null });
}

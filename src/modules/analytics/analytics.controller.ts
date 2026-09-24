import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  getAdminDashboard,
  getAssessmentAnalytics,
  getCandidateDashboard,
  getCompanyDashboard,
} from "./analytics.service.js";

function actorContext(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return { actorId: request.auth.userId, role: request.auth.role };
}

export async function companyDashboardHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Company dashboard retrieved",
    data: await getCompanyDashboard(request.query.companyId as string, actorContext(request)),
  });
}

export async function assessmentAnalyticsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Assessment analytics retrieved",
    data: await getAssessmentAnalytics(
      request.params.assessmentId as string,
      actorContext(request),
    ),
  });
}

export async function candidateDashboardHandler(request: Request, response: Response) {
  const actor = actorContext(request);
  return sendSuccess(response, {
    message: "Candidate dashboard retrieved",
    data: await getCandidateDashboard(actor.actorId),
  });
}

export async function adminDashboardHandler(_request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Platform dashboard retrieved",
    data: await getAdminDashboard(),
  });
}

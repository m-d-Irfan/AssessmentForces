import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  adjustCompanyCredits,
  createCreditPackage,
  deleteCreditPackage,
  getCompany,
  getUser,
  listAllCreditPackages,
  listAuditLogs,
  listCompanies,
  listUsers,
  updateCompanyStatus,
  updateCreditPackage,
  updateUserStatus,
  verifyCompany,
} from "./admin.service.js";

function adminActor(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const userAgent = request.header("user-agent");
  return {
    actorId: request.auth.userId,
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(request.res?.locals.requestId ? { requestId: request.res.locals.requestId as string } : {}),
  };
}

export async function listUsersHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Users retrieved",
    data: await listUsers(request.query as never),
  });
}
export async function getUserHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "User retrieved",
    data: await getUser(request.params.id as string),
  });
}
export async function updateUserStatusHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "User status updated",
    data: await updateUserStatus(
      request.params.id as string,
      request.body.status,
      adminActor(request),
    ),
  });
}
export async function listCompaniesHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Companies retrieved",
    data: await listCompanies(request.query as never),
  });
}
export async function getCompanyHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Company retrieved",
    data: await getCompany(request.params.id as string),
  });
}
export async function updateCompanyStatusHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Company status updated",
    data: await updateCompanyStatus(
      request.params.id as string,
      request.body.status,
      adminActor(request),
    ),
  });
}
export async function verifyCompanyHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Company verification updated",
    data: await verifyCompany(
      request.params.id as string,
      request.body.verified,
      adminActor(request),
    ),
  });
}
export async function adjustCompanyCreditsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Company credits adjusted",
    data: await adjustCompanyCredits(
      request.params.id as string,
      request.body.amount,
      request.body.reason,
      adminActor(request),
    ),
  });
}
export async function listCreditPackagesHandler(_request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Credit packages retrieved",
    data: await listAllCreditPackages(),
  });
}
export async function createCreditPackageHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "Credit package created",
    data: await createCreditPackage(request.body, adminActor(request)),
  });
}
export async function updateCreditPackageHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Credit package updated",
    data: await updateCreditPackage(request.params.id as string, request.body, adminActor(request)),
  });
}
export async function deleteCreditPackageHandler(request: Request, response: Response) {
  await deleteCreditPackage(request.params.id as string, adminActor(request));
  return sendSuccess(response, { message: "Credit package deleted", data: null });
}
export async function listAuditLogsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Audit logs retrieved",
    data: await listAuditLogs(request.query as never),
  });
}

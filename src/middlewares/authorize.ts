import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../shared/errors/app-error.js";

export function authorize(...allowedRoles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.auth)
      throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
    if (!allowedRoles.includes(request.auth.role)) {
      throw new AppError(
        403,
        "INSUFFICIENT_PERMISSION",
        "You do not have permission for this action",
      );
    }
    next();
  };
}

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../shared/errors/app-error.js";

export function notFound(request: Request, _response: Response, next: NextFunction): void {
  next(new AppError(404, "ROUTE_NOT_FOUND", `Route ${request.method} ${request.path} not found`));
}

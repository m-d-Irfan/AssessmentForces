import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { AppError } from "../shared/errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = response.locals.requestId as string | undefined;

  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      errors: error.issues,
      requestId,
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      errors: error.details ?? [],
      requestId,
    });
    return;
  }

  logger.error(
    { err: error, requestId, method: request.method, path: request.path },
    "Unhandled error",
  );
  response.status(500).json({
    success: false,
    message: "Internal server error",
    code: "INTERNAL_SERVER_ERROR",
    errors: [],
    requestId,
  });
};

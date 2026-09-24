import { Prisma } from "@prisma/client";
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

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const conflict = error.code === "P2002";
    const notFound = error.code === "P2025";
    if (conflict || notFound) {
      response.status(conflict ? 409 : 404).json({
        success: false,
        message: conflict ? "A resource with these values already exists" : "Resource not found",
        code: conflict ? "RESOURCE_CONFLICT" : "RESOURCE_NOT_FOUND",
        errors: [],
        requestId,
      });
      return;
    }
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      success: false,
      message: "Request body contains invalid JSON",
      code: "INVALID_JSON",
      errors: [],
      requestId,
    });
    return;
  }

  if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
    response.status(413).json({
      success: false,
      message: "Request body is too large",
      code: "PAYLOAD_TOO_LARGE",
      errors: [],
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

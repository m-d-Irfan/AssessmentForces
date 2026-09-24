import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(request: Request, response: Response, next: NextFunction): void {
  const incomingRequestId = request.header("x-request-id")?.trim();
  const id =
    incomingRequestId && /^[a-zA-Z0-9_-]{8,100}$/.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();
  response.locals.requestId = id;
  response.setHeader("x-request-id", id);
  next();
}

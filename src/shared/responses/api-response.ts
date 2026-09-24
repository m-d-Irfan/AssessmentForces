import type { Response } from "express";

export function sendSuccess<T>(
  response: Response,
  options: { statusCode?: number; message: string; data: T },
): Response {
  return response.status(options.statusCode ?? 200).json({
    success: true,
    message: options.message,
    data: options.data,
  });
}

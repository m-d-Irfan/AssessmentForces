import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notification.service.js";

function userId(request: Request): string {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return request.auth.userId;
}

export async function listNotificationsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Notifications retrieved",
    data: await listNotifications(request.query as never, userId(request)),
  });
}

export async function unreadNotificationCountHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Unread notification count retrieved",
    data: await getUnreadNotificationCount(userId(request)),
  });
}

export async function markNotificationReadHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Notification marked as read",
    data: await markNotificationRead(request.params.id as string, userId(request)),
  });
}

export async function markAllNotificationsReadHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "All notifications marked as read",
    data: await markAllNotificationsRead(userId(request)),
  });
}

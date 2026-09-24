import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import type { NotificationListQuery } from "./notification.validation.js";

export async function listNotifications(query: NotificationListQuery, userId: string) {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.type ? { type: query.type } : {}),
  };
  const [items, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    items,
    unreadCount,
    meta: paginationMeta(query.page, query.limit, total),
  };
}

export async function getUnreadNotificationCount(userId: string) {
  const count = await prisma.notification.count({ where: { userId, readAt: null } });
  return { count };
}

export async function markNotificationRead(id: string, userId: string) {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) {
    throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  }
  if (notification.readAt) return notification;
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string) {
  const readAt = new Date();
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt },
  });
  return { updatedCount: result.count, readAt };
}

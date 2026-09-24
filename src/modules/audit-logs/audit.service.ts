import type { Prisma } from "@prisma/client";
import type { prisma } from "../../config/database.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

export type AuditContext = {
  actorId: string;
  companyId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export async function createAuditLog(
  database: DatabaseClient,
  context: AuditContext,
  event: {
    action: string;
    entityType: string;
    entityId?: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await database.auditLog.create({
    data: {
      actorId: context.actorId,
      companyId: context.companyId ?? null,
      requestId: context.requestId ?? null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      ...(event.before !== undefined ? { before: event.before } : {}),
      ...(event.after !== undefined ? { after: event.after } : {}),
    },
  });
}

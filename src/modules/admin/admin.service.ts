import { type CompanyStatus, CreditLedgerType, Prisma, type UserStatus } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { createAuditLog } from "../audit-logs/audit.service.js";
import type {
  AuditLogListQuery,
  CompanyListQuery,
  CreateCreditPackageInput,
  UpdateCreditPackageInput,
  UserListQuery,
} from "./admin.validation.js";

export type AdminActor = {
  actorId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const publicUserSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export async function listUsers(query: UserListQuery) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: "insensitive" } },
            { displayName: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      select: publicUserSelect,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getUser(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      ...publicUserSelect,
      candidateProfile: true,
      companyMemberships: {
        include: { company: { select: { id: true, name: true, status: true } } },
      },
      programMemberships: {
        include: { program: { select: { id: true, title: true, status: true } } },
      },
    },
  });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

export async function updateUserStatus(id: string, status: UserStatus, actor: AdminActor) {
  if (id === actor.actorId) {
    throw new AppError(
      409,
      "SELF_STATUS_CHANGE_DENIED",
      "Administrators cannot change their own status",
    );
  }
  const before = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: publicUserSelect,
  });
  if (!before) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { status },
      select: publicUserSelect,
    });
    if (status === "SUSPENDED") {
      await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await createAuditLog(tx, actor, {
      action: "ADMIN_USER_STATUS_CHANGED",
      entityType: "User",
      entityId: id,
      before: asJson(before),
      after: asJson(user),
    });
    return user;
  });
}

export async function listCompanies(query: CompanyListQuery) {
  const where: Prisma.CompanyWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.verified !== undefined ? { verifiedAt: query.verified ? { not: null } : null } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { slug: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.company.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: {
        creditBalance: true,
        _count: { select: { memberships: true, recruitmentPrograms: true } },
      },
    }),
    prisma.company.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getCompany(id: string) {
  const company = await prisma.company.findFirst({
    where: { id, deletedAt: null },
    include: {
      createdBy: { select: publicUserSelect },
      memberships: { include: { user: { select: publicUserSelect } } },
      creditBalance: true,
      _count: {
        select: { problems: true, assessments: true, recruitmentPrograms: true, payments: true },
      },
    },
  });
  if (!company) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  return company;
}

export async function updateCompanyStatus(id: string, status: CompanyStatus, actor: AdminActor) {
  const before = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.update({ where: { id }, data: { status } });
    await createAuditLog(
      tx,
      { ...actor, companyId: id },
      {
        action: "ADMIN_COMPANY_STATUS_CHANGED",
        entityType: "Company",
        entityId: id,
        before: asJson(before),
        after: asJson(company),
      },
    );
    return company;
  });
}

export async function verifyCompany(id: string, verified: boolean, actor: AdminActor) {
  const before = await prisma.company.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.update({
      where: { id },
      data: { verifiedAt: verified ? new Date() : null },
    });
    await createAuditLog(
      tx,
      { ...actor, companyId: id },
      {
        action: verified ? "ADMIN_COMPANY_VERIFIED" : "ADMIN_COMPANY_UNVERIFIED",
        entityType: "Company",
        entityId: id,
        before: asJson(before),
        after: asJson(company),
      },
    );
    return company;
  });
}

export function listAllCreditPackages() {
  return prisma.creditPackage.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createCreditPackage(input: CreateCreditPackageInput, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    const creditPackage = await tx.creditPackage.create({
      data: { ...input, description: input.description ?? null },
    });
    await createAuditLog(tx, actor, {
      action: "ADMIN_CREDIT_PACKAGE_CREATED",
      entityType: "CreditPackage",
      entityId: creditPackage.id,
      after: asJson(creditPackage),
    });
    return creditPackage;
  });
}

export async function updateCreditPackage(
  id: string,
  input: UpdateCreditPackageInput,
  actor: AdminActor,
) {
  const before = await prisma.creditPackage.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError(404, "CREDIT_PACKAGE_NOT_FOUND", "Credit package not found");
  return prisma.$transaction(async (tx) => {
    const creditPackage = await tx.creditPackage.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.credits !== undefined ? { credits: input.credits } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await createAuditLog(tx, actor, {
      action: "ADMIN_CREDIT_PACKAGE_UPDATED",
      entityType: "CreditPackage",
      entityId: id,
      before: asJson(before),
      after: asJson(creditPackage),
    });
    return creditPackage;
  });
}

export async function deleteCreditPackage(id: string, actor: AdminActor) {
  const before = await prisma.creditPackage.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new AppError(404, "CREDIT_PACKAGE_NOT_FOUND", "Credit package not found");
  await prisma.$transaction(async (tx) => {
    await tx.creditPackage.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await createAuditLog(tx, actor, {
      action: "ADMIN_CREDIT_PACKAGE_DELETED",
      entityType: "CreditPackage",
      entityId: id,
      before: asJson(before),
    });
  });
}

export async function adjustCompanyCredits(
  companyId: string,
  amount: number,
  reason: string,
  actor: AdminActor,
) {
  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
  return prisma.$transaction(
    async (tx) => {
      const current = await tx.companyCreditBalance.upsert({
        where: { companyId },
        create: { companyId },
        update: {},
      });
      const next = current.availableCredits + amount;
      if (next < 0)
        throw new AppError(
          409,
          "NEGATIVE_CREDIT_BALANCE",
          "Adjustment would make the balance negative",
        );
      const balance = await tx.companyCreditBalance.update({
        where: { companyId },
        data: { availableCredits: next, lockVersion: { increment: 1 } },
      });
      const ledger = await tx.creditLedger.create({
        data: {
          companyId,
          createdById: actor.actorId,
          type: CreditLedgerType.ADMIN_ADJUSTMENT,
          amount,
          balanceAfter: next,
          reference: `admin-adjustment:${crypto.randomUUID()}`,
          metadata: asJson({ reason }),
        },
      });
      await createAuditLog(
        tx,
        { ...actor, companyId },
        {
          action: "ADMIN_COMPANY_CREDITS_ADJUSTED",
          entityType: "CompanyCreditBalance",
          entityId: companyId,
          before: asJson(current),
          after: asJson({ balance, reason, ledgerId: ledger.id }),
        },
      );
      return { balance, ledger };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function listAuditLogs(query: AuditLogListQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, email: true, displayName: true } },
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

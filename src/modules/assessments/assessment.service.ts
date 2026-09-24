import { AssessmentStatus, Prisma, ProblemStatus, type UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { type AuditContext, createAuditLog } from "../audit-logs/audit.service.js";
import type {
  AddAssessmentItemInput,
  AssessmentListQuery,
  CreateAssessmentInput,
  UpdateAssessmentInput,
  UpdateAssessmentItemInput,
} from "./assessment.validation.js";

type ActorContext = AuditContext & { role: UserRole };

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assessmentForActor(id: string, actor: ActorContext) {
  const assessment = await prisma.assessment.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      items: {
        orderBy: { order: "asc" },
        include: {
          problemVersion: {
            include: {
              problem: true,
              options: { orderBy: { order: "asc" } },
              testCases: { orderBy: { order: "asc" } },
            },
          },
        },
      },
      _count: { select: { invitations: true, attempts: true } },
    },
  });
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  await requireCompanyAccess(actor.actorId, actor.role, assessment.companyId);
  return assessment;
}

function requireDraft(status: AssessmentStatus): void {
  if (status !== AssessmentStatus.DRAFT) {
    throw new AppError(409, "ASSESSMENT_IMMUTABLE", "Only draft assessments can be modified");
  }
}

export async function createAssessment(input: CreateAssessmentInput, actor: ActorContext) {
  await requireCompanyAccess(actor.actorId, actor.role, input.companyId);
  return prisma.$transaction(async (transaction) => {
    const assessment = await transaction.assessment.create({
      data: {
        companyId: input.companyId,
        createdById: actor.actorId,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        durationMinutes: input.durationMinutes,
        passPercentage: input.passPercentage,
        availableFrom: input.availableFrom ?? null,
        availableUntil: input.availableUntil ?? null,
      },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: input.companyId },
      {
        action: "ASSESSMENT_CREATED",
        entityType: "Assessment",
        entityId: assessment.id,
        after: auditJson(assessment),
      },
    );
    return assessment;
  });
}

export async function listAssessments(query: AssessmentListQuery, actor: ActorContext) {
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.AssessmentWhereInput = {
    deletedAt: null,
    ...(query.companyId
      ? { companyId: query.companyId }
      : companyIds
        ? { companyId: { in: companyIds } }
        : {}),
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.assessment.findMany({
      where,
      ...pagination(query),
      orderBy: { [query.sortBy]: query.sortOrder },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { items: true, invitations: true, attempts: true } },
      },
    }),
    prisma.assessment.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export function getAssessment(id: string, actor: ActorContext) {
  return assessmentForActor(id, actor);
}

export async function updateAssessment(
  id: string,
  input: UpdateAssessmentInput,
  actor: ActorContext,
) {
  const existing = await assessmentForActor(id, actor);
  requireDraft(existing.status);
  const nextFrom = input.availableFrom !== undefined ? input.availableFrom : existing.availableFrom;
  const nextUntil =
    input.availableUntil !== undefined ? input.availableUntil : existing.availableUntil;
  if (nextFrom && nextUntil && nextUntil <= nextFrom) {
    throw new AppError(
      422,
      "INVALID_AVAILABILITY_WINDOW",
      "availableUntil must be after availableFrom",
    );
  }

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.assessment.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions ?? null } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.passPercentage !== undefined ? { passPercentage: input.passPercentage } : {}),
        ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
        ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
      },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: existing.companyId },
      {
        action: "ASSESSMENT_UPDATED",
        entityType: "Assessment",
        entityId: id,
        before: auditJson(existing),
        after: auditJson(updated),
      },
    );
    return updated;
  });
}

export async function addAssessmentItem(
  id: string,
  input: AddAssessmentItemInput,
  actor: ActorContext,
) {
  const assessment = await assessmentForActor(id, actor);
  requireDraft(assessment.status);
  const problemVersion = await prisma.problemVersion.findUnique({
    where: { id: input.problemVersionId },
    include: { problem: true },
  });
  if (
    !problemVersion ||
    problemVersion.problem.deletedAt ||
    problemVersion.problem.companyId !== assessment.companyId
  ) {
    throw new AppError(
      404,
      "PROBLEM_VERSION_NOT_FOUND",
      "Problem version not found in this company",
    );
  }
  if (problemVersion.problem.status !== ProblemStatus.PUBLISHED) {
    throw new AppError(409, "PROBLEM_NOT_PUBLISHED", "Only published problems can be added");
  }
  const nextOrder = input.order ?? (assessment.items.at(-1)?.order ?? 0) + 1;

  try {
    return await prisma.$transaction(async (transaction) => {
      const item = await transaction.assessmentItem.create({
        data: {
          assessmentId: id,
          problemVersionId: input.problemVersionId,
          points: input.points,
          order: nextOrder,
        },
        include: { problemVersion: { include: { problem: true } } },
      });
      await transaction.assessment.update({
        where: { id },
        data: { totalPoints: { increment: input.points } },
      });
      await createAuditLog(
        transaction,
        { ...actor, companyId: assessment.companyId },
        {
          action: "ASSESSMENT_ITEM_ADDED",
          entityType: "AssessmentItem",
          entityId: item.id,
          after: auditJson(item),
        },
      );
      return item;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "ASSESSMENT_ITEM_CONFLICT",
        "The problem version or order already exists in this assessment",
      );
    }
    throw error;
  }
}

export async function updateAssessmentItem(
  id: string,
  itemId: string,
  input: UpdateAssessmentItemInput,
  actor: ActorContext,
) {
  const assessment = await assessmentForActor(id, actor);
  requireDraft(assessment.status);
  const item = assessment.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new AppError(404, "ASSESSMENT_ITEM_NOT_FOUND", "Assessment item not found");
  const scoreDifference =
    input.points === undefined
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(input.points).minus(item.points);

  try {
    return await prisma.$transaction(async (transaction) => {
      const updated = await transaction.assessmentItem.update({
        where: { id: itemId },
        data: {
          ...(input.points !== undefined ? { points: input.points } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
        },
      });
      if (!scoreDifference.isZero()) {
        await transaction.assessment.update({
          where: { id },
          data: { totalPoints: { increment: scoreDifference } },
        });
      }
      await createAuditLog(
        transaction,
        { ...actor, companyId: assessment.companyId },
        {
          action: "ASSESSMENT_ITEM_UPDATED",
          entityType: "AssessmentItem",
          entityId: itemId,
          before: auditJson(item),
          after: auditJson(updated),
        },
      );
      return updated;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "ASSESSMENT_ORDER_CONFLICT",
        "Another assessment item uses this order",
      );
    }
    throw error;
  }
}

export async function deleteAssessmentItem(
  id: string,
  itemId: string,
  actor: ActorContext,
): Promise<void> {
  const assessment = await assessmentForActor(id, actor);
  requireDraft(assessment.status);
  const item = assessment.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new AppError(404, "ASSESSMENT_ITEM_NOT_FOUND", "Assessment item not found");

  await prisma.$transaction(async (transaction) => {
    await transaction.assessmentItem.delete({ where: { id: itemId } });
    await transaction.assessment.update({
      where: { id },
      data: { totalPoints: { decrement: item.points } },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: assessment.companyId },
      {
        action: "ASSESSMENT_ITEM_REMOVED",
        entityType: "AssessmentItem",
        entityId: itemId,
        before: auditJson(item),
      },
    );
  });
}

export async function publishAssessment(id: string, actor: ActorContext) {
  const assessment = await assessmentForActor(id, actor);
  requireDraft(assessment.status);
  if (assessment.items.length === 0 || assessment.totalPoints.lte(0)) {
    throw new AppError(
      422,
      "EMPTY_ASSESSMENT",
      "An assessment must contain at least one scored item",
    );
  }
  if (assessment.availableUntil && assessment.availableUntil <= new Date()) {
    throw new AppError(
      422,
      "ASSESSMENT_ALREADY_EXPIRED",
      "The assessment availability has already ended",
    );
  }
  if (
    assessment.items.some((item) => item.problemVersion.problem.status !== ProblemStatus.PUBLISHED)
  ) {
    throw new AppError(
      422,
      "UNPUBLISHED_PROBLEM",
      "Every assessment item must use a published problem",
    );
  }

  return prisma.$transaction(async (transaction) => {
    const published = await transaction.assessment.update({
      where: { id },
      data: { status: AssessmentStatus.PUBLISHED, publishedAt: new Date() },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: assessment.companyId },
      {
        action: "ASSESSMENT_PUBLISHED",
        entityType: "Assessment",
        entityId: id,
        before: auditJson(assessment),
        after: auditJson(published),
      },
    );
    return published;
  });
}

export async function archiveAssessment(id: string, actor: ActorContext) {
  const assessment = await assessmentForActor(id, actor);
  if (assessment.status !== AssessmentStatus.PUBLISHED) {
    throw new AppError(
      409,
      "ASSESSMENT_NOT_PUBLISHED",
      "Only published assessments can be archived",
    );
  }
  return prisma.$transaction(async (transaction) => {
    const archived = await transaction.assessment.update({
      where: { id },
      data: { status: AssessmentStatus.ARCHIVED, archivedAt: new Date() },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: assessment.companyId },
      {
        action: "ASSESSMENT_ARCHIVED",
        entityType: "Assessment",
        entityId: id,
        before: auditJson(assessment),
        after: auditJson(archived),
      },
    );
    return archived;
  });
}

export async function softDeleteAssessment(id: string, actor: ActorContext): Promise<void> {
  const assessment = await assessmentForActor(id, actor);
  requireDraft(assessment.status);
  await prisma.$transaction(async (transaction) => {
    await transaction.assessment.update({ where: { id }, data: { deletedAt: new Date() } });
    await createAuditLog(
      transaction,
      { ...actor, companyId: assessment.companyId },
      {
        action: "ASSESSMENT_SOFT_DELETED",
        entityType: "Assessment",
        entityId: id,
        before: auditJson(assessment),
      },
    );
  });
}

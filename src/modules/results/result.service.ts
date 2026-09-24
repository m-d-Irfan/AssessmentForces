import { AttemptStatus, type Prisma, type UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { createAuditLog } from "../audit-logs/audit.service.js";
import type { CandidateResultListQuery, ResultListQuery } from "./result.validation.js";

export type ResultActor = {
  actorId: string;
  role: UserRole;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

const recruiterResultInclude = {
  attempt: {
    include: {
      candidate: { select: { id: true, email: true, displayName: true } },
      assessment: { select: { id: true, companyId: true, title: true, passPercentage: true } },
      evaluation: {
        select: {
          id: true,
          autoScore: true,
          manualScore: true,
          notes: true,
          finalizedAt: true,
          evaluator: { select: { id: true, displayName: true } },
        },
      },
    },
  },
} satisfies Prisma.ResultInclude;

const candidateResultInclude = {
  attempt: {
    select: {
      id: true,
      candidateId: true,
      startedAt: true,
      submittedAt: true,
      assessment: {
        select: {
          id: true,
          title: true,
          description: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      answers: {
        orderBy: { assessmentItem: { order: "asc" as const } },
        select: {
          id: true,
          response: true,
          sourceCode: true,
          language: true,
          score: true,
          feedback: true,
          assessmentItem: {
            select: {
              id: true,
              order: true,
              points: true,
              problemVersion: {
                select: {
                  prompt: true,
                  explanation: true,
                  problem: { select: { title: true, type: true, difficulty: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ResultInclude;

async function recruiterResult(id: string, actor: ResultActor) {
  const result = await prisma.result.findUnique({
    where: { id },
    include: recruiterResultInclude,
  });
  if (!result) throw new AppError(404, "RESULT_NOT_FOUND", "Result not found");
  await requireCompanyAccess(actor.actorId, actor.role, result.attempt.assessment.companyId);
  return result;
}

export async function listResults(query: ResultListQuery, actor: ResultActor) {
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.ResultWhereInput = {
    ...(query.passed !== undefined ? { passed: query.passed } : {}),
    ...(query.released !== undefined ? { releasedAt: query.released ? { not: null } : null } : {}),
    attempt: {
      ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
      ...(query.candidateId ? { candidateId: query.candidateId } : {}),
      assessment: query.companyId
        ? { companyId: query.companyId }
        : companyIds
          ? { companyId: { in: companyIds } }
          : {},
    },
  };
  const [items, total] = await prisma.$transaction([
    prisma.result.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: recruiterResultInclude,
    }),
    prisma.result.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export function getResult(id: string, actor: ResultActor) {
  return recruiterResult(id, actor);
}

export async function updateResultSummary(id: string, summary: string | null, actor: ResultActor) {
  const existing = await recruiterResult(id, actor);
  if (existing.releasedAt) {
    throw new AppError(409, "RESULT_ALREADY_RELEASED", "A released result cannot be edited");
  }
  return prisma.result.update({
    where: { id },
    data: { summary },
    include: recruiterResultInclude,
  });
}

export async function releaseResult(id: string, actor: ResultActor) {
  const existing = await recruiterResult(id, actor);
  if (existing.releasedAt) return existing;
  const releasedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const released = await tx.result.updateMany({
      where: { id, releasedAt: null },
      data: { releasedAt },
    });
    if (released.count === 0) return;
    await tx.attempt.update({
      where: { id: existing.attemptId },
      data: { status: AttemptStatus.RESULT_RELEASED, lockVersion: { increment: 1 } },
    });
    await tx.notification.create({
      data: {
        userId: existing.attempt.candidate.id,
        type: "RESULT_RELEASED",
        title: "Assessment result available",
        body: `Your result for “${existing.attempt.assessment.title}” is now available.`,
        metadata: {
          resultId: existing.id,
          assessmentId: existing.attempt.assessment.id,
        },
      },
    });
    await createAuditLog(
      tx,
      { ...actor, companyId: existing.attempt.assessment.companyId },
      {
        action: "RESULT_RELEASED",
        entityType: "Result",
        entityId: existing.id,
        after: { releasedAt: releasedAt.toISOString() },
      },
    );
  });
  return recruiterResult(id, actor);
}

export async function listCandidateResults(query: CandidateResultListQuery, candidateId: string) {
  const where: Prisma.ResultWhereInput = {
    releasedAt: { not: null },
    attempt: { candidateId },
  };
  const [items, total] = await prisma.$transaction([
    prisma.result.findMany({
      where,
      ...pagination(query),
      orderBy: { releasedAt: "desc" },
      include: {
        attempt: {
          select: {
            id: true,
            submittedAt: true,
            assessment: {
              select: {
                id: true,
                title: true,
                company: { select: { id: true, name: true, logoUrl: true } },
              },
            },
          },
        },
      },
    }),
    prisma.result.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getCandidateResult(id: string, candidateId: string) {
  const result = await prisma.result.findFirst({
    where: { id, releasedAt: { not: null }, attempt: { candidateId } },
    include: candidateResultInclude,
  });
  if (!result) throw new AppError(404, "RESULT_NOT_FOUND", "Released result not found");
  return result;
}

import { Prisma, ProblemStatus, ProblemType, type UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { type AuditContext, createAuditLog } from "../audit-logs/audit.service.js";
import type {
  CreateProblemInput,
  ProblemListQuery,
  ProblemVersionInput,
  UpdateProblemInput,
} from "./problem.validation.js";

type ActorContext = AuditContext & { role: UserRole };

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validateVersion(type: ProblemType, version: ProblemVersionInput): void {
  if (type === ProblemType.SINGLE_CHOICE) {
    if (
      version.options.length < 2 ||
      version.options.filter((option) => option.isCorrect).length !== 1
    ) {
      throw new AppError(
        422,
        "INVALID_PROBLEM_OPTIONS",
        "Single-choice problems require at least two options and exactly one correct answer",
      );
    }
  }
  if (type === ProblemType.MULTIPLE_CHOICE) {
    if (version.options.length < 2 || !version.options.some((option) => option.isCorrect)) {
      throw new AppError(
        422,
        "INVALID_PROBLEM_OPTIONS",
        "Multiple-choice problems require at least two options and one correct answer",
      );
    }
  }
  if (
    (type === ProblemType.SHORT_TEXT || type === ProblemType.CODE) &&
    version.options.length > 0
  ) {
    throw new AppError(
      422,
      "OPTIONS_NOT_ALLOWED",
      "Written and code problems cannot contain choice options",
    );
  }
  if (type === ProblemType.CODE && (!version.allowedLanguages?.length || !version.starterCode)) {
    throw new AppError(
      422,
      "INVALID_CODE_PROBLEM",
      "Code problems require starter code and at least one allowed language",
    );
  }
}

function versionCreateData(version: ProblemVersionInput, versionNumber: number) {
  return {
    version: versionNumber,
    prompt: version.prompt,
    explanation: version.explanation ?? null,
    starterCode: version.starterCode ?? null,
    allowedLanguages: version.allowedLanguages
      ? (version.allowedLanguages as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    answerConfig: version.answerConfig
      ? (version.answerConfig as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    options: {
      create: version.options.map((option, index) => ({ ...option, order: index + 1 })),
    },
    testCases: {
      create: version.testCases.map((testCase, index) => ({ ...testCase, order: index + 1 })),
    },
  };
}

async function problemForActor(id: string, actor: ActorContext) {
  const problem = await prisma.problem.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      versions: {
        orderBy: { version: "desc" },
        include: {
          options: { orderBy: { order: "asc" } },
          testCases: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!problem) throw new AppError(404, "PROBLEM_NOT_FOUND", "Problem not found");
  await requireCompanyAccess(actor.actorId, actor.role, problem.companyId);
  return problem;
}

export async function createProblem(input: CreateProblemInput, actor: ActorContext) {
  await requireCompanyAccess(actor.actorId, actor.role, input.companyId);
  validateVersion(input.type, input.version);

  try {
    return await prisma.$transaction(async (transaction) => {
      const problem = await transaction.problem.create({
        data: {
          companyId: input.companyId,
          creatorId: actor.actorId,
          title: input.title,
          type: input.type,
          difficulty: input.difficulty,
          versions: { create: versionCreateData(input.version, 1) },
        },
        include: {
          versions: { include: { options: true, testCases: true } },
        },
      });
      await createAuditLog(
        transaction,
        { ...actor, companyId: input.companyId },
        {
          action: "PROBLEM_CREATED",
          entityType: "Problem",
          entityId: problem.id,
          after: auditJson(problem),
        },
      );
      return problem;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "PROBLEM_TITLE_EXISTS",
        "A problem with this title already exists in the company",
      );
    }
    throw error;
  }
}

export async function listProblems(query: ProblemListQuery, actor: ActorContext) {
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);

  const where: Prisma.ProblemWhereInput = {
    deletedAt: null,
    ...(query.companyId
      ? { companyId: query.companyId }
      : companyIds
        ? { companyId: { in: companyIds } }
        : {}),
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.problem.findMany({
      where,
      ...pagination(query),
      orderBy: { [query.sortBy]: query.sortOrder },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
    }),
    prisma.problem.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export function getProblem(id: string, actor: ActorContext) {
  return problemForActor(id, actor);
}

export async function updateProblem(id: string, input: UpdateProblemInput, actor: ActorContext) {
  const existing = await problemForActor(id, actor);
  if (existing.status === ProblemStatus.ARCHIVED) {
    throw new AppError(409, "PROBLEM_ARCHIVED", "Archived problems cannot be changed");
  }
  if (existing.status === ProblemStatus.PUBLISHED && input.status !== ProblemStatus.ARCHIVED) {
    throw new AppError(
      409,
      "PROBLEM_PUBLISHED",
      "Published problem metadata is immutable; create a new version or archive it",
    );
  }
  if (input.status === ProblemStatus.PUBLISHED) {
    validateVersion(existing.type, {
      prompt: existing.versions[0]?.prompt ?? "",
      explanation: existing.versions[0]?.explanation ?? undefined,
      starterCode: existing.versions[0]?.starterCode ?? undefined,
      allowedLanguages: existing.versions[0]?.allowedLanguages as string[] | undefined,
      answerConfig: existing.versions[0]?.answerConfig as Record<string, unknown> | undefined,
      options: existing.versions[0]?.options ?? [],
      testCases:
        existing.versions[0]?.testCases.map((testCase) => ({
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          isHidden: testCase.isHidden,
          weight: Number(testCase.weight),
        })) ?? [],
    });
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const updated = await transaction.problem.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await createAuditLog(
        transaction,
        { ...actor, companyId: existing.companyId },
        {
          action: input.status === ProblemStatus.ARCHIVED ? "PROBLEM_ARCHIVED" : "PROBLEM_UPDATED",
          entityType: "Problem",
          entityId: id,
          before: auditJson(existing),
          after: auditJson(updated),
        },
      );
      return updated;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "PROBLEM_TITLE_EXISTS",
        "A problem with this title already exists in the company",
      );
    }
    throw error;
  }
}

export async function createProblemVersion(
  id: string,
  input: ProblemVersionInput,
  actor: ActorContext,
) {
  const existing = await problemForActor(id, actor);
  if (existing.status === ProblemStatus.ARCHIVED) {
    throw new AppError(409, "PROBLEM_ARCHIVED", "Archived problems cannot receive new versions");
  }
  validateVersion(existing.type, input);

  return prisma.$transaction(
    async (transaction) => {
      const claimed = await transaction.problem.updateMany({
        where: { id, currentVersionNumber: existing.currentVersionNumber, deletedAt: null },
        data: { currentVersionNumber: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new AppError(
          409,
          "VERSION_CONFLICT",
          "Another problem version was created; retry the request",
        );
      }
      const version = await transaction.problemVersion.create({
        data: { problemId: id, ...versionCreateData(input, existing.currentVersionNumber + 1) },
        include: { options: true, testCases: true },
      });
      await createAuditLog(
        transaction,
        { ...actor, companyId: existing.companyId },
        {
          action: "PROBLEM_VERSION_CREATED",
          entityType: "ProblemVersion",
          entityId: version.id,
          after: auditJson(version),
        },
      );
      return version;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function softDeleteProblem(id: string, actor: ActorContext): Promise<void> {
  const existing = await problemForActor(id, actor);
  await prisma.$transaction(async (transaction) => {
    await transaction.problem.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProblemStatus.ARCHIVED },
    });
    await createAuditLog(
      transaction,
      { ...actor, companyId: existing.companyId },
      {
        action: "PROBLEM_SOFT_DELETED",
        entityType: "Problem",
        entityId: id,
        before: auditJson(existing),
      },
    );
  });
}

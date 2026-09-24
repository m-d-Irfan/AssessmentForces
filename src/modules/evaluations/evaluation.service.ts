import {
  AttemptStatus,
  EvaluationStatus,
  Prisma,
  ProblemType,
  type UserRole,
} from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import type { EvaluationListQuery, GradeAnswerInput } from "./evaluation.validation.js";

export type EvaluationActor = { actorId: string; role: UserRole };

const evaluationInclude = {
  attempt: {
    include: {
      candidate: { select: { id: true, email: true, displayName: true } },
      assessment: {
        select: {
          id: true,
          companyId: true,
          title: true,
          totalPoints: true,
          passPercentage: true,
        },
      },
      answers: {
        orderBy: { assessmentItem: { order: "asc" as const } },
        include: {
          assessmentItem: {
            include: {
              problemVersion: {
                include: {
                  problem: { select: { id: true, title: true, type: true } },
                  options: { orderBy: { order: "asc" as const } },
                  testCases: { orderBy: { order: "asc" as const } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.EvaluationInclude;

async function evaluationForActor(id: string, actor: EvaluationActor) {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id },
    include: evaluationInclude,
  });
  if (!evaluation) throw new AppError(404, "EVALUATION_NOT_FOUND", "Evaluation not found");
  await requireCompanyAccess(actor.actorId, actor.role, evaluation.attempt.assessment.companyId);
  return evaluation;
}

function selectedOptions(response: Prisma.JsonValue | null): string[] {
  if (typeof response === "string") return [response];
  if (Array.isArray(response))
    return response.filter((item): item is string => typeof item === "string");
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const value = response as Record<string, Prisma.JsonValue>;
    if (typeof value.optionId === "string") return [value.optionId];
    if (Array.isArray(value.optionIds)) {
      return value.optionIds.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function textResponse(response: Prisma.JsonValue | null): string | undefined {
  if (typeof response === "string") return response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const value = (response as Record<string, Prisma.JsonValue>).text;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function gradeObjectiveAnswer(
  answer: Awaited<ReturnType<typeof evaluationForActor>>["attempt"]["answers"][number],
) {
  const version = answer.assessmentItem.problemVersion;
  const type = version.problem.type;
  const points = answer.assessmentItem.points;
  if (type === ProblemType.SINGLE_CHOICE || type === ProblemType.MULTIPLE_CHOICE) {
    const correct = version.options
      .filter((option) => option.isCorrect)
      .map((option) => option.id)
      .sort();
    const selected = [...new Set(selectedOptions(answer.response))].sort();
    const matches =
      correct.length === selected.length &&
      correct.every((optionId, index) => optionId === selected[index]);
    return {
      score: matches ? points : new Prisma.Decimal(0),
      feedback: matches ? "Correct" : "Incorrect",
    };
  }
  if (type === ProblemType.SHORT_TEXT) {
    const config = version.answerConfig;
    if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
    const record = config as Record<string, Prisma.JsonValue>;
    if (!Array.isArray(record.acceptedAnswers)) return undefined;
    const accepted = record.acceptedAnswers.filter(
      (item): item is string => typeof item === "string",
    );
    const submitted = textResponse(answer.response);
    if (submitted === undefined) return { score: new Prisma.Decimal(0), feedback: "No answer" };
    const caseSensitive = record.caseSensitive === true;
    const normalize = (value: string) =>
      caseSensitive ? value.trim() : value.trim().toLocaleLowerCase();
    const matches = accepted.map(normalize).includes(normalize(submitted));
    return {
      score: matches ? points : new Prisma.Decimal(0),
      feedback: matches ? "Correct" : "Incorrect",
    };
  }
  return undefined;
}

export async function listEvaluations(query: EvaluationListQuery, actor: EvaluationActor) {
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.EvaluationWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    attempt: {
      ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
      assessment: query.companyId
        ? { companyId: query.companyId }
        : companyIds
          ? { companyId: { in: companyIds } }
          : {},
    },
  };
  const [items, total] = await prisma.$transaction([
    prisma.evaluation.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "asc" },
      include: {
        attempt: {
          include: {
            candidate: { select: { id: true, email: true, displayName: true } },
            assessment: { select: { id: true, companyId: true, title: true } },
            _count: { select: { answers: true } },
          },
        },
      },
    }),
    prisma.evaluation.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export function getEvaluation(id: string, actor: EvaluationActor) {
  return evaluationForActor(id, actor);
}

export async function runAutomaticGrading(id: string, actor: EvaluationActor) {
  const evaluation = await evaluationForActor(id, actor);
  if (evaluation.status === EvaluationStatus.COMPLETED) {
    throw new AppError(409, "EVALUATION_COMPLETED", "A completed evaluation cannot be changed");
  }
  let autoScore = new Prisma.Decimal(0);
  let gradedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const answer of evaluation.attempt.answers) {
      const grade = gradeObjectiveAnswer(answer);
      if (!grade) continue;
      autoScore = autoScore.add(grade.score);
      gradedCount += 1;
      await tx.answer.update({
        where: { id: answer.id },
        data: {
          score: grade.score,
          feedback: grade.feedback,
          isAutoGraded: true,
          gradedById: null,
          gradedAt: new Date(),
        },
      });
    }
    await tx.evaluation.update({
      where: { id },
      data: {
        status: EvaluationStatus.IN_PROGRESS,
        autoScore,
        startedAt: evaluation.startedAt ?? new Date(),
      },
    });
    await tx.attempt.updateMany({
      where: {
        id: evaluation.attemptId,
        status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] },
      },
      data: { status: AttemptStatus.EVALUATING, lockVersion: { increment: 1 } },
    });
  });
  return { evaluation: await evaluationForActor(id, actor), gradedCount };
}

export async function gradeAnswer(
  evaluationId: string,
  answerId: string,
  input: GradeAnswerInput,
  actor: EvaluationActor,
) {
  const evaluation = await evaluationForActor(evaluationId, actor);
  if (evaluation.status === EvaluationStatus.COMPLETED) {
    throw new AppError(409, "EVALUATION_COMPLETED", "A completed evaluation cannot be changed");
  }
  const answer = evaluation.attempt.answers.find((item) => item.id === answerId);
  if (!answer) throw new AppError(404, "ANSWER_NOT_FOUND", "Answer not found in this evaluation");
  if (new Prisma.Decimal(input.score).greaterThan(answer.assessmentItem.points)) {
    throw new AppError(400, "SCORE_EXCEEDS_POINTS", "Score cannot exceed the question points");
  }
  await prisma.$transaction([
    prisma.answer.update({
      where: { id: answer.id },
      data: {
        score: input.score,
        feedback: input.feedback ?? null,
        isAutoGraded: false,
        gradedById: actor.actorId,
        gradedAt: new Date(),
      },
    }),
    prisma.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: EvaluationStatus.IN_PROGRESS,
        evaluatorId: actor.actorId,
        startedAt: evaluation.startedAt ?? new Date(),
      },
    }),
    prisma.attempt.updateMany({
      where: {
        id: evaluation.attemptId,
        status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] },
      },
      data: { status: AttemptStatus.EVALUATING, lockVersion: { increment: 1 } },
    }),
  ]);
  return evaluationForActor(evaluationId, actor);
}

export async function finalizeEvaluation(
  id: string,
  notes: string | undefined,
  actor: EvaluationActor,
) {
  const evaluation = await evaluationForActor(id, actor);
  if (evaluation.status === EvaluationStatus.COMPLETED) return evaluation;
  const unansweredItems = await prisma.assessmentItem.findMany({
    where: {
      assessmentId: evaluation.attempt.assessmentId,
      answers: { none: { attemptId: evaluation.attemptId } },
    },
    select: { id: true },
  });
  const ungraded = evaluation.attempt.answers.filter((answer) => answer.score === null);
  if (ungraded.length > 0) {
    throw new AppError(
      409,
      "ANSWERS_REQUIRE_GRADING",
      `${ungraded.length} submitted answer(s) still require grading`,
    );
  }
  const finalScore = evaluation.attempt.answers.reduce(
    (total, answer) => total.add(answer.score ?? 0),
    new Prisma.Decimal(0),
  );
  const maximumScore = evaluation.attempt.maximumScore;
  const percentage = maximumScore.isZero()
    ? new Prisma.Decimal(0)
    : finalScore.div(maximumScore).mul(100).toDecimalPlaces(2);
  const passed = percentage.greaterThanOrEqualTo(evaluation.attempt.assessment.passPercentage);
  const autoScore = evaluation.attempt.answers
    .filter((answer) => answer.isAutoGraded)
    .reduce((total, answer) => total.add(answer.score ?? 0), new Prisma.Decimal(0));
  const manualScore = finalScore.sub(autoScore);

  await prisma.$transaction(async (tx) => {
    await tx.evaluation.update({
      where: { id },
      data: {
        evaluatorId: actor.actorId,
        status: EvaluationStatus.COMPLETED,
        autoScore,
        manualScore,
        finalScore,
        notes: notes ?? evaluation.notes,
        finalizedAt: new Date(),
      },
    });
    await tx.attempt.update({
      where: { id: evaluation.attemptId },
      data: {
        status: AttemptStatus.SCORED,
        totalScore: finalScore,
        percentage,
        passed,
        lockVersion: { increment: 1 },
      },
    });
    await tx.result.upsert({
      where: { attemptId: evaluation.attemptId },
      create: {
        attemptId: evaluation.attemptId,
        score: finalScore,
        maximumScore,
        percentage,
        passed,
        summary: unansweredItems.length
          ? `${unansweredItems.length} unanswered question(s) received zero points.`
          : null,
      },
      update: { score: finalScore, maximumScore, percentage, passed },
    });
  });
  return evaluationForActor(id, actor);
}

import {
  AssessmentStatus,
  AttemptStatus,
  CandidateStageStatus,
  EvaluationStatus,
  InvitationStatus,
  Prisma,
  ProblemType,
} from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashOpaqueToken } from "../auth/token.service.js";
import type { SaveAnswerInput } from "./attempt.validation.js";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function candidateAttemptInclude() {
  return {
    assessment: {
      select: {
        id: true,
        title: true,
        description: true,
        instructions: true,
        durationMinutes: true,
        totalPoints: true,
        passPercentage: true,
        items: {
          orderBy: { order: "asc" as const },
          select: {
            id: true,
            points: true,
            order: true,
            problemVersion: {
              select: {
                id: true,
                prompt: true,
                starterCode: true,
                allowedLanguages: true,
                problem: { select: { id: true, title: true, type: true, difficulty: true } },
                options: {
                  orderBy: { order: "asc" as const },
                  select: { id: true, label: true, content: true, order: true },
                },
                testCases: {
                  where: { isHidden: false },
                  orderBy: { order: "asc" as const },
                  select: { id: true, input: true, expectedOutput: true, order: true },
                },
              },
            },
          },
        },
      },
    },
    answers: {
      select: {
        id: true,
        assessmentItemId: true,
        response: true,
        sourceCode: true,
        language: true,
        updatedAt: true,
      },
    },
  } satisfies Prisma.AttemptInclude;
}

async function autoSubmitIfExpired(attempt: {
  id: string;
  status: AttemptStatus;
  expiresAt: Date;
}): Promise<boolean> {
  if (attempt.status !== AttemptStatus.IN_PROGRESS || attempt.expiresAt > new Date()) return false;
  const updated = await prisma.attempt.updateMany({
    where: { id: attempt.id, status: AttemptStatus.IN_PROGRESS, expiresAt: { lte: new Date() } },
    data: {
      status: AttemptStatus.AUTO_SUBMITTED,
      submittedAt: new Date(),
      lockVersion: { increment: 1 },
    },
  });
  if (updated.count === 1) {
    await prisma.evaluation.upsert({
      where: { attemptId: attempt.id },
      create: { attemptId: attempt.id, status: EvaluationStatus.PENDING },
      update: {},
    });
    const link = await prisma.invitation.findFirst({
      where: { attempt: { id: attempt.id } },
      select: { candidateStageProgressId: true },
    });
    if (link?.candidateStageProgressId) {
      await prisma.candidateStageProgress.update({
        where: { id: link.candidateStageProgressId },
        data: { status: CandidateStageStatus.AWAITING_REVIEW },
      });
    }
    return true;
  }
  return false;
}

export async function startAttempt(invitationToken: string, candidateId: string) {
  const now = new Date();
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashOpaqueToken(invitationToken) },
    include: {
      assessment: {
        select: {
          id: true,
          status: true,
          durationMinutes: true,
          totalPoints: true,
          availableFrom: true,
          availableUntil: true,
          deletedAt: true,
        },
      },
      attempt: { select: { id: true } },
    },
  });
  if (!invitation || invitation.candidateId !== candidateId) {
    throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  if (invitation.attempt) return getCandidateAttempt(invitation.attempt.id, candidateId);
  if (invitation.status !== InvitationStatus.PENDING || invitation.expiresAt <= now) {
    if (invitation.status === InvitationStatus.PENDING) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
    }
    throw new AppError(409, "INVITATION_UNAVAILABLE", "Invitation is no longer available");
  }
  const assessment = invitation.assessment;
  if (assessment.deletedAt || assessment.status !== AssessmentStatus.PUBLISHED) {
    throw new AppError(409, "ASSESSMENT_UNAVAILABLE", "Assessment is not available");
  }
  if (assessment.availableFrom && assessment.availableFrom > now) {
    throw new AppError(409, "ASSESSMENT_NOT_OPEN", "Assessment has not opened yet");
  }
  if (assessment.availableUntil && assessment.availableUntil <= now) {
    throw new AppError(409, "ASSESSMENT_CLOSED", "Assessment is closed");
  }

  const durationEnd = new Date(now.getTime() + assessment.durationMinutes * 60_000);
  const expiresAt = [durationEnd, invitation.expiresAt, assessment.availableUntil]
    .filter((value): value is Date => Boolean(value))
    .reduce((earliest, value) => (value < earliest ? value : earliest), durationEnd);

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: { status: InvitationStatus.STARTED, startedAt: now },
      });
      if (claimed.count !== 1) {
        throw new AppError(409, "INVITATION_ALREADY_STARTED", "Invitation was already started");
      }
      return tx.attempt.create({
        data: {
          invitationId: invitation.id,
          assessmentId: assessment.id,
          candidateId,
          startedAt: now,
          expiresAt,
          maximumScore: assessment.totalPoints,
        },
      });
    });
    if (invitation.candidateStageProgressId) {
      await prisma.candidateStageProgress.update({
        where: { id: invitation.candidateStageProgressId },
        data: { status: CandidateStageStatus.IN_PROGRESS, startedAt: now },
      });
    }
    return getCandidateAttempt(attempt.id, candidateId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.attempt.findUnique({
        where: { invitationId: invitation.id },
        select: { id: true },
      });
      if (existing) return getCandidateAttempt(existing.id, candidateId);
    }
    throw error;
  }
}

export async function getCandidateAttempt(attemptId: string, candidateId: string) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, candidateId },
    include: candidateAttemptInclude(),
  });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (await autoSubmitIfExpired(attempt)) {
    return prisma.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: candidateAttemptInclude(),
    });
  }
  return attempt;
}

export async function saveAnswer(
  attemptId: string,
  assessmentItemId: string,
  input: SaveAnswerInput,
  candidateId: string,
) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, candidateId },
    select: { id: true, status: true, expiresAt: true, assessmentId: true },
  });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (await autoSubmitIfExpired(attempt)) {
    throw new AppError(409, "ATTEMPT_EXPIRED", "Attempt time has expired and was submitted");
  }
  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    throw new AppError(409, "ATTEMPT_NOT_EDITABLE", "Submitted attempts cannot be changed");
  }
  const item = await prisma.assessmentItem.findFirst({
    where: { id: assessmentItemId, assessmentId: attempt.assessmentId },
    select: { id: true, problemVersion: { select: { problem: { select: { type: true } } } } },
  });
  if (!item) throw new AppError(404, "ASSESSMENT_ITEM_NOT_FOUND", "Assessment item not found");
  const type = item.problemVersion.problem.type;
  if (type === ProblemType.CODE && input.sourceCode === undefined) {
    throw new AppError(400, "SOURCE_CODE_REQUIRED", "A code answer requires sourceCode");
  }
  if (type !== ProblemType.CODE && input.response === undefined) {
    throw new AppError(400, "RESPONSE_REQUIRED", "This question requires a response");
  }
  return prisma.answer.upsert({
    where: { attemptId_assessmentItemId: { attemptId, assessmentItemId } },
    create: {
      attemptId,
      assessmentItemId,
      ...(input.response !== undefined ? { response: asJson(input.response) } : {}),
      sourceCode: input.sourceCode ?? null,
      language: input.language ?? null,
    },
    update: {
      ...(input.response !== undefined ? { response: asJson(input.response) } : {}),
      ...(input.sourceCode !== undefined ? { sourceCode: input.sourceCode } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
    },
    select: {
      id: true,
      assessmentItemId: true,
      response: true,
      sourceCode: true,
      language: true,
      updatedAt: true,
    },
  });
}

export async function submitAttempt(attemptId: string, candidateId: string) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, candidateId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    return getCandidateAttempt(attempt.id, candidateId);
  }
  const now = new Date();
  const status = attempt.expiresAt <= now ? AttemptStatus.AUTO_SUBMITTED : AttemptStatus.SUBMITTED;
  await prisma.$transaction(async (tx) => {
    const submitted = await tx.attempt.updateMany({
      where: { id: attempt.id, status: AttemptStatus.IN_PROGRESS },
      data: { status, submittedAt: now, lockVersion: { increment: 1 } },
    });
    if (submitted.count === 1) {
      await tx.evaluation.create({
        data: { attemptId: attempt.id, status: EvaluationStatus.PENDING },
      });
      const linkedInvitation = await tx.invitation.findUnique({
        where: {
          id: (await tx.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).invitationId,
        },
        select: { candidateStageProgressId: true },
      });
      if (linkedInvitation?.candidateStageProgressId) {
        await tx.candidateStageProgress.update({
          where: { id: linkedInvitation.candidateStageProgressId },
          data: { status: CandidateStageStatus.AWAITING_REVIEW },
        });
      }
    }
  });
  return getCandidateAttempt(attempt.id, candidateId);
}

export async function autoSubmitForTabChange(attemptId: string, candidateId: string) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, candidateId },
    select: { id: true, status: true },
  });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    return getCandidateAttempt(attempt.id, candidateId);
  }

  await prisma.$transaction(async (tx) => {
    const submitted = await tx.attempt.updateMany({
      where: { id: attempt.id, candidateId, status: AttemptStatus.IN_PROGRESS },
      data: {
        status: AttemptStatus.AUTO_SUBMITTED,
        submittedAt: new Date(),
        lockVersion: { increment: 1 },
      },
    });
    if (submitted.count === 1) {
      await tx.evaluation.create({
        data: {
          attemptId: attempt.id,
          status: EvaluationStatus.PENDING,
          notes: "Automatically submitted because the candidate changed tabs or hid the page.",
        },
      });
      const link = await tx.invitation.findFirst({
        where: { attempt: { id: attempt.id } },
        select: { candidateStageProgressId: true },
      });
      if (link?.candidateStageProgressId) {
        await tx.candidateStageProgress.update({
          where: { id: link.candidateStageProgressId },
          data: { status: CandidateStageStatus.AWAITING_REVIEW },
        });
      }
    }
  });
  return getCandidateAttempt(attempt.id, candidateId);
}

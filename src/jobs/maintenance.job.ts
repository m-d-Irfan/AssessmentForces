import { randomBytes } from "node:crypto";
import {
  AttemptStatus,
  CandidateStageStatus,
  EvaluationStatus,
  InvitationStatus,
  ProgramInvitationStatus,
} from "@prisma/client";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ensureRedisConnection, redis } from "../config/redis.js";

type MaintenanceRun = {
  startedAt: string;
  finishedAt?: string;
  expiredAssessmentInvitations: number;
  expiredProgramInvitations: number;
  autoSubmittedAttempts: number;
  recoveredEvaluations: number;
  error?: string;
};

let interval: NodeJS.Timeout | undefined;
let running = false;
let lastRun: MaintenanceRun | undefined;

const lockKey = `${env.NODE_ENV}:jobs:maintenance`;

async function releaseLock(token: string): Promise<void> {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    lockKey,
    token,
  );
}

async function expireInvitations(now: Date) {
  const [assessment, program] = await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { status: InvitationStatus.PENDING, expiresAt: { lte: now } },
      data: { status: InvitationStatus.EXPIRED },
    }),
    prisma.programInvitation.updateMany({
      where: { status: ProgramInvitationStatus.PENDING, expiresAt: { lte: now } },
      data: { status: ProgramInvitationStatus.EXPIRED },
    }),
  ]);
  return { assessment: assessment.count, program: program.count };
}

async function autoSubmitExpiredAttempts(now: Date): Promise<number> {
  const attempts = await prisma.attempt.findMany({
    where: { status: AttemptStatus.IN_PROGRESS, expiresAt: { lte: now } },
    take: env.MAINTENANCE_JOB_BATCH_SIZE,
    orderBy: { expiresAt: "asc" },
    select: {
      id: true,
      invitation: { select: { candidateStageProgressId: true } },
    },
  });
  let processed = 0;
  for (const attempt of attempts) {
    const changed = await prisma.$transaction(async (tx) => {
      const submitted = await tx.attempt.updateMany({
        where: { id: attempt.id, status: AttemptStatus.IN_PROGRESS, expiresAt: { lte: now } },
        data: {
          status: AttemptStatus.AUTO_SUBMITTED,
          submittedAt: now,
          lockVersion: { increment: 1 },
        },
      });
      if (submitted.count === 0) return false;
      await tx.evaluation.upsert({
        where: { attemptId: attempt.id },
        create: {
          attemptId: attempt.id,
          status: EvaluationStatus.PENDING,
          notes: "Automatically submitted by the maintenance job after the deadline.",
        },
        update: {},
      });
      if (attempt.invitation.candidateStageProgressId) {
        await tx.candidateStageProgress.update({
          where: { id: attempt.invitation.candidateStageProgressId },
          data: { status: CandidateStageStatus.AWAITING_REVIEW },
        });
      }
      return true;
    });
    if (changed) processed += 1;
  }
  return processed;
}

async function recoverMissingEvaluations(): Promise<number> {
  const attempts = await prisma.attempt.findMany({
    where: {
      status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] },
      evaluation: null,
    },
    take: env.MAINTENANCE_JOB_BATCH_SIZE,
    orderBy: { submittedAt: "asc" },
    select: { id: true, invitation: { select: { candidateStageProgressId: true } } },
  });
  for (const attempt of attempts) {
    await prisma.$transaction(async (tx) => {
      await tx.evaluation.upsert({
        where: { attemptId: attempt.id },
        create: {
          attemptId: attempt.id,
          status: EvaluationStatus.PENDING,
          notes: "Recovered automatically after an interrupted submission workflow.",
        },
        update: {},
      });
      if (attempt.invitation.candidateStageProgressId) {
        await tx.candidateStageProgress.updateMany({
          where: {
            id: attempt.invitation.candidateStageProgressId,
            status: {
              in: [
                CandidateStageStatus.AVAILABLE,
                CandidateStageStatus.SCHEDULED,
                CandidateStageStatus.IN_PROGRESS,
              ],
            },
          },
          data: { status: CandidateStageStatus.AWAITING_REVIEW },
        });
      }
    });
  }
  return attempts.length;
}

export async function runMaintenanceJob(): Promise<void> {
  if (!env.MAINTENANCE_JOBS_ENABLED || running) return;
  running = true;
  const token = randomBytes(16).toString("hex");
  let acquired = false;
  const run: MaintenanceRun = {
    startedAt: new Date().toISOString(),
    expiredAssessmentInvitations: 0,
    expiredProgramInvitations: 0,
    autoSubmittedAttempts: 0,
    recoveredEvaluations: 0,
  };
  try {
    await ensureRedisConnection();
    acquired = Boolean(
      await redis.set(
        lockKey,
        token,
        "PX",
        Math.max(env.MAINTENANCE_JOB_INTERVAL_MS * 2, 60_000),
        "NX",
      ),
    );
    if (!acquired) return;
    const now = new Date();
    const expired = await expireInvitations(now);
    run.expiredAssessmentInvitations = expired.assessment;
    run.expiredProgramInvitations = expired.program;
    run.autoSubmittedAttempts = await autoSubmitExpiredAttempts(now);
    run.recoveredEvaluations = await recoverMissingEvaluations();
    run.finishedAt = new Date().toISOString();
    lastRun = run;
    logger.info({ maintenance: run }, "Maintenance job completed");
  } catch (error) {
    run.finishedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : "Unknown maintenance error";
    lastRun = run;
    logger.error({ err: error }, "Maintenance job failed");
  } finally {
    if (acquired) {
      try {
        await releaseLock(token);
      } catch (error) {
        logger.warn({ err: error }, "Maintenance lock release failed");
      }
    }
    running = false;
  }
}

export function startMaintenanceJobs(): void {
  if (!env.MAINTENANCE_JOBS_ENABLED || interval) return;
  void runMaintenanceJob();
  interval = setInterval(() => void runMaintenanceJob(), env.MAINTENANCE_JOB_INTERVAL_MS);
  interval.unref();
  logger.info({ intervalMs: env.MAINTENANCE_JOB_INTERVAL_MS }, "Maintenance jobs started");
}

export function stopMaintenanceJobs(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
}

export function maintenanceJobStatus() {
  if (!lastRun) return { enabled: env.MAINTENANCE_JOBS_ENABLED, running, lastRun: null };
  const { error, ...publicRun } = lastRun;
  return {
    enabled: env.MAINTENANCE_JOBS_ENABLED,
    running,
    lastRun: { ...publicRun, succeeded: !error },
  };
}

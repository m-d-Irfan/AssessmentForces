import { AttemptStatus, InvitationStatus, PaymentStatus, type UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { ensureRedisConnection, redis } from "../../config/redis.js";
import { requireCompanyAccess } from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";

type AnalyticsActor = { actorId: string; role: UserRole };

function groupCount(group: {
  _count: true | ({ _all?: number | undefined } & Record<string, number | undefined>) | undefined;
}): number {
  return typeof group._count === "object" ? (group._count._all ?? 0) : 0;
}

async function cached<T>(key: string, build: () => Promise<T>): Promise<T> {
  try {
    await ensureRedisConnection();
    const value = await redis.get<string>(key);
    if (value) return JSON.parse(value) as T;
  } catch (error) {
    logger.warn({ err: error, key }, "Analytics cache read failed");
  }
  const value = await build();
  try {
    await ensureRedisConnection();
    await redis.set(key, JSON.stringify(value), { ex: 60 });
  } catch (error) {
    logger.warn({ err: error, key }, "Analytics cache write failed");
  }
  return value;
}

export async function getCompanyDashboard(companyId: string, actor: AnalyticsActor) {
  await requireCompanyAccess(actor.actorId, actor.role, companyId);
  return cached(`analytics:company:${companyId}`, async () => {
    const [
      company,
      problemCount,
      assessmentCount,
      publishedAssessmentCount,
      invitationCount,
      pendingInvitationCount,
      completedAttemptCount,
      resultStats,
      creditBalance,
      completedPayments,
      recentAttempts,
    ] = await prisma.$transaction([
      prisma.company.findFirst({
        where: { id: companyId, deletedAt: null },
        select: { id: true, name: true, slug: true, status: true },
      }),
      prisma.problem.count({ where: { companyId, deletedAt: null } }),
      prisma.assessment.count({ where: { companyId, deletedAt: null } }),
      prisma.assessment.count({ where: { companyId, deletedAt: null, status: "PUBLISHED" } }),
      prisma.invitation.count({ where: { assessment: { companyId } } }),
      prisma.invitation.count({
        where: { assessment: { companyId }, status: InvitationStatus.PENDING },
      }),
      prisma.attempt.count({
        where: {
          assessment: { companyId },
          status: { in: [AttemptStatus.SCORED, AttemptStatus.RESULT_RELEASED] },
        },
      }),
      prisma.result.aggregate({
        where: { attempt: { assessment: { companyId } } },
        _count: { id: true },
        _avg: { percentage: true },
      }),
      prisma.companyCreditBalance.findUnique({ where: { companyId } }),
      prisma.payment.aggregate({
        where: { companyId, status: PaymentStatus.COMPLETED },
        _sum: { amount: true, credits: true },
        _count: { id: true },
      }),
      prisma.attempt.findMany({
        where: { assessment: { companyId } },
        take: 5,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          status: true,
          percentage: true,
          passed: true,
          updatedAt: true,
          candidate: { select: { id: true, displayName: true } },
          assessment: { select: { id: true, title: true } },
        },
      }),
    ]);
    if (!company) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found");
    const passedResults = await prisma.result.count({
      where: { attempt: { assessment: { companyId } }, passed: true },
    });
    const resultCount = resultStats._count.id;
    return {
      company,
      totals: {
        problems: problemCount,
        assessments: assessmentCount,
        publishedAssessments: publishedAssessmentCount,
        invitations: invitationCount,
        pendingInvitations: pendingInvitationCount,
        completedAttempts: completedAttemptCount,
      },
      performance: {
        gradedResults: resultCount,
        averagePercentage: resultStats._avg.percentage,
        passedResults,
        passRate: resultCount ? Number(((passedResults / resultCount) * 100).toFixed(2)) : 0,
      },
      credits: { available: creditBalance?.availableCredits ?? 0 },
      purchases: {
        completedPayments: completedPayments._count.id,
        purchasedCredits: completedPayments._sum.credits ?? 0,
        totalSpent: completedPayments._sum.amount ?? 0,
        currency: "BDT",
      },
      recentAttempts,
    };
  });
}

export async function getAssessmentAnalytics(assessmentId: string, actor: AnalyticsActor) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, deletedAt: null },
    select: { id: true, companyId: true, title: true, totalPoints: true, passPercentage: true },
  });
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  await requireCompanyAccess(actor.actorId, actor.role, assessment.companyId);
  return cached(`analytics:assessment:${assessmentId}`, async () => {
    const [invitationGroups, attemptGroups, resultStats, passed, recentResults] =
      await prisma.$transaction([
        prisma.invitation.groupBy({
          by: ["status"],
          where: { assessmentId },
          orderBy: { status: "asc" },
          _count: { _all: true },
        }),
        prisma.attempt.groupBy({
          by: ["status"],
          where: { assessmentId },
          orderBy: { status: "asc" },
          _count: { _all: true },
        }),
        prisma.result.aggregate({
          where: { attempt: { assessmentId } },
          _count: { id: true },
          _avg: { score: true, percentage: true },
          _min: { percentage: true },
          _max: { percentage: true },
        }),
        prisma.result.count({ where: { attempt: { assessmentId }, passed: true } }),
        prisma.result.findMany({
          where: { attempt: { assessmentId } },
          take: 10,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            score: true,
            percentage: true,
            passed: true,
            releasedAt: true,
            attempt: { select: { candidate: { select: { id: true, displayName: true } } } },
          },
        }),
      ]);
    const total = resultStats._count.id;
    return {
      assessment,
      invitationsByStatus: Object.fromEntries(
        invitationGroups.map((group) => [group.status, groupCount(group)]),
      ),
      attemptsByStatus: Object.fromEntries(
        attemptGroups.map((group) => [group.status, groupCount(group)]),
      ),
      performance: {
        results: total,
        passed,
        failed: total - passed,
        passRate: total ? Number(((passed / total) * 100).toFixed(2)) : 0,
        averageScore: resultStats._avg.score,
        averagePercentage: resultStats._avg.percentage,
        lowestPercentage: resultStats._min.percentage,
        highestPercentage: resultStats._max.percentage,
      },
      recentResults,
    };
  });
}

export async function getCandidateDashboard(candidateId: string) {
  return cached(`analytics:candidate:${candidateId}`, async () => {
    const [invitationGroups, attemptGroups, resultStats, passed, recentResults] =
      await prisma.$transaction([
        prisma.invitation.groupBy({
          by: ["status"],
          where: { candidateId },
          orderBy: { status: "asc" },
          _count: { _all: true },
        }),
        prisma.attempt.groupBy({
          by: ["status"],
          where: { candidateId },
          orderBy: { status: "asc" },
          _count: { _all: true },
        }),
        prisma.result.aggregate({
          where: { attempt: { candidateId }, releasedAt: { not: null } },
          _count: { id: true },
          _avg: { percentage: true },
          _max: { percentage: true },
        }),
        prisma.result.count({
          where: { attempt: { candidateId }, releasedAt: { not: null }, passed: true },
        }),
        prisma.result.findMany({
          where: { attempt: { candidateId }, releasedAt: { not: null } },
          take: 5,
          orderBy: { releasedAt: "desc" },
          select: {
            id: true,
            percentage: true,
            passed: true,
            releasedAt: true,
            attempt: {
              select: {
                assessment: {
                  select: { id: true, title: true, company: { select: { name: true } } },
                },
              },
            },
          },
        }),
      ]);
    const results = resultStats._count.id;
    return {
      invitationsByStatus: Object.fromEntries(
        invitationGroups.map((group) => [group.status, groupCount(group)]),
      ),
      attemptsByStatus: Object.fromEntries(
        attemptGroups.map((group) => [group.status, groupCount(group)]),
      ),
      performance: {
        releasedResults: results,
        passed,
        passRate: results ? Number(((passed / results) * 100).toFixed(2)) : 0,
        averagePercentage: resultStats._avg.percentage,
        highestPercentage: resultStats._max.percentage,
      },
      recentResults,
    };
  });
}

export async function getAdminDashboard() {
  return cached("analytics:admin", async () => {
    const [users, companies, assessments, attempts, completedPayments, revenue] =
      await prisma.$transaction([
        prisma.user.groupBy({
          by: ["role"],
          where: { deletedAt: null },
          orderBy: { role: "asc" },
          _count: { _all: true },
        }),
        prisma.company.count({ where: { deletedAt: null } }),
        prisma.assessment.count({ where: { deletedAt: null } }),
        prisma.attempt.count(),
        prisma.payment.count({ where: { status: PaymentStatus.COMPLETED } }),
        prisma.payment.aggregate({
          where: { status: PaymentStatus.COMPLETED },
          _sum: { amount: true, credits: true },
        }),
      ]);
    return {
      usersByRole: Object.fromEntries(users.map((group) => [group.role, groupCount(group)])),
      totals: { companies, assessments, attempts, completedPayments },
      revenue: {
        amount: revenue._sum.amount ?? 0,
        creditsSold: revenue._sum.credits ?? 0,
        currency: "BDT",
      },
    };
  });
}

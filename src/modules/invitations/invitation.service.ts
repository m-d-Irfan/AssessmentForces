import { randomUUID } from "node:crypto";
import { AssessmentStatus, InvitationStatus, Prisma, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { sendAssessmentInvitationEmail } from "../../integrations/email/email.service.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { createAuditLog } from "../audit-logs/audit.service.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/token.service.js";
import type {
  CandidateInvitationListQuery,
  CreateInvitationInput,
  InvitationListQuery,
} from "./invitation.validation.js";

export type InvitationActor = {
  actorId: string;
  role: UserRole;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

const invitationInclude = {
  assessment: {
    select: {
      id: true,
      title: true,
      durationMinutes: true,
      totalPoints: true,
      availableFrom: true,
      availableUntil: true,
      company: { select: { id: true, name: true, slug: true } },
    },
  },
  candidate: { select: { id: true, email: true, displayName: true } },
  invitedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.InvitationInclude;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function expirePendingInvitations(): Promise<void> {
  await prisma.invitation.updateMany({
    where: { status: InvitationStatus.PENDING, expiresAt: { lte: new Date() } },
    data: { status: InvitationStatus.EXPIRED },
  });
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new AppError(409, "INVITATION_CONFLICT", "Invitation could not be processed safely");
}

export async function createInvitation(input: CreateInvitationInput, actor: InvitationActor) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: input.assessmentId, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      title: true,
      status: true,
      availableUntil: true,
    },
  });
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  await requireCompanyAccess(actor.actorId, actor.role, assessment.companyId);
  if (assessment.status !== AssessmentStatus.PUBLISHED) {
    throw new AppError(
      409,
      "ASSESSMENT_NOT_PUBLISHED",
      "Only published assessments can accept invitations",
    );
  }
  if (assessment.availableUntil && input.expiresAt > assessment.availableUntil) {
    throw new AppError(
      400,
      "INVALID_INVITATION_EXPIRY",
      "Invitation cannot expire after the assessment closes",
    );
  }
  const candidate = await prisma.user.findFirst({
    where: {
      email: input.candidateEmail,
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true, email: true },
  });
  if (!candidate) {
    throw new AppError(
      404,
      "CANDIDATE_NOT_FOUND",
      "An active candidate account with this email was not found",
    );
  }

  const token = createOpaqueToken(32);
  const invitationId = randomUUID();
  const invitation = await serializable(async (tx) => {
    const duplicate = await tx.invitation.findUnique({
      where: {
        assessmentId_candidateId: {
          assessmentId: assessment.id,
          candidateId: candidate.id,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError(
        409,
        "INVITATION_ALREADY_EXISTS",
        "This candidate has already been invited to the assessment",
      );
    }
    const debited = await tx.companyCreditBalance.updateMany({
      where: { companyId: assessment.companyId, availableCredits: { gte: 1 } },
      data: { availableCredits: { decrement: 1 }, lockVersion: { increment: 1 } },
    });
    if (debited.count !== 1) {
      throw new AppError(
        402,
        "INSUFFICIENT_CREDITS",
        "Purchase more credits before inviting a candidate",
      );
    }
    const balance = await tx.companyCreditBalance.findUniqueOrThrow({
      where: { companyId: assessment.companyId },
    });
    const ledger = await tx.creditLedger.create({
      data: {
        companyId: assessment.companyId,
        createdById: actor.actorId,
        type: "INVITATION_DEBIT",
        amount: -1,
        balanceAfter: balance.availableCredits,
        reference: `invitation:${invitationId}:debit`,
        metadata: asJson({ assessmentId: assessment.id, candidateId: candidate.id }),
      },
    });
    const created = await tx.invitation.create({
      data: {
        id: invitationId,
        assessmentId: assessment.id,
        candidateId: candidate.id,
        invitedById: actor.actorId,
        creditLedgerId: ledger.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: input.expiresAt,
      },
      include: invitationInclude,
    });
    await createAuditLog(
      tx,
      { ...actor, companyId: assessment.companyId },
      {
        action: "INVITATION_CREATED",
        entityType: "Invitation",
        entityId: created.id,
        after: asJson({
          assessmentId: assessment.id,
          candidateId: candidate.id,
          expiresAt: input.expiresAt,
        }),
      },
    );
    return created;
  });

  const invitationUrl = `${env.CANDIDATE_APP_URL}/invitations/${token}`;
  const emailDelivered = await sendAssessmentInvitationEmail(
    candidate.email,
    assessment.title,
    invitationUrl,
    input.expiresAt,
  );
  return {
    invitation,
    emailDelivered,
    ...(env.NODE_ENV !== "production" ? { invitationToken: token } : {}),
  };
}

export async function listInvitations(query: InvitationListQuery, actor: InvitationActor) {
  await expirePendingInvitations();
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.InvitationWhereInput = {
    ...(query.companyId
      ? { assessment: { companyId: query.companyId } }
      : companyIds
        ? { assessment: { companyId: { in: companyIds } } }
        : {}),
    ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.invitation.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: invitationInclude,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getInvitation(id: string, actor: InvitationActor) {
  await expirePendingInvitations();
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: invitationInclude,
  });
  if (!invitation) throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  await requireCompanyAccess(actor.actorId, actor.role, invitation.assessment.company.id);
  return invitation;
}

export async function revokeInvitation(id: string, actor: InvitationActor) {
  const existing = await prisma.invitation.findUnique({
    where: { id },
    include: { assessment: { select: { companyId: true } } },
  });
  if (!existing) throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  await requireCompanyAccess(actor.actorId, actor.role, existing.assessment.companyId);
  if (existing.status !== InvitationStatus.PENDING || existing.expiresAt <= new Date()) {
    throw new AppError(
      409,
      "INVITATION_NOT_REVOCABLE",
      "Only an unexpired pending invitation can be revoked",
    );
  }
  return serializable(async (tx) => {
    const revoked = await tx.invitation.updateMany({
      where: { id, status: InvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new AppError(409, "INVITATION_NOT_REVOCABLE", "Invitation state has already changed");
    }
    const balance = await tx.companyCreditBalance.update({
      where: { companyId: existing.assessment.companyId },
      data: { availableCredits: { increment: 1 }, lockVersion: { increment: 1 } },
    });
    await tx.creditLedger.create({
      data: {
        companyId: existing.assessment.companyId,
        createdById: actor.actorId,
        type: "REFUND",
        amount: 1,
        balanceAfter: balance.availableCredits,
        reference: `invitation:${id}:refund`,
        metadata: asJson({ invitationId: id, reason: "REVOKED_BEFORE_START" }),
      },
    });
    const invitation = await tx.invitation.findUniqueOrThrow({
      where: { id },
      include: invitationInclude,
    });
    await createAuditLog(
      tx,
      { ...actor, companyId: existing.assessment.companyId },
      { action: "INVITATION_REVOKED", entityType: "Invitation", entityId: id },
    );
    return invitation;
  });
}

export async function listCandidateInvitations(
  query: CandidateInvitationListQuery,
  candidateId: string,
) {
  await expirePendingInvitations();
  const where = { candidateId, ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.invitation.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: invitationInclude,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getCandidateInvitationByToken(token: string, candidateId: string) {
  await expirePendingInvitations();
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: invitationInclude,
  });
  if (!invitation || invitation.candidateId !== candidateId) {
    throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new AppError(409, "INVITATION_UNAVAILABLE", "Invitation is no longer available");
  }
  return invitation;
}

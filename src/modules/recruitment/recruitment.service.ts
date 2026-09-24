import {
  AssessmentStatus,
  CandidateApplicationStatus,
  CandidateStageStatus,
  Prisma,
  ProgramInvitationStatus,
  ProgramInvitationType,
  ProgramMemberRole,
  RecruitmentProgramStatus,
  RecruitmentStageType,
  StageDecision,
  UserRole,
  type UserStatus,
} from "@prisma/client";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { sendRecruitmentProgramInvitationEmail } from "../../integrations/email/email.service.js";
import { requireCompanyAccess } from "../../shared/authorization/company-access.js";
import {
  requireLeadRole,
  requireProgramMember,
} from "../../shared/authorization/program-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { decryptPrivateData, encryptPrivateData } from "../../shared/security/private-data.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/token.service.js";
import type {
  CreateProgramInput,
  CreateStageInput,
  InviteToProgramInput,
  ProgramListQuery,
  ScheduleInterviewInput,
  SubmitReviewInput,
  UpdateProgramInput,
} from "./recruitment.validation.js";

export type RecruitmentActor = { actorId: string; role: UserRole };

const programSummaryInclude = {
  company: { select: { id: true, name: true, slug: true } },
  _count: { select: { stages: true, members: true, applications: true } },
} satisfies Prisma.RecruitmentProgramInclude;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function createProgram(input: CreateProgramInput, actor: RecruitmentActor) {
  await requireCompanyAccess(actor.actorId, actor.role, input.companyId);
  return prisma.$transaction(async (tx) => {
    const program = await tx.recruitmentProgram.create({
      data: {
        companyId: input.companyId,
        createdById: actor.actorId,
        title: input.title,
        position: input.position,
        description: input.description ?? null,
        creditCost: input.creditCost,
      },
      include: programSummaryInclude,
    });
    await tx.programMember.create({
      data: {
        programId: program.id,
        userId: actor.actorId,
        role: ProgramMemberRole.LEAD_RECRUITER,
      },
    });
    return program;
  });
}

export async function listPrograms(query: ProgramListQuery, actor: RecruitmentActor) {
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.RecruitmentProgramWhereInput = {
    deletedAt: null,
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(actor.role === UserRole.ADMIN
      ? {}
      : {
          members: {
            some: {
              userId: actor.actorId,
              role: {
                in: [ProgramMemberRole.LEAD_RECRUITER, ProgramMemberRole.TECHNICAL_RECRUITER],
              },
            },
          },
        }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.recruitmentProgram.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: programSummaryInclude,
    }),
    prisma.recruitmentProgram.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getProgramInvitationPreview(token: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const invitation = await prisma.programInvitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: {
      program: {
        select: {
          id: true,
          title: true,
          position: true,
          description: true,
          status: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
      },
    },
  });
  if (
    !user ||
    !invitation ||
    invitation.email !== user.email.toLowerCase() ||
    invitation.status !== ProgramInvitationStatus.PENDING ||
    invitation.expiresAt <= new Date()
  ) {
    throw new AppError(404, "PROGRAM_INVITATION_NOT_FOUND", "Invitation is invalid or expired");
  }
  return invitation;
}

export async function listCandidateApplications(candidateId: string) {
  return prisma.candidateApplication.findMany({
    where: { candidateId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      currentStageId: true,
      appliedAt: true,
      updatedAt: true,
      program: {
        select: {
          id: true,
          title: true,
          position: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      stages: {
        orderBy: { stage: { order: "asc" } },
        select: {
          id: true,
          status: true,
          aggregateScore: true,
          finalDecision: true,
          availableAt: true,
          completedAt: true,
          stage: { select: { id: true, name: true, type: true, order: true } },
          schedules: {
            where: { cancelledAt: null },
            orderBy: { startsAt: "desc" },
            take: 1,
            select: {
              startsAt: true,
              endsAt: true,
              timezone: true,
              meetingUrl: true,
              location: true,
            },
          },
          reviews: { select: { candidateFeedback: true } },
        },
      },
    },
  });
}

export async function getProgram(id: string, actor: RecruitmentActor) {
  const program = await prisma.recruitmentProgram.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      members: {
        include: { user: { select: { id: true, displayName: true, email: true } } },
      },
      stages: {
        orderBy: { order: "asc" },
        include: {
          assignees: { include: { user: { select: { id: true, displayName: true } } } },
          assessment: { select: { id: true, title: true } },
        },
      },
      _count: { select: { applications: true } },
    },
  });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  await requireProgramMember(actor.actorId, actor.role, id, [
    ProgramMemberRole.LEAD_RECRUITER,
    ProgramMemberRole.TECHNICAL_RECRUITER,
  ]);
  return program;
}

export async function listProgramApplications(programId: string, actor: RecruitmentActor) {
  await requireProgramMember(actor.actorId, actor.role, programId, [
    ProgramMemberRole.LEAD_RECRUITER,
    ProgramMemberRole.TECHNICAL_RECRUITER,
  ]);
  return prisma.candidateApplication.findMany({
    where: { programId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      currentStageId: true,
      appliedAt: true,
      updatedAt: true,
      candidate: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      stages: {
        orderBy: { stage: { order: "asc" } },
        select: {
          id: true,
          status: true,
          aggregateScore: true,
          finalDecision: true,
          stage: { select: { id: true, name: true, type: true, order: true } },
        },
      },
    },
  });
}

export async function getProgramApplication(
  programId: string,
  applicationId: string,
  actor: RecruitmentActor,
) {
  const member = await requireProgramMember(actor.actorId, actor.role, programId, [
    ProgramMemberRole.LEAD_RECRUITER,
    ProgramMemberRole.TECHNICAL_RECRUITER,
  ]);
  const application = await prisma.candidateApplication.findFirst({
    where: { id: applicationId, programId },
    include: {
      candidate: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      stages: {
        orderBy: { stage: { order: "asc" } },
        include: {
          stage: { select: { id: true, name: true, type: true, order: true, minimumScore: true } },
          reviews: { include: { reviewer: { select: { id: true, displayName: true } } } },
          schedules: { orderBy: { startsAt: "desc" } },
        },
      },
    },
  });
  if (!application)
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Candidate application not found");
  const canSeePrivate =
    actor.role === UserRole.ADMIN || member?.role === ProgramMemberRole.LEAD_RECRUITER;
  return {
    ...application,
    stages: application.stages.map((progress) => ({
      ...progress,
      reviews: progress.reviews.map((review) => safeReview(review, actor.actorId, canSeePrivate)),
    })),
  };
}

export async function updateProgram(
  id: string,
  input: UpdateProgramInput,
  actor: RecruitmentActor,
) {
  await requireLeadRole(actor.actorId, actor.role, id);
  const program = await prisma.recruitmentProgram.findFirst({ where: { id, deletedAt: null } });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  if (program.status !== RecruitmentProgramStatus.DRAFT) {
    throw new AppError(409, "PROGRAM_LOCKED", "Only draft programs can be edited");
  }
  return prisma.recruitmentProgram.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.creditCost !== undefined ? { creditCost: input.creditCost } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    include: programSummaryInclude,
  });
}

async function validateAssignees(
  programId: string,
  type: RecruitmentStageType,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return;
  const members = await prisma.programMember.findMany({
    where: { programId, userId: { in: userIds } },
    select: { userId: true, role: true },
  });
  if (members.length !== new Set(userIds).size) {
    throw new AppError(400, "INVALID_STAGE_ASSIGNEE", "Every assignee must be a program member");
  }
  const invalid = members.some((member) =>
    type === RecruitmentStageType.HR_INTERVIEW
      ? member.role !== ProgramMemberRole.HR
      : member.role === ProgramMemberRole.HR,
  );
  if (invalid) {
    throw new AppError(
      400,
      "INVALID_STAGE_ASSIGNEE_ROLE",
      "Stage assignee role does not match the stage type",
    );
  }
}

export async function createStage(
  programId: string,
  input: CreateStageInput,
  actor: RecruitmentActor,
) {
  await requireLeadRole(actor.actorId, actor.role, programId);
  const program = await prisma.recruitmentProgram.findFirst({
    where: { id: programId, deletedAt: null },
  });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  if (program.status !== RecruitmentProgramStatus.DRAFT) {
    throw new AppError(409, "STAGES_LOCKED", "Stages cannot be changed after the program starts");
  }
  if (input.type === RecruitmentStageType.CODING_ASSESSMENT) {
    if (!input.assessmentId)
      throw new AppError(400, "ASSESSMENT_REQUIRED", "Coding stages require an assessment");
    const assessment = await prisma.assessment.findFirst({
      where: {
        id: input.assessmentId,
        companyId: program.companyId,
        status: AssessmentStatus.PUBLISHED,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!assessment)
      throw new AppError(
        400,
        "INVALID_ASSESSMENT",
        "A published assessment from this company is required",
      );
  } else if (input.assessmentId) {
    throw new AppError(
      400,
      "ASSESSMENT_NOT_ALLOWED",
      "Only coding stages may reference an assessment",
    );
  }
  await validateAssignees(programId, input.type, input.assigneeIds);
  return prisma.recruitmentStage.create({
    data: {
      programId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      order: input.order,
      assessmentId: input.assessmentId ?? null,
      minimumScore: input.minimumScore ?? null,
      assignees: { create: [...new Set(input.assigneeIds)].map((userId) => ({ userId })) },
    },
    include: { assignees: true },
  });
}

export async function reorderStages(
  programId: string,
  stageIds: string[],
  actor: RecruitmentActor,
) {
  await requireLeadRole(actor.actorId, actor.role, programId);
  const program = await prisma.recruitmentProgram.findFirst({
    where: { id: programId, deletedAt: null },
    include: { stages: { select: { id: true } } },
  });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  if (program.status !== RecruitmentProgramStatus.DRAFT) {
    throw new AppError(409, "STAGES_LOCKED", "Stages cannot be reordered after the program starts");
  }
  const actual = new Set(program.stages.map((stage) => stage.id));
  if (
    stageIds.length !== actual.size ||
    new Set(stageIds).size !== actual.size ||
    stageIds.some((id) => !actual.has(id))
  ) {
    throw new AppError(
      400,
      "INVALID_STAGE_ORDER",
      "The order must include every program stage exactly once",
    );
  }
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < stageIds.length; index += 1) {
      await tx.recruitmentStage.update({
        where: { id: stageIds[index] as string },
        data: { order: -(index + 1) },
      });
    }
    for (let index = 0; index < stageIds.length; index += 1) {
      await tx.recruitmentStage.update({
        where: { id: stageIds[index] as string },
        data: { order: index + 1 },
      });
    }
  });
  return getProgram(programId, actor);
}

export async function updateStageAssignees(
  programId: string,
  stageId: string,
  assigneeIds: string[],
  actor: RecruitmentActor,
) {
  await requireLeadRole(actor.actorId, actor.role, programId);
  const stage = await prisma.recruitmentStage.findFirst({
    where: { id: stageId, programId },
    include: { program: { select: { status: true } } },
  });
  if (!stage) throw new AppError(404, "STAGE_NOT_FOUND", "Recruitment stage not found");
  if (stage.program.status !== RecruitmentProgramStatus.DRAFT) {
    throw new AppError(
      409,
      "STAGES_LOCKED",
      "Stage assignments cannot change after the program starts",
    );
  }
  await validateAssignees(programId, stage.type, assigneeIds);
  await prisma.$transaction([
    prisma.stageAssignee.deleteMany({ where: { stageId } }),
    prisma.stageAssignee.createMany({
      data: [...new Set(assigneeIds)].map((userId) => ({ stageId, userId })),
    }),
  ]);
  return prisma.recruitmentStage.findUniqueOrThrow({
    where: { id: stageId },
    include: { assignees: { include: { user: { select: { id: true, displayName: true } } } } },
  });
}

export async function inviteToProgram(
  programId: string,
  input: InviteToProgramInput,
  actor: RecruitmentActor,
) {
  await requireLeadRole(actor.actorId, actor.role, programId);
  const program = await prisma.recruitmentProgram.findFirst({
    where: { id: programId, deletedAt: null },
  });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  if (
    input.type === ProgramInvitationType.CANDIDATE &&
    program.status !== RecruitmentProgramStatus.ACTIVE
  ) {
    throw new AppError(
      409,
      "PROGRAM_NOT_ACTIVE",
      "Candidates can only be invited to an active program",
    );
  }
  const token = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  const invitation = await prisma.programInvitation.upsert({
    where: { programId_email_type: { programId, email: input.email, type: input.type } },
    create: {
      programId,
      invitedById: actor.actorId,
      email: input.email,
      type: input.type,
      memberRole: input.memberRole ?? null,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    },
    update: {
      invitedById: actor.actorId,
      memberRole: input.memberRole ?? null,
      tokenHash: hashOpaqueToken(token),
      status: ProgramInvitationStatus.PENDING,
      expiresAt,
      acceptedAt: null,
      acceptedById: null,
      revokedAt: null,
    },
  });
  const invitationUrl = `${env.CANDIDATE_APP_URL}/recruitment-invitations/${token}`;
  const emailDelivered = await sendRecruitmentProgramInvitationEmail(
    input.email,
    program.title,
    invitationUrl,
    input.type === ProgramInvitationType.CANDIDATE ? "candidate" : "team member",
  );
  return {
    invitation,
    emailDelivered,
    ...(env.NODE_ENV !== "production" ? { invitationToken: token } : {}),
  };
}

async function activateFirstStage(
  tx: Prisma.TransactionClient,
  applicationId: string,
  candidateId: string,
) {
  const application = await tx.candidateApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      program: { include: { stages: { orderBy: { order: "asc" }, include: { assignees: true } } } },
    },
  });
  const first = application.program.stages[0];
  if (!first) throw new AppError(409, "PROGRAM_HAS_NO_STAGES", "Program has no stages");
  const progress = await tx.candidateStageProgress.update({
    where: { applicationId_stageId: { applicationId, stageId: first.id } },
    data: { status: CandidateStageStatus.AVAILABLE, availableAt: new Date() },
  });
  await tx.candidateApplication.update({
    where: { id: applicationId },
    data: { currentStageId: first.id },
  });
  await tx.notification.createMany({
    data: first.assignees.map((assignee) => ({
      userId: assignee.userId,
      type: "STAGE_READY",
      title: `Candidate ready for ${first.name}`,
      body: "A candidate has entered your assigned recruitment stage.",
      metadata: json({ applicationId, stageProgressId: progress.id, stageId: first.id }),
    })),
  });
  if (first.type === RecruitmentStageType.CODING_ASSESSMENT && first.assessmentId) {
    const assessment = await tx.assessment.findUniqueOrThrow({ where: { id: first.assessmentId } });
    const token = createOpaqueToken(32);
    const expiresAt = assessment.availableUntil ?? new Date(Date.now() + 30 * 86_400_000);
    await tx.invitation.create({
      data: {
        assessmentId: first.assessmentId,
        candidateId,
        invitedById: application.program.createdById,
        candidateStageProgressId: progress.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      },
    });
    await tx.notification.create({
      data: {
        userId: candidateId,
        type: "CODING_STAGE_READY",
        title: first.name,
        body: "Your coding assessment is ready.",
        metadata: json({ applicationId, stageProgressId: progress.id, invitationToken: token }),
      },
    });
  }
}

export async function acceptProgramInvitation(
  token: string,
  user: { id: string; email: string; role: UserRole; status: UserStatus },
) {
  const invitation = await prisma.programInvitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: { program: true },
  });
  if (
    !invitation ||
    invitation.status !== ProgramInvitationStatus.PENDING ||
    invitation.expiresAt <= new Date()
  ) {
    throw new AppError(404, "PROGRAM_INVITATION_NOT_FOUND", "Invitation is invalid or expired");
  }
  if (invitation.email !== user.email.toLowerCase()) {
    throw new AppError(
      403,
      "INVITATION_EMAIL_MISMATCH",
      "Sign in with the email address that received this invitation",
    );
  }
  if (invitation.type === ProgramInvitationType.CANDIDATE && user.role !== UserRole.CANDIDATE) {
    throw new AppError(403, "CANDIDATE_ACCOUNT_REQUIRED", "A candidate account is required");
  }
  if (invitation.type === ProgramInvitationType.MEMBER && user.role === UserRole.CANDIDATE) {
    throw new AppError(403, "RECRUITER_ACCOUNT_REQUIRED", "A recruiter account is required");
  }
  return prisma.$transaction(async (tx) => {
    const accepted = await tx.programInvitation.updateMany({
      where: {
        id: invitation.id,
        status: ProgramInvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: {
        status: ProgramInvitationStatus.ACCEPTED,
        acceptedById: user.id,
        acceptedAt: new Date(),
      },
    });
    if (accepted.count !== 1)
      throw new AppError(409, "INVITATION_ALREADY_USED", "Invitation was already used");
    if (invitation.type === ProgramInvitationType.MEMBER) {
      return tx.programMember.upsert({
        where: { programId_userId: { programId: invitation.programId, userId: user.id } },
        create: {
          programId: invitation.programId,
          userId: user.id,
          role: invitation.memberRole as ProgramMemberRole,
        },
        update: { role: invitation.memberRole as ProgramMemberRole },
      });
    }
    const application = await tx.candidateApplication.create({
      data: {
        programId: invitation.programId,
        candidateId: user.id,
        stages: {
          create: (
            await tx.recruitmentStage.findMany({ where: { programId: invitation.programId } })
          ).map((stage) => ({ stageId: stage.id })),
        },
      },
    });
    await activateFirstStage(tx, application.id, user.id);
    return application;
  });
}

export async function startProgram(programId: string, actor: RecruitmentActor) {
  await requireLeadRole(actor.actorId, actor.role, programId);
  const program = await prisma.recruitmentProgram.findFirst({
    where: { id: programId, deletedAt: null },
    include: { stages: { include: { assignees: true } } },
  });
  if (!program) throw new AppError(404, "PROGRAM_NOT_FOUND", "Recruitment program not found");
  if (program.status !== RecruitmentProgramStatus.DRAFT) return program;
  if (!program.stages.length)
    throw new AppError(409, "PROGRAM_HAS_NO_STAGES", "Add at least one stage before starting");
  if (program.stages.some((stage) => stage.assignees.length === 0)) {
    throw new AppError(
      409,
      "STAGE_HAS_NO_ASSIGNEE",
      "Every stage requires at least one assigned reviewer",
    );
  }
  return prisma.$transaction(
    async (tx) => {
      const debited = await tx.companyCreditBalance.updateMany({
        where: { companyId: program.companyId, availableCredits: { gte: program.creditCost } },
        data: {
          availableCredits: { decrement: program.creditCost },
          lockVersion: { increment: 1 },
        },
      });
      if (debited.count !== 1)
        throw new AppError(
          402,
          "INSUFFICIENT_CREDITS",
          "Insufficient company credits to start this program",
        );
      const balance = await tx.companyCreditBalance.findUniqueOrThrow({
        where: { companyId: program.companyId },
      });
      await tx.creditLedger.create({
        data: {
          companyId: program.companyId,
          createdById: actor.actorId,
          type: "ADMIN_ADJUSTMENT",
          amount: -program.creditCost,
          balanceAfter: balance.availableCredits,
          reference: `program:${program.id}:activation`,
          metadata: json({ reason: "RECRUITMENT_PROGRAM_ACTIVATION" }),
        },
      });
      return tx.recruitmentProgram.update({
        where: { id: programId },
        data: { status: RecruitmentProgramStatus.ACTIVE, startedAt: new Date() },
        include: programSummaryInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function safeReview<T extends { encryptedPrivateNotes: string | null; reviewerId: string }>(
  review: T,
  viewerId: string,
  canSeePrivate: boolean,
) {
  const { encryptedPrivateNotes, ...rest } = review;
  return {
    ...rest,
    ...(encryptedPrivateNotes && (review.reviewerId === viewerId || canSeePrivate)
      ? { privateNotes: decryptPrivateData(encryptedPrivateNotes) }
      : {}),
  };
}

async function assignedProgress(progressId: string, actor: RecruitmentActor) {
  const progress = await prisma.candidateStageProgress.findUnique({
    where: { id: progressId },
    include: {
      stage: { include: { assignees: true, program: true } },
      application: {
        include: { candidate: { select: { id: true, displayName: true, email: true } } },
      },
      reviews: { include: { reviewer: { select: { id: true, displayName: true } } } },
      schedules: { where: { cancelledAt: null }, orderBy: { startsAt: "desc" } },
    },
  });
  if (!progress) throw new AppError(404, "STAGE_PROGRESS_NOT_FOUND", "Candidate stage not found");
  if (
    actor.role !== UserRole.ADMIN &&
    !progress.stage.assignees.some((item) => item.userId === actor.actorId)
  ) {
    throw new AppError(403, "STAGE_ACCESS_DENIED", "You are not assigned to this stage");
  }
  return progress;
}

export async function listMyStageTasks(actor: RecruitmentActor) {
  const progress = await prisma.candidateStageProgress.findMany({
    where: {
      stage: { assignees: { some: { userId: actor.actorId } } },
      status: {
        in: [
          CandidateStageStatus.AVAILABLE,
          CandidateStageStatus.SCHEDULED,
          CandidateStageStatus.IN_PROGRESS,
          CandidateStageStatus.AWAITING_REVIEW,
        ],
      },
    },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      status: true,
      availableAt: true,
      stage: {
        select: {
          id: true,
          name: true,
          type: true,
          order: true,
          program: { select: { id: true, title: true, position: true } },
        },
      },
      application: {
        select: { id: true, candidate: { select: { id: true, displayName: true, email: true } } },
      },
      schedules: { where: { cancelledAt: null }, orderBy: { startsAt: "desc" }, take: 1 },
    },
  });
  return progress;
}

export async function getStageTask(progressId: string, actor: RecruitmentActor) {
  const progress = await assignedProgress(progressId, actor);
  const previous = await prisma.candidateStageProgress.findMany({
    where: {
      applicationId: progress.applicationId,
      stage: { order: { lt: progress.stage.order } },
    },
    orderBy: { stage: { order: "asc" } },
    select: {
      status: true,
      aggregateScore: true,
      finalDecision: true,
      stage: { select: { name: true, type: true, order: true } },
    },
  });
  const member = await prisma.programMember.findUnique({
    where: { programId_userId: { programId: progress.stage.programId, userId: actor.actorId } },
  });
  const canSeePrivate =
    actor.role === UserRole.ADMIN || member?.role === ProgramMemberRole.LEAD_RECRUITER;
  return {
    id: progress.id,
    status: progress.status,
    stage: {
      id: progress.stage.id,
      name: progress.stage.name,
      type: progress.stage.type,
      order: progress.stage.order,
    },
    program: {
      id: progress.stage.program.id,
      title: progress.stage.program.title,
      position: progress.stage.program.position,
    },
    candidate: progress.application.candidate,
    previousStageResults: previous,
    reviews: progress.reviews.map((review) => safeReview(review, actor.actorId, canSeePrivate)),
    schedules: progress.schedules,
  };
}

export async function submitStageReview(
  progressId: string,
  input: SubmitReviewInput,
  actor: RecruitmentActor,
) {
  const progress = await assignedProgress(progressId, actor);
  if (
    progress.status !== CandidateStageStatus.AVAILABLE &&
    progress.status !== CandidateStageStatus.SCHEDULED &&
    progress.status !== CandidateStageStatus.IN_PROGRESS &&
    progress.status !== CandidateStageStatus.AWAITING_REVIEW
  ) {
    throw new AppError(409, "STAGE_ALREADY_FINALIZED", "This candidate stage is already finalized");
  }
  const existing = progress.reviews.find((review) => review.reviewerId === actor.actorId);
  if (existing)
    throw new AppError(
      409,
      "REVIEW_ALREADY_SUBMITTED",
      "Your review is final and cannot be overwritten",
    );
  await prisma.$transaction([
    prisma.stageReview.create({
      data: {
        stageProgressId: progressId,
        reviewerId: actor.actorId,
        score: input.score,
        decision: input.decision,
        candidateFeedback: input.candidateFeedback ?? null,
        encryptedPrivateNotes: input.privateNotes ? encryptPrivateData(input.privateNotes) : null,
      },
    }),
    prisma.candidateStageProgress.update({
      where: { id: progressId },
      data: {
        status: CandidateStageStatus.AWAITING_REVIEW,
        startedAt: progress.startedAt ?? new Date(),
      },
    }),
  ]);
  const leadIds = await prisma.programMember.findMany({
    where: { programId: progress.stage.programId, role: ProgramMemberRole.LEAD_RECRUITER },
    select: { userId: true },
  });
  await prisma.notification.createMany({
    data: leadIds.map((lead) => ({
      userId: lead.userId,
      type: "STAGE_REVIEW_SUBMITTED",
      title: `Review submitted for ${progress.stage.name}`,
      body: `${progress.application.candidate.displayName}'s stage review is ready for a final decision.`,
      metadata: json({ progressId, applicationId: progress.applicationId }),
    })),
  });
  return getStageTask(progressId, actor);
}

export async function scheduleInterview(
  progressId: string,
  input: ScheduleInterviewInput,
  actor: RecruitmentActor,
) {
  const progress = await assignedProgress(progressId, actor);
  if (progress.stage.type === RecruitmentStageType.CODING_ASSESSMENT) {
    throw new AppError(
      400,
      "INTERVIEW_SCHEDULE_NOT_ALLOWED",
      "Coding stages do not use interview scheduling",
    );
  }
  const schedule = await prisma.$transaction(async (tx) => {
    await tx.interviewSchedule.updateMany({
      where: { stageProgressId: progressId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    const created = await tx.interviewSchedule.create({
      data: {
        stageProgressId: progressId,
        scheduledById: actor.actorId,
        ...input,
        meetingUrl: input.meetingUrl ?? null,
        location: input.location ?? null,
      },
    });
    await tx.candidateStageProgress.update({
      where: { id: progressId },
      data: { status: CandidateStageStatus.SCHEDULED },
    });
    await tx.notification.create({
      data: {
        userId: progress.application.candidateId,
        type: "INTERVIEW_SCHEDULED",
        title: `${progress.stage.name} scheduled`,
        body: `Your interview is scheduled for ${input.startsAt.toISOString()}.`,
        metadata: json({ progressId, startsAt: input.startsAt, timezone: input.timezone }),
      },
    });
    return created;
  });
  return schedule;
}

async function prepareNextStage(
  tx: Prisma.TransactionClient,
  progress: Awaited<ReturnType<typeof assignedProgress>>,
) {
  const next = await tx.recruitmentStage.findFirst({
    where: { programId: progress.stage.programId, order: { gt: progress.stage.order } },
    orderBy: { order: "asc" },
    include: { assignees: true },
  });
  if (!next) {
    const hired = progress.stage.type === RecruitmentStageType.FINAL_DECISION;
    await tx.candidateApplication.update({
      where: { id: progress.applicationId },
      data: hired
        ? {
            status: CandidateApplicationStatus.HIRED,
            currentStageId: null,
            hiredAt: new Date(),
            completedAt: new Date(),
          }
        : {
            status: CandidateApplicationStatus.COMPLETED,
            currentStageId: null,
            completedAt: new Date(),
          },
    });
    return;
  }
  const nextProgress = await tx.candidateStageProgress.update({
    where: { applicationId_stageId: { applicationId: progress.applicationId, stageId: next.id } },
    data: { status: CandidateStageStatus.AVAILABLE, availableAt: new Date() },
  });
  await tx.candidateApplication.update({
    where: { id: progress.applicationId },
    data: { currentStageId: next.id },
  });
  await tx.notification.createMany({
    data: next.assignees.map((assignee) => ({
      userId: assignee.userId,
      type: "STAGE_READY",
      title: `${progress.application.candidate.displayName} is ready for ${next.name}`,
      body: "A candidate has advanced to your assigned stage.",
      metadata: json({ progressId: nextProgress.id, applicationId: progress.applicationId }),
    })),
  });
  if (next.type === RecruitmentStageType.CODING_ASSESSMENT && next.assessmentId) {
    const assessment = await tx.assessment.findUniqueOrThrow({ where: { id: next.assessmentId } });
    const token = createOpaqueToken(32);
    await tx.invitation.create({
      data: {
        assessmentId: next.assessmentId,
        candidateId: progress.application.candidateId,
        invitedById: progress.stage.program.createdById,
        candidateStageProgressId: nextProgress.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: assessment.availableUntil ?? new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await tx.notification.create({
      data: {
        userId: progress.application.candidateId,
        type: "CODING_STAGE_READY",
        title: next.name,
        body: "Your next coding assessment is ready.",
        metadata: json({ progressId: nextProgress.id, invitationToken: token }),
      },
    });
  }
}

export async function finalizeCandidateStage(
  progressId: string,
  decision: StageDecision,
  actor: RecruitmentActor,
) {
  const progress = await prisma.candidateStageProgress.findUnique({
    where: { id: progressId },
    include: {
      stage: { include: { program: true } },
      application: { include: { candidate: { select: { id: true, displayName: true } } } },
      reviews: true,
    },
  });
  if (!progress) throw new AppError(404, "STAGE_PROGRESS_NOT_FOUND", "Candidate stage not found");
  await requireLeadRole(actor.actorId, actor.role, progress.stage.programId);
  if (
    progress.status === CandidateStageStatus.PASSED ||
    progress.status === CandidateStageStatus.FAILED
  )
    return progress;
  let scores = progress.reviews.map((review) => Number(review.score));
  if (progress.stage.type === RecruitmentStageType.CODING_ASSESSMENT) {
    const result = await prisma.result.findFirst({
      where: { attempt: { invitation: { candidateStageProgressId: progress.id } } },
      select: { percentage: true },
    });
    if (!result)
      throw new AppError(
        409,
        "TECHNICAL_RESULT_REQUIRED",
        "Finalize the coding evaluation before deciding this stage",
      );
    scores = [Number(result.percentage), ...scores];
  } else if (!scores.length) {
    throw new AppError(
      409,
      "REVIEW_REQUIRED",
      "At least one reviewer must submit a score and decision",
    );
  }
  const aggregateScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  await prisma.$transaction(async (tx) => {
    await tx.candidateStageProgress.update({
      where: { id: progress.id },
      data: {
        status:
          decision === StageDecision.PASS
            ? CandidateStageStatus.PASSED
            : CandidateStageStatus.FAILED,
        aggregateScore,
        finalDecision: decision,
        finalizedById: actor.actorId,
        finalizedAt: new Date(),
        completedAt: new Date(),
      },
    });
    if (decision === StageDecision.FAIL) {
      await tx.candidateApplication.update({
        where: { id: progress.applicationId },
        data: {
          status: CandidateApplicationStatus.REJECTED,
          rejectedAt: new Date(),
          currentStageId: null,
        },
      });
      await tx.notification.create({
        data: {
          userId: progress.application.candidateId,
          type: "APPLICATION_UPDATED",
          title: "Recruitment application updated",
          body: `Your application for ${progress.stage.program.position} has been updated.`,
          metadata: json({ applicationId: progress.applicationId }),
        },
      });
    } else {
      await prepareNextStage(tx, progress as Awaited<ReturnType<typeof assignedProgress>>);
    }
  });
  return prisma.candidateStageProgress.findUniqueOrThrow({ where: { id: progressId } });
}

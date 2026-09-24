import {
  ProgramInvitationType,
  ProgramMemberRole,
  RecruitmentStageType,
  StageDecision,
} from "@prisma/client";
import { z } from "zod";

export const createProgramBodySchema = z.object({
  companyId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  position: z.string().trim().min(2).max(160),
  description: z.string().trim().max(20_000).optional(),
  creditCost: z.coerce.number().int().positive().max(100).default(1),
});

export const updateProgramBodySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    position: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    creditCost: z.coerce.number().int().positive().max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const programIdParamsSchema = z.object({ id: z.string().min(1) });
export const applicationParamsSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
});
export const stageIdParamsSchema = z.object({ id: z.string().min(1), stageId: z.string().min(1) });
export const progressIdParamsSchema = z.object({ progressId: z.string().min(1) });
export const invitationTokenParamsSchema = z.object({ token: z.string().min(32).max(500) });

export const createStageBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(20_000).optional(),
  type: z.enum(RecruitmentStageType),
  order: z.coerce.number().int().positive(),
  assessmentId: z.string().min(1).optional(),
  minimumScore: z.coerce.number().min(0).max(100).optional(),
  assigneeIds: z.array(z.string().min(1)).max(50).default([]),
});

export const reorderStagesBodySchema = z.object({
  stageIds: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .refine((values) => new Set(values).size === values.length, "Stage IDs must be unique"),
});
export const stageAssigneesBodySchema = z.object({
  assigneeIds: z.array(z.string().min(1)).min(1).max(50),
});

export const inviteToProgramBodySchema = z
  .object({
    email: z.email().transform((value) => value.trim().toLowerCase()),
    type: z.enum(ProgramInvitationType),
    memberRole: z.enum(ProgramMemberRole).optional(),
    expiresInDays: z.coerce.number().int().positive().max(90).default(14),
  })
  .superRefine((value, context) => {
    if (value.type === ProgramInvitationType.MEMBER && !value.memberRole) {
      context.addIssue({
        code: "custom",
        path: ["memberRole"],
        message: "Member role is required",
      });
    }
    if (value.type === ProgramInvitationType.CANDIDATE && value.memberRole) {
      context.addIssue({
        code: "custom",
        path: ["memberRole"],
        message: "Candidate invitations cannot have a member role",
      });
    }
  });

export const submitReviewBodySchema = z.object({
  score: z.coerce.number().min(0).max(100),
  decision: z.enum(StageDecision),
  candidateFeedback: z.string().trim().max(10_000).optional(),
  privateNotes: z.string().trim().max(20_000).optional(),
});

export const finalizeStageBodySchema = z.object({
  decision: z.enum(StageDecision),
});

export const scheduleInterviewBodySchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().trim().min(1).max(80),
    meetingUrl: z.url().optional(),
    location: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: "Interview end time must be after its start time",
    path: ["endsAt"],
  });

export const programListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
});

export type CreateProgramInput = z.infer<typeof createProgramBodySchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramBodySchema>;
export type CreateStageInput = z.infer<typeof createStageBodySchema>;
export type InviteToProgramInput = z.infer<typeof inviteToProgramBodySchema>;
export type SubmitReviewInput = z.infer<typeof submitReviewBodySchema>;
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewBodySchema>;
export type ProgramListQuery = z.infer<typeof programListQuerySchema>;

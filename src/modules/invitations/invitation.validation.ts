import { InvitationStatus } from "@prisma/client";
import { z } from "zod";

export const createInvitationBodySchema = z.object({
  assessmentId: z.string().min(1),
  candidateEmail: z.email().transform((value) => value.trim().toLowerCase()),
  expiresAt: z.coerce.date().refine((value) => value.getTime() > Date.now(), {
    message: "Expiration must be in the future",
  }),
});

export const invitationIdParamsSchema = z.object({ id: z.string().min(1) });
export const invitationTokenParamsSchema = z.object({ token: z.string().min(32).max(500) });

export const invitationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  assessmentId: z.string().min(1).optional(),
  status: z.enum(InvitationStatus).optional(),
});

export const candidateInvitationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  status: z.enum(InvitationStatus).optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationBodySchema>;
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;
export type CandidateInvitationListQuery = z.infer<typeof candidateInvitationListQuerySchema>;

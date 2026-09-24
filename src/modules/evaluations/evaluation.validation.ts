import { EvaluationStatus } from "@prisma/client";
import { z } from "zod";

export const evaluationIdParamsSchema = z.object({ id: z.string().min(1) });

export const gradeAnswerParamsSchema = z.object({
  id: z.string().min(1),
  answerId: z.string().min(1),
});

export const gradeAnswerBodySchema = z.object({
  score: z.coerce.number().min(0).max(1_000_000),
  feedback: z.string().trim().max(10_000).optional(),
});

export const evaluationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  assessmentId: z.string().min(1).optional(),
  status: z.enum(EvaluationStatus).optional(),
});

export const finalizeEvaluationBodySchema = z.object({
  notes: z.string().trim().max(20_000).optional(),
});

export type GradeAnswerInput = z.infer<typeof gradeAnswerBodySchema>;
export type EvaluationListQuery = z.infer<typeof evaluationListQuerySchema>;

import { z } from "zod";

export const resultIdParamsSchema = z.object({ id: z.string().min(1) });

export const updateResultBodySchema = z.object({
  summary: z.string().trim().max(20_000).nullable(),
});

export const resultListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  assessmentId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  passed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  released: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const candidateResultListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type ResultListQuery = z.infer<typeof resultListQuerySchema>;
export type CandidateResultListQuery = z.infer<typeof candidateResultListQuerySchema>;

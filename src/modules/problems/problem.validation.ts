import { Difficulty, ProblemStatus, ProblemType } from "@prisma/client";
import { z } from "zod";

const optionSchema = z.object({
  label: z.string().trim().min(1).max(16),
  content: z.string().trim().min(1).max(5_000),
  isCorrect: z.boolean(),
});

const testCaseSchema = z.object({
  input: z.string().max(20_000),
  expectedOutput: z.string().max(20_000),
  isHidden: z.boolean().default(true),
  weight: z.coerce.number().positive().max(100).default(1),
});

export const problemVersionBodySchema = z.object({
  prompt: z.string().trim().min(10).max(50_000),
  explanation: z.string().trim().max(20_000).optional(),
  starterCode: z.string().max(50_000).optional(),
  allowedLanguages: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  answerConfig: z.record(z.string(), z.unknown()).optional(),
  options: z.array(optionSchema).max(20).default([]),
  testCases: z.array(testCaseSchema).max(100).default([]),
});

export const createProblemBodySchema = z.object({
  companyId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  type: z.enum(ProblemType),
  difficulty: z.enum(Difficulty),
  version: problemVersionBodySchema,
});

export const updateProblemBodySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    difficulty: z.enum(Difficulty).optional(),
    status: z.enum(ProblemStatus).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const problemIdParamsSchema = z.object({ id: z.string().min(1) });

export const problemListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  type: z.enum(ProblemType).optional(),
  difficulty: z.enum(Difficulty).optional(),
  status: z.enum(ProblemStatus).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "title"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateProblemInput = z.infer<typeof createProblemBodySchema>;
export type UpdateProblemInput = z.infer<typeof updateProblemBodySchema>;
export type ProblemVersionInput = z.infer<typeof problemVersionBodySchema>;
export type ProblemListQuery = z.infer<typeof problemListQuerySchema>;

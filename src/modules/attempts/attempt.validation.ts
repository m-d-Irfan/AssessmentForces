import { z } from "zod";

export const startAttemptBodySchema = z.object({
  invitationToken: z.string().min(32).max(500),
});

export const attemptIdParamsSchema = z.object({ id: z.string().min(1) });

export const answerParamsSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
});

export const saveAnswerBodySchema = z
  .object({
    response: z.unknown().optional(),
    sourceCode: z.string().max(100_000).optional(),
    language: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      value.response !== undefined ||
      value.sourceCode !== undefined ||
      value.language !== undefined,
    "At least one answer field is required",
  );

export type SaveAnswerInput = z.infer<typeof saveAnswerBodySchema>;

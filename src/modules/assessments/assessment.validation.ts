import { AssessmentStatus } from "@prisma/client";
import { z } from "zod";

const assessmentFields = {
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000).optional(),
  instructions: z.string().trim().max(20_000).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  passPercentage: z.coerce.number().min(0).max(100),
  availableFrom: z.coerce.date().optional(),
  availableUntil: z.coerce.date().optional(),
};

export const createAssessmentBodySchema = z
  .object({ companyId: z.string().min(1), ...assessmentFields })
  .refine(
    (value) =>
      !value.availableFrom || !value.availableUntil || value.availableUntil > value.availableFrom,
    { message: "availableUntil must be after availableFrom", path: ["availableUntil"] },
  );

export const updateAssessmentBodySchema = z
  .object({
    title: assessmentFields.title.optional(),
    description: assessmentFields.description,
    instructions: assessmentFields.instructions,
    durationMinutes: assessmentFields.durationMinutes.optional(),
    passPercentage: assessmentFields.passPercentage.optional(),
    availableFrom: assessmentFields.availableFrom.nullable(),
    availableUntil: assessmentFields.availableUntil.nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  .refine(
    (value) =>
      !value.availableFrom || !value.availableUntil || value.availableUntil > value.availableFrom,
    { message: "availableUntil must be after availableFrom", path: ["availableUntil"] },
  );

export const assessmentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.enum(AssessmentStatus).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "title", "publishedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const assessmentIdParamsSchema = z.object({ id: z.string().min(1) });
export const assessmentItemParamsSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
});

export const addAssessmentItemBodySchema = z.object({
  problemVersionId: z.string().min(1),
  points: z.coerce.number().positive().max(10_000),
  order: z.coerce.number().int().positive().optional(),
});

export const updateAssessmentItemBodySchema = z
  .object({
    points: z.coerce.number().positive().max(10_000).optional(),
    order: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateAssessmentInput = z.infer<typeof createAssessmentBodySchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentBodySchema>;
export type AssessmentListQuery = z.infer<typeof assessmentListQuerySchema>;
export type AddAssessmentItemInput = z.infer<typeof addAssessmentItemBodySchema>;
export type UpdateAssessmentItemInput = z.infer<typeof updateAssessmentItemBodySchema>;

import { CompanyStatus, UserRole, UserStatus } from "@prisma/client";
import { z } from "zod";

export const resourceIdParamsSchema = z.object({ id: z.string().min(1) });

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(320).optional(),
  role: z.enum(UserRole).optional(),
  status: z.enum(UserStatus).optional(),
});

export const updateUserStatusBodySchema = z.object({ status: z.enum(UserStatus) });

export const companyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(CompanyStatus).optional(),
  verified: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const updateCompanyStatusBodySchema = z.object({ status: z.enum(CompanyStatus) });

export const verifyCompanyBodySchema = z.object({
  verified: z.boolean(),
});

export const createCreditPackageBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(10_000).optional(),
  credits: z.coerce.number().int().positive().max(1_000_000),
  price: z.coerce.number().positive().max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("BDT"),
});

export const updateCreditPackageBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    credits: z.coerce.number().int().positive().max(1_000_000).optional(),
    price: z.coerce.number().positive().max(100_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const adjustCreditsBodySchema = z.object({
  amount: z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(5).max(500),
});

export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  actorId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CreateCreditPackageInput = z.infer<typeof createCreditPackageBodySchema>;
export type UpdateCreditPackageInput = z.infer<typeof updateCreditPackageBodySchema>;
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

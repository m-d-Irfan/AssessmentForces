import { PaymentStatus } from "@prisma/client";
import { z } from "zod";

export const initiatePaymentBodySchema = z.object({
  companyId: z.string().min(1),
  creditPackageId: z.string().min(1),
  payerReference: z.string().trim().min(1).max(100).optional(),
});

export const paymentIdParamsSchema = z.object({ id: z.string().min(1) });

export const bkashCallbackQuerySchema = z.object({
  paymentID: z.string().min(1),
  status: z.enum(["success", "failure", "cancel"]),
});

export const bkashWebhookBodySchema = z.object({ paymentID: z.string().min(1) }).passthrough();

export const companyQuerySchema = z.object({ companyId: z.string().min(1) });

export const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  companyId: z.string().min(1).optional(),
  status: z.enum(PaymentStatus).optional(),
});

export const ledgerListQuerySchema = companyQuerySchema.extend({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type InitiatePaymentInput = z.infer<typeof initiatePaymentBodySchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
export type LedgerListQuery = z.infer<typeof ledgerListQuerySchema>;

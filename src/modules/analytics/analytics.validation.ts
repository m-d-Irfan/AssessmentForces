import { z } from "zod";

export const companyAnalyticsQuerySchema = z.object({ companyId: z.string().min(1) });
export const assessmentAnalyticsParamsSchema = z.object({ assessmentId: z.string().min(1) });

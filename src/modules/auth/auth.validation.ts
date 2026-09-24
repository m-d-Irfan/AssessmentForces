import { UserRole } from "@prisma/client";
import { z } from "zod";

const email = z
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());
const password = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

export const registerBodySchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(2).max(120),
  role: z.enum([UserRole.CANDIDATE, UserRole.RECRUITER]),
});

export const loginBodySchema = z.object({ email, password: z.string().min(1).max(128) });
export const refreshBodySchema = z.object({ refreshToken: z.string().min(32).optional() });
export const verifyEmailBodySchema = z.object({ token: z.string().min(32) });
export const emailBodySchema = z.object({ email });
export const resetPasswordBodySchema = z.object({ token: z.string().min(32), password });
export const googleStartQuerySchema = z.object({
  role: z.enum([UserRole.CANDIDATE, UserRole.RECRUITER]).default(UserRole.CANDIDATE),
});
export const googleCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(16),
});

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return undefined;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transporter;
}

async function deliver(to: string, subject: string, text: string): Promise<boolean> {
  const smtp = getTransporter();
  if (!smtp) {
    logger.warn({ to, subject }, "SMTP is not configured; email delivery skipped");
    return false;
  }
  await smtp.sendMail({ from: env.EMAIL_FROM, to, subject, text });
  return true;
}

export function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  return deliver(
    email,
    "Verify your DevAssess account",
    `Use this one-time verification token within 24 hours: ${token}`,
  );
}

export function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  return deliver(
    email,
    "Reset your DevAssess password",
    `Use this one-time password reset token within 30 minutes: ${token}`,
  );
}

export function sendAssessmentInvitationEmail(
  email: string,
  assessmentTitle: string,
  invitationUrl: string,
  expiresAt: Date,
): Promise<boolean> {
  return deliver(
    email,
    `Assessment invitation: ${assessmentTitle}`,
    `You have been invited to complete "${assessmentTitle}". Open this link before ${expiresAt.toISOString()}: ${invitationUrl}`,
  );
}

export function sendRecruitmentProgramInvitationEmail(
  email: string,
  programTitle: string,
  invitationUrl: string,
  kind: "candidate" | "team member",
): Promise<boolean> {
  return deliver(
    email,
    `Invitation to ${programTitle}`,
    `You have been invited to join “${programTitle}” as a ${kind}. Sign in or create an account, then open: ${invitationUrl}`,
  );
}

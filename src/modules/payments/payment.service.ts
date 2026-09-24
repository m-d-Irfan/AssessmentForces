import { randomBytes } from "node:crypto";
import { type Payment, PaymentEventType, PaymentStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { ensureRedisConnection, redis } from "../../config/redis.js";
import {
  type BkashPaymentResult,
  createBkashPayment,
  executeBkashPayment,
  queryBkashPayment,
} from "../../integrations/bkash/bkash.service.js";
import {
  accessibleCompanyIds,
  requireCompanyAccess,
} from "../../shared/authorization/company-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { pagination, paginationMeta } from "../../shared/pagination/pagination.js";
import { createAuditLog } from "../audit-logs/audit.service.js";
import type {
  InitiatePaymentInput,
  LedgerListQuery,
  PaymentListQuery,
} from "./payment.validation.js";

export type PaymentActor = {
  actorId: string;
  role: UserRole;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

const paymentInclude = {
  creditPackage: { select: { id: true, name: true, credits: true } },
  company: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function invoiceNumber(): string {
  return `DVA-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function isCompleted(result: BkashPaymentResult): boolean {
  return result.transactionStatus?.toLowerCase() === "completed";
}

async function event(
  paymentId: string,
  type: PaymentEventType,
  payload: unknown,
  idempotencyKey?: string,
): Promise<void> {
  const providerStatus = (payload as BkashPaymentResult).transactionStatus;
  await prisma.paymentEvent.upsert({
    where: {
      idempotencyKey:
        idempotencyKey ?? `event:${paymentId}:${type}:${randomBytes(8).toString("hex")}`,
    },
    create: {
      paymentId,
      type,
      idempotencyKey: idempotencyKey ?? null,
      providerStatus: providerStatus ?? null,
      payload: json(payload),
    },
    update: {},
  });
}

export async function listCreditPackages() {
  return prisma.creditPackage.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ price: "asc" }, { credits: "asc" }],
  });
}

export async function initiatePayment(input: InitiatePaymentInput, actor: PaymentActor) {
  await requireCompanyAccess(actor.actorId, actor.role, input.companyId);
  const creditPackage = await prisma.creditPackage.findFirst({
    where: { id: input.creditPackageId, isActive: true, deletedAt: null },
  });
  if (!creditPackage)
    throw new AppError(404, "CREDIT_PACKAGE_NOT_FOUND", "Credit package not found");
  if (creditPackage.currency !== "BDT") {
    throw new AppError(400, "UNSUPPORTED_PAYMENT_CURRENCY", "bKash payments require BDT");
  }

  const payment = await prisma.payment.create({
    data: {
      companyId: input.companyId,
      initiatedById: actor.actorId,
      creditPackageId: creditPackage.id,
      amount: creditPackage.price,
      currency: creditPackage.currency,
      credits: creditPackage.credits,
      merchantInvoiceNumber: invoiceNumber(),
    },
  });

  try {
    const provider = await createBkashPayment({
      amount: payment.amount.toFixed(2),
      invoice: payment.merchantInvoiceNumber,
      payerReference: input.payerReference ?? actor.actorId,
    });
    if (!provider.paymentID || !provider.bkashURL) {
      throw new AppError(
        502,
        "BKASH_INVALID_RESPONSE",
        "bKash returned an incomplete payment response",
      );
    }
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PENDING,
        providerPaymentId: provider.paymentID,
        providerStatus: provider.transactionStatus ?? null,
        metadata: json({ create: provider }),
      },
      include: paymentInclude,
    });
    await event(
      updated.id,
      PaymentEventType.CREATE,
      provider,
      `bkash:create:${provider.paymentID}`,
    );
    await createAuditLog(
      prisma,
      { ...actor, companyId: input.companyId },
      {
        action: "payment.initiated",
        entityType: "Payment",
        entityId: updated.id,
        after: json({
          amount: updated.amount,
          credits: updated.credits,
          providerPaymentId: provider.paymentID,
        }),
      },
    );
    return { payment: updated, checkoutUrl: provider.bkashURL };
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureReason: error instanceof Error ? error.message : "Payment creation failed",
      },
    });
    throw error;
  }
}

async function withPaymentLock<T>(paymentId: string, callback: () => Promise<T>): Promise<T> {
  await ensureRedisConnection();
  const key = `${process.env.NODE_ENV ?? "development"}:lock:payment:${paymentId}`;
  const token = randomBytes(16).toString("hex");
  const acquired = await redis.set(key, token, { px: 30_000, nx: true });
  if (!acquired)
    throw new AppError(409, "PAYMENT_PROCESSING", "This payment is already being processed");
  try {
    return await callback();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      [key],
      [token],
    );
  }
}

function verifyProviderResult(payment: Payment, provider: BkashPaymentResult): void {
  if (!isCompleted(provider) || !provider.trxID) {
    throw new AppError(409, "PAYMENT_NOT_COMPLETED", "bKash has not completed this payment");
  }
  if (provider.paymentID && provider.paymentID !== payment.providerPaymentId) {
    throw new AppError(409, "PAYMENT_ID_MISMATCH", "bKash payment identifier does not match");
  }
  if (provider.currency && provider.currency !== payment.currency) {
    throw new AppError(409, "PAYMENT_CURRENCY_MISMATCH", "bKash currency does not match");
  }
  if (provider.amount && !new Prisma.Decimal(provider.amount).equals(payment.amount)) {
    throw new AppError(409, "PAYMENT_AMOUNT_MISMATCH", "bKash amount does not match");
  }
  if (
    provider.merchantInvoiceNumber &&
    provider.merchantInvoiceNumber !== payment.merchantInvoiceNumber
  ) {
    throw new AppError(409, "PAYMENT_INVOICE_MISMATCH", "bKash invoice does not match");
  }
}

async function creditCompletedPayment(
  payment: Payment,
  provider: BkashPaymentResult,
  actor?: PaymentActor,
) {
  verifyProviderResult(payment, provider);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
          const existing = await tx.creditLedger.findUnique({
            where: { reference: `bkash:${provider.trxID}` },
          });
          if (current.status === PaymentStatus.COMPLETED || existing) {
            return tx.payment.findUniqueOrThrow({
              where: { id: payment.id },
              include: paymentInclude,
            });
          }
          const balance = await tx.companyCreditBalance.upsert({
            where: { companyId: payment.companyId },
            create: { companyId: payment.companyId },
            update: {},
          });
          const nextBalance = balance.availableCredits + payment.credits;
          await tx.companyCreditBalance.update({
            where: { companyId: payment.companyId },
            data: { availableCredits: nextBalance, lockVersion: { increment: 1 } },
          });
          await tx.creditLedger.create({
            data: {
              companyId: payment.companyId,
              paymentId: payment.id,
              createdById: actor?.actorId ?? payment.initiatedById,
              type: "PURCHASE",
              amount: payment.credits,
              balanceAfter: nextBalance,
              reference: `bkash:${provider.trxID}`,
              metadata: json({ provider: "BKASH", paymentID: payment.providerPaymentId }),
            },
          });
          const updated = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.COMPLETED,
              providerTransactionId: provider.trxID as string,
              providerStatus: provider.transactionStatus ?? null,
              completedAt: new Date(),
              failureReason: null,
            },
            include: paymentInclude,
          });
          await createAuditLog(
            tx,
            {
              actorId: actor?.actorId ?? payment.initiatedById,
              companyId: payment.companyId,
              ...(actor?.requestId ? { requestId: actor.requestId } : {}),
              ...(actor?.ipAddress ? { ipAddress: actor.ipAddress } : {}),
              ...(actor?.userAgent ? { userAgent: actor.userAgent } : {}),
            },
            {
              action: "payment.completed",
              entityType: "Payment",
              entityId: payment.id,
              after: json({ trxID: provider.trxID, credits: payment.credits }),
            },
          );
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new AppError(409, "PAYMENT_CONFLICT", "Payment could not be finalized safely");
}

async function resolveProviderPayment(
  payment: Payment,
  execute: boolean,
): Promise<BkashPaymentResult> {
  if (!payment.providerPaymentId)
    throw new AppError(409, "PAYMENT_NOT_INITIALIZED", "Payment has no bKash identifier");
  if (!execute) return queryBkashPayment(payment.providerPaymentId);
  try {
    const result = await executeBkashPayment(payment.providerPaymentId);
    if (isCompleted(result)) return result;
  } catch {
    // An execute response may be lost after bKash has charged the wallet; query is authoritative.
  }
  return queryBkashPayment(payment.providerPaymentId);
}

export async function processBkashCallback(paymentID: string, status: string) {
  const payment = await prisma.payment.findUnique({ where: { providerPaymentId: paymentID } });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  await event(
    payment.id,
    PaymentEventType.CALLBACK,
    { paymentID, status },
    `bkash:callback:${paymentID}:${status}`,
  );
  if (payment.status === PaymentStatus.COMPLETED) {
    return prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude,
    });
  }
  if (status !== "success") {
    const finalStatus = status === "cancel" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED;
    return prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: finalStatus,
        providerStatus: status,
        failedAt: finalStatus === PaymentStatus.FAILED ? new Date() : null,
      },
      include: paymentInclude,
    });
  }
  return withPaymentLock(payment.id, async () => {
    const refreshed = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (refreshed.status === PaymentStatus.COMPLETED)
      return prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: paymentInclude,
      });
    const provider = await resolveProviderPayment(refreshed, true);
    await event(
      payment.id,
      PaymentEventType.EXECUTE,
      provider,
      `bkash:execute:${paymentID}:${provider.trxID ?? provider.transactionStatus}`,
    );
    return creditCompletedPayment(refreshed, provider);
  });
}

export async function reconcilePayment(
  paymentId: string,
  actor: PaymentActor,
  eventType: PaymentEventType = PaymentEventType.QUERY,
) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  await requireCompanyAccess(actor.actorId, actor.role, payment.companyId);
  if (payment.status === PaymentStatus.COMPLETED)
    return prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: paymentInclude });
  return withPaymentLock(payment.id, async () => {
    const provider = await resolveProviderPayment(payment, false);
    await event(
      payment.id,
      eventType,
      provider,
      `bkash:${eventType.toLowerCase()}:${payment.providerPaymentId}:${provider.transactionStatus}`,
    );
    return creditCompletedPayment(payment, provider, actor);
  });
}

export async function processBkashWebhook(payload: { paymentID: string }) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: payload.paymentID },
  });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  await event(payment.id, PaymentEventType.WEBHOOK, payload, `bkash:webhook:${payload.paymentID}`);
  return reconcilePayment(
    payment.id,
    { actorId: payment.initiatedById, role: UserRole.ADMIN },
    PaymentEventType.WEBHOOK,
  );
}

export async function getPayment(paymentId: string, actor: PaymentActor) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { ...paymentInclude, events: { orderBy: { createdAt: "desc" } } },
  });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  await requireCompanyAccess(actor.actorId, actor.role, payment.companyId);
  return payment;
}

export async function listPayments(query: PaymentListQuery, actor: PaymentActor) {
  const companyIds = await accessibleCompanyIds(actor.actorId, actor.role);
  if (query.companyId) await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where: Prisma.PaymentWhereInput = {
    ...(query.companyId
      ? { companyId: query.companyId }
      : companyIds
        ? { companyId: { in: companyIds } }
        : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      ...pagination(query),
      orderBy: { createdAt: "desc" },
      include: paymentInclude,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

export async function getCreditBalance(companyId: string, actor: PaymentActor) {
  await requireCompanyAccess(actor.actorId, actor.role, companyId);
  return (
    (await prisma.companyCreditBalance.findUnique({ where: { companyId } })) ?? {
      companyId,
      availableCredits: 0,
      lockVersion: 0,
    }
  );
}

export async function listCreditLedger(query: LedgerListQuery, actor: PaymentActor) {
  await requireCompanyAccess(actor.actorId, actor.role, query.companyId);
  const where = { companyId: query.companyId };
  const [items, total] = await prisma.$transaction([
    prisma.creditLedger.findMany({ where, ...pagination(query), orderBy: { createdAt: "desc" } }),
    prisma.creditLedger.count({ where }),
  ]);
  return { items, meta: paginationMeta(query.page, query.limit, total) };
}

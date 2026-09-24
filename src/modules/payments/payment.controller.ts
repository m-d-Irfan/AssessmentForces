import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/responses/api-response.js";
import {
  getCreditBalance,
  getPayment,
  initiatePayment,
  listCreditLedger,
  listCreditPackages,
  listPayments,
  processBkashCallback,
  processBkashWebhook,
  reconcilePayment,
} from "./payment.service.js";

function actorContext(request: Request) {
  if (!request.auth)
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const userAgent = request.header("user-agent");
  return {
    actorId: request.auth.userId,
    role: request.auth.role,
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(request.res?.locals.requestId ? { requestId: request.res.locals.requestId as string } : {}),
  };
}

export async function listCreditPackagesHandler(_request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Credit packages retrieved",
    data: await listCreditPackages(),
  });
}

export async function initiatePaymentHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    statusCode: 201,
    message: "bKash payment initiated",
    data: await initiatePayment(request.body, actorContext(request)),
  });
}

export async function bkashCallbackHandler(request: Request, response: Response) {
  const query = request.query as { paymentID: string; status: string };
  return sendSuccess(response, {
    message: `bKash payment ${query.status === "success" ? "processed" : query.status}`,
    data: await processBkashCallback(query.paymentID, query.status),
  });
}

export async function bkashWebhookHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "bKash webhook verified",
    data: await processBkashWebhook(request.body),
  });
}

export async function getPaymentHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Payment retrieved",
    data: await getPayment(request.params.id as string, actorContext(request)),
  });
}

export async function reconcilePaymentHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Payment reconciled with bKash",
    data: await reconcilePayment(request.params.id as string, actorContext(request)),
  });
}

export async function listPaymentsHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Payments retrieved",
    data: await listPayments(request.query as never, actorContext(request)),
  });
}

export async function getCreditBalanceHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Credit balance retrieved",
    data: await getCreditBalance(request.query.companyId as string, actorContext(request)),
  });
}

export async function listCreditLedgerHandler(request: Request, response: Response) {
  return sendSuccess(response, {
    message: "Credit ledger retrieved",
    data: await listCreditLedger(request.query as never, actorContext(request)),
  });
}

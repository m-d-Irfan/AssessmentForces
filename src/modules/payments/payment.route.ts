import { UserRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { paymentRateLimit } from "../../middlewares/rate-limit.js";
import { validate } from "../../middlewares/validate.js";
import {
  bkashCallbackHandler,
  bkashWebhookHandler,
  getCreditBalanceHandler,
  getPaymentHandler,
  initiatePaymentHandler,
  listCreditLedgerHandler,
  listCreditPackagesHandler,
  listPaymentsHandler,
  reconcilePaymentHandler,
} from "./payment.controller.js";
import {
  bkashCallbackQuerySchema,
  bkashWebhookBodySchema,
  companyQuerySchema,
  initiatePaymentBodySchema,
  ledgerListQuerySchema,
  paymentIdParamsSchema,
  paymentListQuerySchema,
} from "./payment.validation.js";

export const paymentRouter = Router();

paymentRouter.get("/credit-packages", listCreditPackagesHandler);
paymentRouter.get(
  "/payments/bkash/callback",
  validate({ query: bkashCallbackQuerySchema }),
  bkashCallbackHandler,
);
paymentRouter.post(
  "/payments/bkash/webhook",
  validate({ body: bkashWebhookBodySchema }),
  bkashWebhookHandler,
);
paymentRouter.use("/payments/bkash", paymentRateLimit);

paymentRouter.post(
  "/payments/bkash/initiate",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ body: initiatePaymentBodySchema }),
  initiatePaymentHandler,
);
paymentRouter.get(
  "/payments",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: paymentListQuerySchema }),
  listPaymentsHandler,
);
paymentRouter.get(
  "/payments/:id",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: paymentIdParamsSchema }),
  getPaymentHandler,
);
paymentRouter.post(
  "/payments/:id/reconcile",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ params: paymentIdParamsSchema }),
  reconcilePaymentHandler,
);
paymentRouter.get(
  "/credits/balance",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: companyQuerySchema }),
  getCreditBalanceHandler,
);
paymentRouter.get(
  "/credits/ledger",
  authenticate,
  authorize(UserRole.RECRUITER, UserRole.ADMIN),
  validate({ query: ledgerListQuerySchema }),
  listCreditLedgerHandler,
);

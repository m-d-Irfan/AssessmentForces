import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import {
  forgotPasswordHandler,
  googleCallbackHandler,
  googleStartHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
  resendVerificationHandler,
  resetPasswordHandler,
  verifyEmailHandler,
} from "./auth.controller.js";
import {
  emailBodySchema,
  googleCallbackQuerySchema,
  googleStartQuerySchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
} from "./auth.validation.js";

export const authRouter = Router();

authRouter.post("/register", validate({ body: registerBodySchema }), registerHandler);
authRouter.post("/login", validate({ body: loginBodySchema }), loginHandler);
authRouter.post("/refresh", validate({ body: refreshBodySchema }), refreshHandler);
authRouter.post("/logout", validate({ body: refreshBodySchema }), logoutHandler);
authRouter.post("/logout-all", authenticate, logoutAllHandler);
authRouter.post("/verify-email", validate({ body: verifyEmailBodySchema }), verifyEmailHandler);
authRouter.post(
  "/resend-verification",
  validate({ body: emailBodySchema }),
  resendVerificationHandler,
);
authRouter.post("/forgot-password", validate({ body: emailBodySchema }), forgotPasswordHandler);
authRouter.post(
  "/reset-password",
  validate({ body: resetPasswordBodySchema }),
  resetPasswordHandler,
);
authRouter.get(
  "/google/callback",
  validate({ query: googleCallbackQuerySchema }),
  googleCallbackHandler,
);
authRouter.get("/google", validate({ query: googleStartQuerySchema }), googleStartHandler);
authRouter.get("/me", authenticate, meHandler);

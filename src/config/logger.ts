import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "accessToken",
      "refreshToken",
      "appSecret",
      "privateNotes",
      "encryptedPrivateNotes",
      "req.body.password",
      "req.body.token",
    ],
    censor: "[REDACTED]",
  },
});

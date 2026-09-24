import "dotenv/config";
import { z } from "zod";

const nodeEnv = process.env.NODE_ENV ?? "development";
const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/dev_assess?schema=public";
const developmentJwtSecret = "development-only-secret-change-before-production";
const developmentEncryptionKey = "development-only-private-note-encryption-key-change-me";
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(5000),
    API_PREFIX: z.string().startsWith("/").default("/api/v1"),
    APP_NAME: z.string().min(1).default("DevAssess API"),
    APP_BASE_URL: z.url().default("http://localhost:5000"),
    CANDIDATE_APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.url(),
    UPSTASH_REDIS_REST_URL: z.url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    METRICS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    METRICS_TOKEN: optionalString,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    MAINTENANCE_JOBS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MAINTENANCE_JOB_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
    MAINTENANCE_JOB_BATCH_SIZE: z.coerce.number().int().positive().max(1_000).default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    PAYMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(35_000),
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(5_000),
    JWT_ACCESS_SECRET: z.string().min(32).default(developmentJwtSecret),
    SENSITIVE_DATA_ENCRYPTION_KEY: z.string().min(32).default(developmentEncryptionKey),
    JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),
    REFRESH_COOKIE_NAME: z.string().min(1).default("devassess_refresh"),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_REDIRECT_URI: z.url().default("http://localhost:5000/api/v1/auth/google/callback"),
    GOOGLE_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().max(1800).default(600),
    BKASH_BASE_URL: z
      .url()
      .default("https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout"),
    BKASH_APP_KEY: optionalString,
    BKASH_APP_SECRET: optionalString,
    BKASH_USERNAME: optionalString,
    BKASH_PASSWORD: optionalString,
    BKASH_CALLBACK_URL: z.url().default("http://localhost:5000/api/v1/payments/bkash/callback"),
    BKASH_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    EMAIL_FROM: z.string().min(1).default("DevAssess <no-reply@devassess.local>"),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === "production" && values.JWT_ACCESS_SECRET === developmentJwtSecret) {
      context.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "A production JWT secret must be configured",
      });
    }
    if (
      values.NODE_ENV === "production" &&
      values.SENSITIVE_DATA_ENCRYPTION_KEY === developmentEncryptionKey
    ) {
      context.addIssue({
        code: "custom",
        path: ["SENSITIVE_DATA_ENCRYPTION_KEY"],
        message: "A production private-data encryption key must be configured",
      });
    }

    if (Boolean(values.GOOGLE_CLIENT_ID) !== Boolean(values.GOOGLE_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together",
      });
    }

    if (values.NODE_ENV === "production" && values.METRICS_ENABLED && !values.METRICS_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["METRICS_TOKEN"],
        message: "A metrics bearer token is required when production metrics are enabled",
      });
    }

    const bkashValues = [
      values.BKASH_APP_KEY,
      values.BKASH_APP_SECRET,
      values.BKASH_USERNAME,
      values.BKASH_PASSWORD,
    ];
    if (bkashValues.some(Boolean) && !bkashValues.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["BKASH_APP_KEY"],
        message: "All four bKash credentials must be configured together",
      });
    }
  });

const parsed = envSchema.safeParse({
  ...process.env,
  NODE_ENV: nodeEnv,
  DATABASE_URL:
    process.env.DATABASE_URL ?? (nodeEnv === "production" ? undefined : localDatabaseUrl),
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

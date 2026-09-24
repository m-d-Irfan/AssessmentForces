process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-with-at-least-thirty-two-characters";
process.env.SENSITIVE_DATA_ENCRYPTION_KEY =
  "test-encryption-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/dev_assess_test?schema=public";
process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.METRICS_ENABLED = "true";
process.env.METRICS_TOKEN = "";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.MAINTENANCE_JOBS_ENABLED = "false";
process.env.LOG_LEVEL = "silent";

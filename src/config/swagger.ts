import { env } from "./env.js";

const jsonBody = (schema: object) => ({
  required: true,
  content: { "application/json": { schema } },
});
const ok = { description: "Successful response" };
const bearer = [{ bearerAuth: [] }];

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: env.APP_NAME,
    version: "0.10.0",
    description: "Backend API for developer assessments, authentication, and recruiter workflows.",
  },
  servers: [{ url: `http://localhost:${env.PORT}`, description: "Local development" }],
  tags: [
    { name: "System", description: "Service health and readiness" },
    { name: "Authentication", description: "Local sessions, email verification, and Google OAuth" },
    { name: "Problems", description: "Company question bank and immutable versions" },
    { name: "Assessments", description: "Assessment composition and lifecycle" },
    { name: "Payments", description: "bKash sandbox payments and reconciliation" },
    { name: "Credits", description: "Credit packages, balances, and immutable ledger" },
    { name: "Invitations", description: "Credit-backed candidate assessment invitations" },
    { name: "Attempts", description: "Timed candidate assessment-taking workflow" },
    { name: "Evaluations", description: "Automatic and recruiter assessment grading" },
    { name: "Results", description: "Result review, controlled release, and candidate access" },
    { name: "Notifications", description: "Authenticated user notification inbox" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      refreshCookie: { type: "apiKey", in: "cookie", name: env.REFRESH_COOKIE_NAME },
    },
    schemas: {
      RegisterRequest: {
        type: "object",
        required: ["email", "password", "displayName", "role"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 12, format: "password" },
          displayName: { type: "string" },
          role: { type: "string", enum: ["CANDIDATE", "RECRUITER"] },
        },
      },
      ProblemVersionRequest: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          explanation: { type: "string" },
          starterCode: { type: "string" },
          allowedLanguages: { type: "array", items: { type: "string" } },
          answerConfig: { type: "object", additionalProperties: true },
          options: {
            type: "array",
            items: {
              type: "object",
              required: ["label", "content", "isCorrect"],
              properties: {
                label: { type: "string" },
                content: { type: "string" },
                isCorrect: { type: "boolean" },
              },
            },
          },
          testCases: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      InitiatePaymentRequest: {
        type: "object",
        required: ["companyId", "creditPackageId"],
        properties: {
          companyId: { type: "string" },
          creditPackageId: { type: "string" },
          payerReference: { type: "string", maxLength: 100 },
        },
      },
      CreateInvitationRequest: {
        type: "object",
        required: ["assessmentId", "candidateEmail", "expiresAt"],
        properties: {
          assessmentId: { type: "string" },
          candidateEmail: { type: "string", format: "email" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      SaveAnswerRequest: {
        type: "object",
        properties: {
          response: { description: "Choice or text response" },
          sourceCode: { type: "string" },
          language: { type: "string" },
        },
      },
      GradeAnswerRequest: {
        type: "object",
        required: ["score"],
        properties: {
          score: { type: "number", minimum: 0 },
          feedback: { type: "string", maxLength: 10000 },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: { tags: ["System"], summary: "Liveness check", responses: { "200": ok } },
    },
    "/ready": {
      get: {
        tags: ["System"],
        summary: "PostgreSQL and Redis readiness",
        responses: { "200": ok, "503": { description: "A dependency is unavailable" } },
      },
    },
    [`${env.API_PREFIX}/auth/register`]: {
      post: {
        tags: ["Authentication"],
        summary: "Register a candidate or recruiter",
        requestBody: jsonBody({ $ref: "#/components/schemas/RegisterRequest" }),
        responses: { "201": ok, "409": { description: "Email already registered" } },
      },
    },
    [`${env.API_PREFIX}/auth/login`]: {
      post: {
        tags: ["Authentication"],
        summary: "Login with email and password",
        requestBody: jsonBody({
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string", format: "email" }, password: { type: "string" } },
        }),
        responses: { "200": ok, "401": { description: "Invalid credentials" } },
      },
    },
    [`${env.API_PREFIX}/auth/refresh`]: {
      post: {
        tags: ["Authentication"],
        summary: "Rotate the refresh session and issue an access token",
        security: [{ refreshCookie: [] }],
        responses: { "200": ok, "401": { description: "Invalid or reused refresh token" } },
      },
    },
    [`${env.API_PREFIX}/auth/logout`]: {
      post: {
        tags: ["Authentication"],
        summary: "Revoke the refresh session",
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/logout-all`]: {
      post: {
        tags: ["Authentication"],
        summary: "Revoke every user session",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/verify-email`]: {
      post: {
        tags: ["Authentication"],
        summary: "Verify an email token",
        requestBody: jsonBody({
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" } },
        }),
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/resend-verification`]: {
      post: {
        tags: ["Authentication"],
        summary: "Request another verification token",
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/forgot-password`]: {
      post: {
        tags: ["Authentication"],
        summary: "Request a password reset token",
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/reset-password`]: {
      post: {
        tags: ["Authentication"],
        summary: "Reset a password and revoke sessions",
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/auth/google`]: {
      get: {
        tags: ["Authentication"],
        summary: "Start Google OAuth with PKCE",
        parameters: [
          {
            name: "role",
            in: "query",
            schema: { type: "string", enum: ["CANDIDATE", "RECRUITER"] },
          },
        ],
        responses: { "302": { description: "Redirect to Google" } },
      },
    },
    [`${env.API_PREFIX}/auth/google/callback`]: {
      get: { tags: ["Authentication"], summary: "Complete Google OAuth", responses: { "200": ok } },
    },
    [`${env.API_PREFIX}/auth/me`]: {
      get: {
        tags: ["Authentication"],
        summary: "Get the current user",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/problems`]: {
      post: {
        tags: ["Problems"],
        summary: "Create a problem and its first version",
        security: bearer,
        requestBody: jsonBody({
          type: "object",
          required: ["companyId", "title", "type", "difficulty", "version"],
          properties: {
            companyId: { type: "string" },
            title: { type: "string" },
            type: {
              type: "string",
              enum: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SHORT_TEXT", "CODE"],
            },
            difficulty: { type: "string", enum: ["EASY", "MEDIUM", "HARD"] },
            version: { $ref: "#/components/schemas/ProblemVersionRequest" },
          },
        }),
        responses: { "201": ok },
      },
      get: {
        tags: ["Problems"],
        summary: "List and filter problems",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/problems/{id}`]: {
      get: {
        tags: ["Problems"],
        summary: "Get a problem",
        security: bearer,
        responses: { "200": ok },
      },
      patch: {
        tags: ["Problems"],
        summary: "Update problem metadata or status",
        security: bearer,
        responses: { "200": ok },
      },
      delete: {
        tags: ["Problems"],
        summary: "Soft-delete a problem",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/problems/{id}/versions`]: {
      post: {
        tags: ["Problems"],
        summary: "Create an immutable problem version",
        security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/ProblemVersionRequest" }),
        responses: { "201": ok },
      },
    },
    [`${env.API_PREFIX}/assessments`]: {
      post: {
        tags: ["Assessments"],
        summary: "Create a draft assessment",
        security: bearer,
        responses: { "201": ok },
      },
      get: {
        tags: ["Assessments"],
        summary: "List and filter assessments",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/assessments/{id}`]: {
      get: {
        tags: ["Assessments"],
        summary: "Get an assessment",
        security: bearer,
        responses: { "200": ok },
      },
      patch: {
        tags: ["Assessments"],
        summary: "Update a draft assessment",
        security: bearer,
        responses: { "200": ok },
      },
      delete: {
        tags: ["Assessments"],
        summary: "Soft-delete a draft assessment",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/assessments/{id}/items`]: {
      post: {
        tags: ["Assessments"],
        summary: "Add a published problem version",
        security: bearer,
        responses: { "201": ok },
      },
    },
    [`${env.API_PREFIX}/assessments/{id}/items/{itemId}`]: {
      patch: {
        tags: ["Assessments"],
        summary: "Update item points or order",
        security: bearer,
        responses: { "200": ok },
      },
      delete: {
        tags: ["Assessments"],
        summary: "Remove an assessment item",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/assessments/{id}/publish`]: {
      post: {
        tags: ["Assessments"],
        summary: "Publish and freeze an assessment",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/assessments/{id}/archive`]: {
      post: {
        tags: ["Assessments"],
        summary: "Archive a published assessment",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/credit-packages`]: {
      get: {
        tags: ["Credits"],
        summary: "List active credit packages",
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/payments/bkash/initiate`]: {
      post: {
        tags: ["Payments"],
        summary: "Create a bKash sandbox payment",
        description: "Uses the package price and credit quantity stored by the server.",
        security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/InitiatePaymentRequest" }),
        responses: { "201": ok, "503": { description: "bKash is not configured" } },
      },
    },
    [`${env.API_PREFIX}/payments/bkash/callback`]: {
      get: {
        tags: ["Payments"],
        summary: "Process the bKash checkout callback",
        parameters: [
          { name: "paymentID", in: "query", required: true, schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["success", "failure", "cancel"] },
          },
        ],
        responses: { "200": ok, "409": { description: "Payment is not completed" } },
      },
    },
    [`${env.API_PREFIX}/payments/bkash/webhook`]: {
      post: {
        tags: ["Payments"],
        summary: "Receive and independently verify a bKash payment notification",
        requestBody: jsonBody({
          type: "object",
          required: ["paymentID"],
          properties: { paymentID: { type: "string" } },
          additionalProperties: true,
        }),
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/payments`]: {
      get: {
        tags: ["Payments"],
        summary: "List company-scoped payment history",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/payments/{id}`]: {
      get: {
        tags: ["Payments"],
        summary: "Get a payment and its provider events",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/payments/{id}/reconcile`]: {
      post: {
        tags: ["Payments"],
        summary: "Query bKash and safely reconcile a pending payment",
        security: bearer,
        responses: { "200": ok, "409": { description: "Payment is not completed" } },
      },
    },
    [`${env.API_PREFIX}/credits/balance`]: {
      get: {
        tags: ["Credits"],
        summary: "Get a company credit balance",
        security: bearer,
        parameters: [
          { name: "companyId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/credits/ledger`]: {
      get: {
        tags: ["Credits"],
        summary: "List a company's immutable credit ledger",
        security: bearer,
        parameters: [
          { name: "companyId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/invitations`]: {
      post: {
        tags: ["Invitations"],
        summary: "Invite a registered candidate and consume one company credit",
        security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateInvitationRequest" }),
        responses: {
          "201": ok,
          "402": { description: "Company has insufficient credits" },
          "409": { description: "Candidate was already invited" },
        },
      },
      get: {
        tags: ["Invitations"],
        summary: "List company invitations",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/invitations/mine`]: {
      get: {
        tags: ["Invitations"],
        summary: "List invitations for the authenticated candidate",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/invitations/token/{token}`]: {
      get: {
        tags: ["Invitations"],
        summary: "Verify and retrieve an invitation as its candidate",
        security: bearer,
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": ok, "404": { description: "Invitation not found" } },
      },
    },
    [`${env.API_PREFIX}/invitations/{id}`]: {
      get: {
        tags: ["Invitations"],
        summary: "Get a company invitation",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/invitations/{id}/revoke`]: {
      post: {
        tags: ["Invitations"],
        summary: "Revoke a pending invitation and refund its credit",
        security: bearer,
        responses: { "200": ok, "409": { description: "Invitation cannot be revoked" } },
      },
    },
    [`${env.API_PREFIX}/attempts/start`]: {
      post: {
        tags: ["Attempts"],
        summary: "Start or resume an attempt from an invitation token",
        security: bearer,
        requestBody: jsonBody({
          type: "object",
          required: ["invitationToken"],
          properties: { invitationToken: { type: "string" } },
        }),
        responses: {
          "201": ok,
          "409": { description: "Invitation or assessment is unavailable" },
        },
      },
    },
    [`${env.API_PREFIX}/attempts/{id}`]: {
      get: {
        tags: ["Attempts"],
        summary: "Get an attempt with candidate-safe assessment questions and saved answers",
        description: "Correct answers and hidden test cases are never included.",
        security: bearer,
        responses: { "200": ok, "404": { description: "Attempt not found" } },
      },
    },
    [`${env.API_PREFIX}/attempts/{id}/answers/{itemId}`]: {
      put: {
        tags: ["Attempts"],
        summary: "Create or replace a saved answer",
        security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/SaveAnswerRequest" }),
        responses: {
          "200": ok,
          "409": { description: "Attempt is submitted or expired" },
        },
      },
    },
    [`${env.API_PREFIX}/attempts/{id}/submit`]: {
      post: {
        tags: ["Attempts"],
        summary: "Submit an attempt and queue it for evaluation",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/attempts/{id}/tab-change`]: {
      post: {
        tags: ["Attempts"],
        summary: "Auto-submit an attempt when the assessment page loses visibility",
        description:
          "The frontend calls this endpoint immediately after detecting a tab change or hidden page.",
        security: bearer,
        responses: { "200": ok, "404": { description: "Attempt not found" } },
      },
    },
    [`${env.API_PREFIX}/evaluations`]: {
      get: {
        tags: ["Evaluations"],
        summary: "List company-scoped evaluations",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/evaluations/{id}`]: {
      get: {
        tags: ["Evaluations"],
        summary: "Get an evaluation with answers and grading material",
        security: bearer,
        responses: { "200": ok, "404": { description: "Evaluation not found" } },
      },
    },
    [`${env.API_PREFIX}/evaluations/{id}/auto-grade`]: {
      post: {
        tags: ["Evaluations"],
        summary: "Grade choice and configured short-text answers",
        description:
          "Choice responses use optionId or optionIds. Short-text grading uses answerConfig.acceptedAnswers and answerConfig.caseSensitive.",
        security: bearer,
        responses: { "200": ok, "409": { description: "Evaluation is already completed" } },
      },
    },
    [`${env.API_PREFIX}/evaluations/{id}/answers/{answerId}`]: {
      patch: {
        tags: ["Evaluations"],
        summary: "Manually grade an answer",
        security: bearer,
        requestBody: jsonBody({ $ref: "#/components/schemas/GradeAnswerRequest" }),
        responses: {
          "200": ok,
          "400": { description: "Score exceeds available points" },
        },
      },
    },
    [`${env.API_PREFIX}/evaluations/{id}/finalize`]: {
      post: {
        tags: ["Evaluations"],
        summary: "Finalize scores and create an unreleased candidate result",
        security: bearer,
        requestBody: jsonBody({
          type: "object",
          properties: { notes: { type: "string", maxLength: 20000 } },
        }),
        responses: {
          "200": ok,
          "409": { description: "One or more submitted answers still require grading" },
        },
      },
    },
    [`${env.API_PREFIX}/results`]: {
      get: {
        tags: ["Results"],
        summary: "List company-scoped assessment results",
        security: bearer,
        parameters: [
          { name: "companyId", in: "query", schema: { type: "string" } },
          { name: "assessmentId", in: "query", schema: { type: "string" } },
          { name: "candidateId", in: "query", schema: { type: "string" } },
          { name: "passed", in: "query", schema: { type: "boolean" } },
          { name: "released", in: "query", schema: { type: "boolean" } },
        ],
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/results/mine`]: {
      get: {
        tags: ["Results"],
        summary: "List the authenticated candidate's released results",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/results/mine/{id}`]: {
      get: {
        tags: ["Results"],
        summary: "Get one released result with answer scores and feedback",
        security: bearer,
        responses: { "200": ok, "404": { description: "Released result not found" } },
      },
    },
    [`${env.API_PREFIX}/results/{id}`]: {
      get: {
        tags: ["Results"],
        summary: "Get a result for recruiter review",
        security: bearer,
        responses: { "200": ok },
      },
      patch: {
        tags: ["Results"],
        summary: "Update the summary of an unreleased result",
        security: bearer,
        requestBody: jsonBody({
          type: "object",
          required: ["summary"],
          properties: { summary: { type: ["string", "null"], maxLength: 20000 } },
        }),
        responses: { "200": ok, "409": { description: "Result is already released" } },
      },
    },
    [`${env.API_PREFIX}/results/{id}/release`]: {
      post: {
        tags: ["Results"],
        summary: "Release a finalized result to its candidate",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/notifications`]: {
      get: {
        tags: ["Notifications"],
        summary: "List notifications for the authenticated user",
        security: bearer,
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "unreadOnly", in: "query", schema: { type: "boolean" } },
          { name: "type", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/notifications/unread-count`]: {
      get: {
        tags: ["Notifications"],
        summary: "Get the authenticated user's unread notification count",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/notifications/read-all`]: {
      post: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        security: bearer,
        responses: { "200": ok },
      },
    },
    [`${env.API_PREFIX}/notifications/{id}/read`]: {
      patch: {
        tags: ["Notifications"],
        summary: "Mark one owned notification as read",
        security: bearer,
        responses: { "200": ok, "404": { description: "Notification not found" } },
      },
    },
  },
};

# Assessment Forces API

Assessment Forces (formerly DevGauge) is a production-ready, backend-focused REST API for structured developer assessments, recruitment workflows, and candidate evaluations. It empowers recruitment teams and companies to create question banks, assemble time-boxed assessments, purchase invitation credits via bKash, invite candidates, capture proctored attempts, perform automatic & manual evaluations, run multi-stage hiring pipelines, and track organizational analytics.

Built with **Node.js (ESM)**, **TypeScript**, **Express 5**, **PostgreSQL** (configured for **Neon** serverless Postgres via **Prisma 6**), and **Upstash Redis REST** for caching, rate limiting, and session security.

---

## Live Deployment & Interactive Documentation

- **Live Base URL:** [https://assessment-forces.onrender.com](https://assessment-forces.onrender.com)
- **API Version 1 Root:** [https://assessment-forces.onrender.com/api/v1](https://assessment-forces.onrender.com/api/v1)
- **Interactive Swagger UI:** [https://assessment-forces.onrender.com/api-docs/](https://assessment-forces.onrender.com/api-docs/)
- **Raw OpenAPI 3.1 Specification:** [https://assessment-forces.onrender.com/api-docs.json](https://assessment-forces.onrender.com/api-docs.json)
- **Service Health Check:** [https://assessment-forces.onrender.com/health](https://assessment-forces.onrender.com/health)
- **Service Readiness Check:** [https://assessment-forces.onrender.com/ready](https://assessment-forces.onrender.com/ready)

---

## Core Problem & Workflow

Recruiting and engineering teams frequently struggle with spreadsheet tracking, insecure link sharing, and untrusted client-side assessment timers. Assessment Forces enforces an authoritative, server-driven lifecycle:

```text
Recruiter creates problem bank → composes assessment → purchases credits via bKash
→ invites candidate via email → candidate starts timed attempt (server-enforced clock)
→ candidate saves answers & submits (or auto-submits on tab blur/timer expiry)
→ system auto-grades objective questions → recruiter reviews & scores open answers
→ recruiter finalizes and releases report to candidate → advances candidate in multi-stage recruitment pipeline
```

---

## Primary Roles & Access Control

The platform enforces strict Role-Based Access Control (RBAC) and tenancy isolation across three primary user roles:

| Role | Responsibilities & Capabilities |
| :--- | :--- |
| **Candidate** | Maintain profile, view received assessment invitations, start one valid attempt per token, save progressive answers, trigger manual or tab-change submissions, view released scores, and track multi-stage job applications. |
| **Recruiter** | Manage company profile and team members, create problems (MCQ, choice, short text, code starter), assemble and freeze published assessments, purchase credit packages through bKash, issue invitations, grade submissions, finalize results, manage recruitment pipelines, and review company analytics. |
| **Admin** | Global platform governance: manage users, verify or suspend companies, manually adjust credit ledgers with audit justification, configure credit packages, and inspect immutable system audit logs. |

---

## System Architecture

Assessment Forces is architected as a modular monolith: clean domain boundary separation with a single deployable Express 5 runtime backed by PostgreSQL and Redis.

```mermaid
flowchart LR
  Client[Web / Postman / Mobile Client] --> Gateway[Express 5 API: /api/v1]
  Gateway --> Security[Security Headers: Helmet / CORS / Rate Limiting]
  Security --> Auth[JWT & Cookie Auth / Google OAuth]
  Auth --> Modules[Feature Modules]
  Modules --> Problems[Problems Bank & Versions]
  Modules --> Assessments[Assessments & Items]
  Modules --> Attempts[Invitations & Timed Attempts]
  Modules --> Evaluations[Auto-Grading & Scoring]
  Modules --> Recruitment[Recruitment Programs & Multi-Stage Pipelines]
  Modules --> Payments[bKash Payments & Credit Ledger]
  Modules --> Analytics[Dashboards & Notifications]
  Modules --> Admin[Platform Governance & Audit Logs]
  Modules --> DB[(Neon Serverless PostgreSQL via Prisma)]
  Modules --> Cache[(Upstash Redis REST: Cache / Sessions / Limits)]
```

### Directory Structure

```text
.
├── src/
│   ├── config/             # Environment schemas (Zod), logger (Pino), database & swagger
│   ├── integrations/       # bKash payment gateway, Nodemailer SMTP, and Google OAuth
│   ├── jobs/               # Background maintenance jobs (expired attempts, cleanup)
│   ├── middlewares/        # Authentication, RBAC, request validation, rate limiting, metrics
│   ├── modules/
│   │   ├── admin/          # Platform governance, user/company status, credit packages, audit logs
│   │   ├── analytics/      # Company, candidate, assessment, and admin dashboards
│   │   ├── assessments/    # Assessment authoring, item assignment, publish & archive
│   │   ├── attempts/       # Timed attempt management, progressive answer saving, tab blur handling
│   │   ├── auth/           # Local register/login, token rotation, email verification, Google OAuth
│   │   ├── evaluations/    # Automated MCQ/short-text grading and manual rubric evaluation
│   │   ├── invitations/    # Candidate invitation tokens, token validation, candidate lists
│   │   ├── notifications/  # In-app notifications and unread badges
│   │   ├── payments/       # bKash checkout initiation, callbacks, webhook reconciliation, ledger
│   │   ├── problems/       # Versioned question bank (MCQ, short-text, code snippets)
│   │   ├── recruitment/    # Multi-stage recruitment programs, interview scheduling, stage reviews
│   │   ├── results/        # Candidate result release management and breakdown
│   │   └── system/         # /health, /ready, and Prometheus-compatible /metrics
│   ├── shared/             # Standard API responses, error classes, crypto utilities
│   ├── app.ts              # Express application factory with middleware chaining
│   └── server.ts           # HTTP server bootstrapper with graceful shutdown handling
├── prisma/
│   ├── schema.prisma       # Complete schema definitions, enums, relations, and indexes
│   ├── seed.ts             # Default administrator and sample test seed data
│   └── migrations/         # Prisma migration history
└── tests/                  # Automated integration, security, validation, and contract tests
```

---

## Assessment & Attempt Lifecycle

The attempt lifecycle is strictly server-governed to prevent tampering with client-side timers or re-submitting after deadlines:

```mermaid
stateDiagram-v2
  [*] --> DRAFT: Recruiter creates assessment
  DRAFT --> PUBLISHED: Recruiter adds problems and publishes
  PUBLISHED --> INVITED: Recruiter issues invitation (deducts 1 credit)
  INVITED --> IN_PROGRESS: Candidate opens token & starts attempt
  INVITED --> EXPIRED: Invitation deadline elapses
  IN_PROGRESS --> SUBMITTED: Candidate clicks submit
  IN_PROGRESS --> AUTO_SUBMITTED: Server timer expires or Tab Change detected
  SUBMITTED --> EVALUATING
  AUTO_SUBMITTED --> EVALUATING
  EVALUATING --> SCORED: Objective items auto-graded & manual review completed
  SCORED --> RESULT_RELEASED: Recruiter releases result to candidate
  RESULT_RELEASED --> [*]
```

### Key Business & Security Rules

1. **Credit-Backed Invitations:** Recruiters purchase invitation credits in bundles via bKash. Each candidate invitation consumes 1 credit within an atomic database transaction.
2. **Authoritative Clock:** Attempt start time (`startedAt`) and deadline (`expiresAt`) are stamped and calculated by the backend. Client clocks are strictly informational.
3. **Proctoring / Anti-Cheat Signal:** The API features a dedicated tab-change endpoint (`POST /api/v1/attempts/:id/tab-change`) that automatically transitions the attempt to `AUTO_SUBMITTED` when page visibility changes.
4. **Idempotent Operations:** Repeated submission or payment callback requests are idempotent, preventing double grading or duplicate credit allocations.
5. **Immutable Problem Versions:** Once an assessment is published and attempted, referenced problem versions cannot be mutated, preserving historical evaluation integrity.
6. **Audit Trail:** Key administrative, financial, and lifecycle actions are recorded as immutable records in the `audit_logs` table.

---

## bKash Tokenized Checkout Flow

DevGauge integrates with bKash Tokenized Checkout (v1.2.0-beta) for acquiring company assessment credits:

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant API as Assessment Forces API
  participant BK as bKash Gateway
  participant DB as Neon PostgreSQL
  participant RD as Upstash Redis

  R->>API: POST /api/v1/payments/bkash/initiate { companyId, creditPackageId }
  API->>RD: Retrieve cached bKash grant token (or grant new)
  API->>BK: Create payment request (Tokenized Checkout)
  BK-->>API: Returns paymentID and bkashURL
  API->>DB: Records payment in PENDING status
  API-->>R: Returns checkout URL
  R->>BK: Completes wallet authentication, OTP, and PIN
  BK-->>API: GET /api/v1/payments/bkash/callback?paymentID=...&status=success
  API->>BK: Execute payment request
  API->>DB: Transaction: Set payment COMPLETED, insert Credit Ledger entry
  API-->>R: Returns payment success confirmation and credited balance
```

---

## API Endpoints Reference

All endpoints (except public authentication and health checks) require an `Authorization: Bearer <token>` header or valid session cookies.

### System & Documentation
- `GET /health` — Liveness status and uptime
- `GET /ready` — Readiness probe (validates PostgreSQL and Upstash Redis connections)
- `GET /metrics` — Prometheus metrics (optionally protected by `METRICS_TOKEN`)
- `GET /api-docs` — Swagger UI interactive portal
- `GET /api-docs.json` — OpenAPI 3.1 specification
- `GET /api/v1` — API metadata root

### Authentication & User Management
- `POST /api/v1/auth/register` — Create candidate or recruiter account
- `POST /api/v1/auth/login` — Sign in with email and password
- `POST /api/v1/auth/refresh` — Issue fresh access token via refresh token/cookie
- `POST /api/v1/auth/logout` — Invalidate current session
- `POST /api/v1/auth/logout-all` — Invalidate all sessions for user
- `POST /api/v1/auth/verify-email` — Verify email via sent token
- `POST /api/v1/auth/resend-verification` — Resend verification email
- `POST /api/v1/auth/forgot-password` — Request password reset email
- `POST /api/v1/auth/reset-password` — Complete password reset
- `GET /api/v1/auth/google` — Initiate Google OAuth2 flow with PKCE
- `GET /api/v1/auth/google/callback` — Google OAuth2 callback handler
- `GET /api/v1/auth/me` — Retrieve authenticated user profile

### Problems Bank
- `POST /api/v1/problems` — Create a problem with initial version (Recruiter/Admin)
- `GET /api/v1/problems` — List company problems with pagination and filters
- `GET /api/v1/problems/:id` — Retrieve problem details
- `PATCH /api/v1/problems/:id` — Update problem details
- `DELETE /api/v1/problems/:id` — Soft delete problem
- `POST /api/v1/problems/:id/versions` — Create an immutable version of problem

### Assessments
- `POST /api/v1/assessments` — Create draft assessment
- `GET /api/v1/assessments` — List assessments (filters for status, tags, company)
- `GET /api/v1/assessments/:id` — Retrieve assessment details
- `PATCH /api/v1/assessments/:id` — Update draft assessment
- `DELETE /api/v1/assessments/:id` — Soft delete assessment
- `POST /api/v1/assessments/:id/items` — Attach problem version to assessment
- `PATCH /api/v1/assessments/:id/items/:itemId` — Update point value or order
- `DELETE /api/v1/assessments/:id/items/:itemId` — Remove problem from assessment
- `POST /api/v1/assessments/:id/publish` — Publish and freeze assessment
- `POST /api/v1/assessments/:id/archive` — Archive assessment

### Invitations & Attempts
- `GET /api/v1/invitations/mine` — Candidate lists received invitations
- `GET /api/v1/invitations/token/:token` — Verify invitation token details
- `POST /api/v1/attempts/start` — Start/resume timed assessment attempt
- `GET /api/v1/attempts/:id` — Retrieve attempt state, questions, and saved answers
- `PUT /api/v1/attempts/:id/answers/:itemId` — Progressively save/update answer
- `POST /api/v1/attempts/:id/submit` — Final candidate submission
- `POST /api/v1/attempts/:id/tab-change` — Auto-submit attempt upon tab blur / visibility loss

### Evaluations & Results
- `GET /api/v1/evaluations` — List company evaluations
- `GET /api/v1/evaluations/:id` — Get evaluation details with candidate responses
- `POST /api/v1/evaluations/:id/auto-grade` — Run automated scoring for choice and configured short-text items
- `PATCH /api/v1/evaluations/:id/answers/:answerId` — Manually grade and score open answers
- `POST /api/v1/evaluations/:id/finalize` — Finalize evaluation scores
- `GET /api/v1/results` — List company assessment results
- `GET /api/v1/results/:id` — Recruiter view of single result
- `PATCH /api/v1/results/:id` — Update result summary notes
- `POST /api/v1/results/:id/release` — Release scored report to candidate
- `GET /api/v1/results/mine` — Candidate lists their released results
- `GET /api/v1/results/mine/:id` — Candidate views their detailed report

### Recruitment Programs (Multi-Stage Pipeline)
- `POST /api/v1/recruitment-programs` — Create new hiring program
- `GET /api/v1/recruitment-programs` — List active recruitment programs
- `GET /api/v1/recruitment-programs/:id` — Get program details
- `PATCH /api/v1/recruitment-programs/:id` — Update draft program
- `POST /api/v1/recruitment-programs/:id/stages` — Add interview/coding/HR stage
- `PUT /api/v1/recruitment-programs/:id/stages/order` — Reorder pipeline stages
- `PUT /api/v1/recruitment-programs/:id/stages/:stageId/assignees` — Assign reviewers to stage
- `POST /api/v1/recruitment-programs/:id/start` — Lock program and activate pipeline
- `POST /api/v1/recruitment-programs/:id/invitations` — Invite candidate or team reviewer
- `GET /api/v1/recruitment-programs/invitations/:token` — Preview program invitation
- `POST /api/v1/recruitment-programs/invitations/:token/accept` — Accept program invitation
- `GET /api/v1/recruitment-programs/my-applications` — Candidate track application stage progress
- `GET /api/v1/recruitment-programs/:id/applications` — List candidates in recruitment pipeline
- `GET /api/v1/recruitment-programs/tasks/mine` — Reviewer gets assigned stage tasks
- `POST /api/v1/recruitment-programs/tasks/:progressId/reviews` — Submit stage review
- `POST /api/v1/recruitment-programs/tasks/:progressId/schedule` — Schedule stage interview
- `POST /api/v1/recruitment-programs/tasks/:progressId/finalize` — Lead recruiter advances or rejects candidate

### Payments & Credits
- `GET /api/v1/credit-packages` — List available credit packages
- `POST /api/v1/payments/bkash/initiate` — Initiate bKash checkout payment
- `GET /api/v1/payments/bkash/callback` — bKash checkout callback handler
- `POST /api/v1/payments/bkash/webhook` — bKash asynchronous webhook endpoint
- `GET /api/v1/payments` — List company payments
- `GET /api/v1/payments/:id` — View payment details
- `POST /api/v1/payments/:id/reconcile` — Reconcile pending bKash transaction
- `GET /api/v1/credits/balance` — View company credit balance
- `GET /api/v1/credits/ledger` — View company immutable credit ledger

### Notifications & Analytics
- `GET /api/v1/notifications` — List notifications for authenticated user
- `GET /api/v1/notifications/unread-count` — Count of unread notifications
- `POST /api/v1/notifications/read-all` — Mark all notifications as read
- `PATCH /api/v1/notifications/:id/read` — Mark single notification as read
- `GET /api/v1/analytics/company` — Recruiter organization analytics (cached in Redis)
- `GET /api/v1/analytics/assessments/:assessmentId` — Assessment performance analytics
- `GET /api/v1/analytics/candidate` — Candidate self-progress dashboard
- `GET /api/v1/analytics/admin` — Platform overview analytics (Admin only)

### Administration
- `GET /api/v1/admin/users` — Search and filter users
- `GET /api/v1/admin/users/:id` — View user details
- `PATCH /api/v1/admin/users/:id/status` — Activate or suspend user
- `GET /api/v1/admin/companies` — Search and filter companies
- `GET /api/v1/admin/companies/:id` — View company details
- `PATCH /api/v1/admin/companies/:id/status` — Activate or suspend company
- `PATCH /api/v1/admin/companies/:id/verification` — Toggle company verification
- `POST /api/v1/admin/companies/:id/credits/adjust` — Manual audited credit adjustment
- `GET /api/v1/admin/credit-packages` — List all credit packages
- `POST /api/v1/admin/credit-packages` — Create credit package
- `PATCH /api/v1/admin/credit-packages/:id` — Update credit package
- `DELETE /api/v1/admin/credit-packages/:id` — Soft delete credit package
- `GET /api/v1/admin/audit-logs` — Search platform audit records

---

## Local Development & Setup

### Prerequisites
- **Node.js**: >= 20.0.0 (Node 22 or 24 LTS recommended)
- **PostgreSQL**: Neon Cloud Postgres (or local PostgreSQL 15+)
- **Redis**: Upstash Redis REST endpoint (or compatible service)
- **Package Manager**: npm (v10+)

### Setup Instructions

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/m-d-Irfan/AssessmentForces.git
   cd AssessmentForces
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the project root:
   ```env
   NODE_ENV=development
   PORT=5000
   API_PREFIX=/api/v1
   APP_NAME="Assessment Forces API"
   APP_BASE_URL=http://localhost:5000
   CANDIDATE_APP_URL=http://localhost:3000
   CORS_ORIGINS="http://localhost:3000,http://localhost:5000"

   # Database (Neon PostgreSQL)
   DATABASE_URL="postgresql://user:password@ep-pooled.neon.tech/neondb?sslmode=require"
   DATABASE_URL_UNPOOLED="postgresql://user:password@ep-direct.neon.tech/neondb?sslmode=require"

   # Upstash Redis REST
   UPSTASH_REDIS_REST_URL="https://your-upstash-instance.upstash.io"
   UPSTASH_REDIS_REST_TOKEN="your-upstash-rest-token"

   # Security & Cryptography (Generate at least 32 random characters for each)
   JWT_ACCESS_SECRET="generate-a-strong-32-char-random-secret-for-jwt"
   SENSITIVE_DATA_ENCRYPTION_KEY="generate-a-strong-32-char-key-for-data-encryption"
   JWT_ACCESS_TTL_MINUTES=15
   REFRESH_TOKEN_TTL_DAYS=30
   REFRESH_COOKIE_NAME=devassess_refresh

   # Google OAuth (Optional for local testing)
   GOOGLE_CLIENT_ID=""
   GOOGLE_CLIENT_SECRET=""
   GOOGLE_REDIRECT_URI=http://localhost:5000/api/v1/auth/google/callback

   # bKash Sandbox (Optional for local testing)
   BKASH_BASE_URL="https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout"
   BKASH_APP_KEY=""
   BKASH_APP_SECRET=""
   BKASH_USERNAME=""
   BKASH_PASSWORD=""
   BKASH_CALLBACK_URL="http://localhost:5000/api/v1/payments/bkash/callback"

   # SMTP Email (Gmail App Password or local mock)
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=""
   SMTP_PASSWORD=""
   EMAIL_FROM="Assessment Forces <no-reply@assessmentforces.local>"

   # Database Seeding
   SEED_ADMIN_EMAIL="admin@assessmentforces.local"
   SEED_ADMIN_PASSWORD="AdminSecurePassword123!"
   SEED_DEMO_DATA=false
   ```

3. **Run database migrations and seed default records:**
   ```bash
   npx prisma generate
   npm run db:deploy
   npm run db:seed
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

5. **Access the application:**
   - Swagger Documentation: [http://localhost:5000/api-docs](http://localhost:5000/api-docs)
   - Health check: [http://localhost:5000/health](http://localhost:5000/health)

---

## Available NPM Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts server with file watcher (`tsx watch src/server.ts`) |
| `npm run build` | Compiles production bundle with `tsup` |
| `npm start` | Boots compiled bundle (`node dist/server.js`) |
| `npm run typecheck` | Runs TypeScript compiler check (`tsc --noEmit`) |
| `npm run lint` | Checks code formatting and lints with Biome |
| `npm run lint:fix` | Automatically fixes code and formatting issues |
| `npm test` | Runs all Vitest test suites |
| `npm run test:unit` | Runs unit tests |
| `npm run test:http` | Runs HTTP and system integration tests |
| `npm run test:coverage`| Generates code coverage report via Vitest V8 |
| `npm run prisma:generate` | Generates Prisma client types |
| `npm run db:migrate` | Runs database migrations in development |
| `npm run db:deploy` | Applies pending migrations in production |
| `npm run db:seed` | Seeds database with seed admin and catalog items |
| `npm run db:studio` | Launches Prisma Studio GUI |

---

## Security & Reliability Design

- **Input Validation**: 100% of request bodies, route parameters, and query parameters are validated with **Zod** before hitting controllers.
- **Data Protection**: Sensitive custom attributes, candidate notes, and verification keys are encrypted using AES-256-GCM via `SENSITIVE_DATA_ENCRYPTION_KEY`.
- **Protection Headers**: Configured with **Helmet** (disabling `x-powered-by`, setting restrictive Referrer and Permissions policies).
- **Rate Limiting**: Multi-tiered rate limiting with Redis store:
  - Global rate limiter (100 req / 15 min default)
  - Dedicated authentication limiter (10 attempts / window)
  - Payment initiation limiter (10 attempts / window)
- **Token Security**: Refresh tokens are stored hashed in PostgreSQL with single-use rotation, family invalidation upon reuse, and stored in `httpOnly`, `sameSite=lax`, `secure` cookies.
- **Anti-Cheat Monitoring**: Timed attempt auto-completion on window/tab loss signals (`POST /api/v1/attempts/:id/tab-change`).
# DevGauge API

DevGauge is a backend API for running structured developer assessments. Recruiters create paid assessments, invite candidates, collect timed answers, and review scored reports. It is designed as a backend-focused assignment using Node.js, TypeScript, Express, PostgreSQL, and Prisma.

## Problem and solution

Recruiting teams need a reliable way to assess developer skills without managing spreadsheets, manually tracking candidate links, or trusting browser-side timers. DevGauge provides a controlled assessment lifecycle:

```text
Recruiter creates assessment → purchases invitation credits → invites candidate
→ candidate starts timed attempt → submits answers → system evaluates
→ recruiter receives a report
```

## Primary roles

The platform has exactly three primary roles.

| Role | Main capabilities |
| --- | --- |
| Candidate | Maintain profile, view invitations, start one valid attempt, save answers, submit, and view own result. |
| Recruiter | Maintain company profile, manage problems and assessments, purchase credits, invite candidates, and view reports. |
| Admin | Manage users and companies, moderate problems, view audit logs, and access platform statistics. |

All protected endpoints require a Bearer token. Role-based middleware checks ownership as well as role; for example, a recruiter may only change assessments belonging to their company.

## Architecture

The project uses a **modular monolith**. It is deliberately one deployable API and one PostgreSQL database, while feature boundaries keep it ready for future separation.

```mermaid
flowchart LR
  Client[Postman / API client] --> API[Express API: /api/v1]
  API --> Auth[Authentication and RBAC]
  API --> Modules[Feature modules]
  Modules --> Users[Users and Companies]
  Modules --> Assessments[Problems and Assessments]
  Modules --> Attempts[Invitations, Attempts and Submissions]
  Modules --> Payments[Payments and Credits]
  Modules --> Reports[Reports and Analytics]
  Modules --> Audit[Audit Logs]
  Modules --> DB[(PostgreSQL via Prisma)]
  Modules --> Cache[(Redis: cache and rate limits)]
  Payments --> Gateway[Stripe / SSLCommerz / bKash]
```

### Suggested source layout

```text
src/
  app.ts
  server.ts
  config/
  middleware/
    authenticate.ts
    authorize.ts
    validate.ts
    error-handler.ts
    rate-limit.ts
  modules/
    auth/
    users/
    companies/
    problems/
    assessments/
    invitations/
    attempts/
    submissions/
    payments/
    reports/
    admin/
    audit-logs/
  shared/
    prisma.ts
    redis.ts
    response.ts
    pagination.ts
prisma/
  schema.prisma
  seed.ts
```

## Assessment lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PUBLISHED: Recruiter publishes
  PUBLISHED --> INVITED: Credit is deducted and invitation is created
  INVITED --> IN_PROGRESS: Candidate starts before invitation expiry
  INVITED --> EXPIRED: Invitation expires
  IN_PROGRESS --> SUBMITTED: Candidate submits
  IN_PROGRESS --> AUTO_SUBMITTED: Server timer expires
  SUBMITTED --> EVALUATING
  AUTO_SUBMITTED --> EVALUATING
  EVALUATING --> SCORED
  SCORED --> REPORTED
```

### Core business rules

- Only a published assessment can be used for invitations.
- A recruiter needs one paid credit for every invitation sent.
- Credit deduction and invitation creation run inside one database transaction.
- The server controls time: `startedAt` and `expiresAt` are stored for every attempt. Client-side timers are only display helpers.
- A candidate can start only their own valid invitation, and only once.
- Submit is idempotent: repeated requests return the existing result instead of creating duplicate submissions.
- A published assessment with attempts is immutable. Recruiters create a new draft version for changes.
- Critical events are stored as audit logs.
- Deletable business records use `deletedAt` soft deletes.

## Data model

```mermaid
erDiagram
  USER ||--o| CANDIDATE_PROFILE : has
  USER ||--o| RECRUITER_PROFILE : has
  COMPANY ||--o{ RECRUITER_PROFILE : employs
  COMPANY ||--o{ ASSESSMENT : owns
  ASSESSMENT ||--o{ ASSESSMENT_PROBLEM : contains
  PROBLEM ||--o{ ASSESSMENT_PROBLEM : included_in
  ASSESSMENT ||--o{ INVITATION : sends
  CANDIDATE_PROFILE ||--o{ INVITATION : receives
  INVITATION ||--o| ATTEMPT : opens
  ATTEMPT ||--o{ SUBMISSION : contains
  COMPANY ||--o{ CREDIT_LEDGER : owns
  PAYMENT ||--o{ CREDIT_LEDGER : creates
  USER ||--o{ AUDIT_LOG : performs
```

| Entity | Important fields |
| --- | --- |
| `users` | id, email, passwordHash, role, status, deletedAt |
| `companies` | id, name, owner/recruiter relationship, deletedAt |
| `problems` | id, creatorId, type, title, content, difficulty, answer configuration |
| `assessments` | id, companyId, title, durationMinutes, status, pricePerInvite |
| `assessment_problems` | assessmentId, problemId, points, order |
| `invitations` | assessmentId, candidateId, token, status, expiresAt |
| `attempts` | invitationId, startedAt, expiresAt, submittedAt, status, score |
| `submissions` | attemptId, problemId, answer, score, feedback |
| `payments` | provider, providerTransactionId, amount, status, metadata |
| `credit_ledger` | companyId, creditsAdded, creditsUsed, source |
| `audit_logs` | actorId, action, entityType, entityId, before, after |

Recommended indexes: `users.email` (unique), `assessments(companyId, status)`, `invitations(candidateId, status)`, `attempts(invitationId)`, `submissions(attemptId)`, and `payments.providerTransactionId` (unique).

## Payment and credit flow

Recruiters purchase invitation credits. This makes payment part of the actual business workflow rather than a separate demo feature.

```mermaid
sequenceDiagram
  participant R as Recruiter
  participant API as DevGauge API
  participant P as Payment Gateway
  participant DB as PostgreSQL
  R->>API: Create payment session
  API->>P: Create checkout / payment request
  P-->>R: Hosted payment page
  P->>API: Signed webhook / verified callback
  API->>DB: Mark payment PAID and add credit ledger entry
  R->>API: Send candidate invitation
  API->>DB: Transaction: check and deduct credit, create invitation
```

Payment success is determined only after signature/callback or provider-verification checks. Never add credits from an unverified redirect URL.

## API overview

Every response follows a consistent shape:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

| Area | Method | Endpoint | Access |
| --- | --- | --- | --- |
| Auth | POST | `/api/v1/auth/register` | Public |
| Auth | POST | `/api/v1/auth/login` | Public |
| Auth | POST | `/api/v1/auth/refresh-token` | Authenticated |
| Auth | POST | `/api/v1/auth/logout` | Authenticated |
| Profile | GET/PATCH | `/api/v1/users/me` | Authenticated |
| Company | POST | `/api/v1/companies` | Recruiter |
| Company | GET/PATCH | `/api/v1/companies/me` | Recruiter |
| Problems | POST/GET | `/api/v1/problems` | Recruiter/Admin |
| Problems | GET/PATCH/DELETE | `/api/v1/problems/:id` | Owner/Admin |
| Assessments | POST/GET | `/api/v1/assessments` | Recruiter |
| Assessments | GET/PATCH/DELETE | `/api/v1/assessments/:id` | Owner/Admin |
| Assessments | POST | `/api/v1/assessments/:id/problems` | Owner |
| Assessments | POST | `/api/v1/assessments/:id/publish` | Owner |
| Invitations | POST | `/api/v1/assessments/:id/invitations` | Owner |
| Invitations | GET | `/api/v1/invitations/my` | Candidate |
| Attempts | POST | `/api/v1/invitations/:id/start` | Invited candidate |
| Submissions | POST | `/api/v1/attempts/:id/submissions` | Attempt owner |
| Attempts | POST | `/api/v1/attempts/:id/submit` | Attempt owner |
| Results | GET | `/api/v1/attempts/:id/result` | Attempt owner/assessment owner |
| Payments | POST | `/api/v1/payments/initiate` | Recruiter |
| Payments | POST | `/api/v1/payments/webhook` | Payment gateway |
| Payments | GET | `/api/v1/payments/:id` | Payment owner/Admin |
| Reports | GET | `/api/v1/reports/assessments/:id` | Assessment owner |
| Admin | GET | `/api/v1/admin/dashboard` | Admin |
| Admin | GET | `/api/v1/admin/audit-logs` | Admin |

List endpoints support pagination, filtering, sorting, and search where relevant. For example:

```text
GET /api/v1/problems?page=1&limit=10&type=MCQ&difficulty=MEDIUM&search=react&sortBy=createdAt&sortOrder=desc
```

## Security and reliability

- Passwords are hashed with bcrypt or Argon2; password hashes and tokens never appear in API responses.
- JWT access and refresh tokens protect authenticated routes.
- Zod validates every create and update payload.
- Helmet, restrictive CORS, and `express-rate-limit` protect the API.
- Redis supports rate-limit storage and caches published assessment details with a short TTL.
- Prisma transactions protect credit deduction, invitation creation, attempt creation, and payment finalization.
- Webhook events are idempotent using a unique payment transaction/event identifier.
- Use Prisma `select` to avoid returning sensitive or unnecessary database fields.
- Record audit logs for publishing, invitations, attempts, submission, payment confirmation, role changes, and moderation.

## Local setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis (optional locally, required for full cache/rate-limit behavior)
- A Stripe, SSLCommerz, or bKash sandbox account

### Installation

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npx prisma db seed
npm run dev
```

### Environment variables

```env
PORT=5000
NODE_ENV=development
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/devgauge"
REDIS_URL="redis://localhost:6379"
JWT_ACCESS_SECRET="replace-with-a-long-random-secret"
JWT_REFRESH_SECRET="replace-with-a-different-long-random-secret"
PAYMENT_PROVIDER="stripe"
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
```

## Testing and documentation

- Keep a Postman collection with variables for `baseUrl`, candidate token, recruiter token, admin token, and payment webhook secret.
- Test all three roles, unauthorized access, invalid input, duplicate submissions, expired invitations, insufficient credits, and duplicate webhooks.
- Include API examples, ERD, setup steps, and deployed URL in the final submission.

## Future scale-out path

The API can later be split into Identity, Assessment, Submission, Billing, and Reporting services. If real code execution is added, it must run in isolated workers/containers with strict CPU, memory, execution-time, and network limits—not in the Express API process.
#   A s s e s s m e n t F o r c e s  
 
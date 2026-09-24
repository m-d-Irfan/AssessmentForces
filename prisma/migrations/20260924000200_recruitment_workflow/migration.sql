CREATE TYPE "RecruitmentProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');
CREATE TYPE "ProgramMemberRole" AS ENUM ('LEAD_RECRUITER', 'TECHNICAL_RECRUITER', 'HR');
CREATE TYPE "ProgramInvitationType" AS ENUM ('CANDIDATE', 'MEMBER');
CREATE TYPE "ProgramInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "RecruitmentStageType" AS ENUM ('CODING_ASSESSMENT', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW', 'FINAL_DECISION');
CREATE TYPE "CandidateApplicationStatus" AS ENUM ('INVITED', 'ACTIVE', 'REJECTED', 'HIRED', 'WITHDRAWN', 'COMPLETED');
CREATE TYPE "CandidateStageStatus" AS ENUM ('LOCKED', 'AVAILABLE', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'PASSED', 'FAILED', 'SKIPPED');
CREATE TYPE "StageDecision" AS ENUM ('PASS', 'FAIL');

ALTER TABLE "invitations" ADD COLUMN "candidateStageProgressId" TEXT;
DROP INDEX "invitations_assessmentId_candidateId_key";
CREATE UNIQUE INDEX "invitations_candidateStageProgressId_key" ON "invitations"("candidateStageProgressId");

CREATE TABLE "recruitment_programs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "position" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "status" "RecruitmentProgramStatus" NOT NULL DEFAULT 'DRAFT',
  "creditCost" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recruitment_programs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recruitment_programs_companyId_title_key" ON "recruitment_programs"("companyId", "title");
CREATE INDEX "recruitment_programs_companyId_status_deletedAt_idx" ON "recruitment_programs"("companyId", "status", "deletedAt");

CREATE TABLE "program_members" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ProgramMemberRole" NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "program_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "program_members_programId_userId_key" ON "program_members"("programId", "userId");
CREATE INDEX "program_members_userId_role_idx" ON "program_members"("userId", "role");

CREATE TABLE "program_invitations" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "invitedById" TEXT NOT NULL,
  "acceptedById" TEXT,
  "email" VARCHAR(320) NOT NULL,
  "type" "ProgramInvitationType" NOT NULL,
  "memberRole" "ProgramMemberRole",
  "tokenHash" VARCHAR(128) NOT NULL,
  "status" "ProgramInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "program_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "program_invitations_tokenHash_key" ON "program_invitations"("tokenHash");
CREATE UNIQUE INDEX "program_invitations_programId_email_type_key" ON "program_invitations"("programId", "email", "type");
CREATE INDEX "program_invitations_email_status_expiresAt_idx" ON "program_invitations"("email", "status", "expiresAt");

CREATE TABLE "recruitment_stages" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "assessmentId" TEXT,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "type" "RecruitmentStageType" NOT NULL,
  "order" INTEGER NOT NULL,
  "minimumScore" DECIMAL(5,2),
  "requiresLeadDecision" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recruitment_stages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recruitment_stages_programId_order_key" ON "recruitment_stages"("programId", "order");
CREATE INDEX "recruitment_stages_programId_type_idx" ON "recruitment_stages"("programId", "type");
CREATE INDEX "recruitment_stages_assessmentId_idx" ON "recruitment_stages"("assessmentId");

CREATE TABLE "stage_assignees" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stage_assignees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stage_assignees_stageId_userId_key" ON "stage_assignees"("stageId", "userId");
CREATE INDEX "stage_assignees_userId_idx" ON "stage_assignees"("userId");

CREATE TABLE "candidate_applications" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "status" "CandidateApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentStageId" TEXT,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "hiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "candidate_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "candidate_applications_programId_candidateId_key" ON "candidate_applications"("programId", "candidateId");
CREATE INDEX "candidate_applications_programId_status_idx" ON "candidate_applications"("programId", "status");
CREATE INDEX "candidate_applications_candidateId_status_idx" ON "candidate_applications"("candidateId", "status");
CREATE INDEX "candidate_applications_currentStageId_idx" ON "candidate_applications"("currentStageId");

CREATE TABLE "candidate_stage_progress" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "status" "CandidateStageStatus" NOT NULL DEFAULT 'LOCKED',
  "aggregateScore" DECIMAL(7,2),
  "finalDecision" "StageDecision",
  "finalizedById" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "candidate_stage_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "candidate_stage_progress_applicationId_stageId_key" ON "candidate_stage_progress"("applicationId", "stageId");
CREATE INDEX "candidate_stage_progress_stageId_status_idx" ON "candidate_stage_progress"("stageId", "status");
CREATE INDEX "candidate_stage_progress_applicationId_status_idx" ON "candidate_stage_progress"("applicationId", "status");

CREATE TABLE "stage_reviews" (
  "id" TEXT NOT NULL,
  "stageProgressId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "score" DECIMAL(7,2) NOT NULL,
  "decision" "StageDecision" NOT NULL,
  "candidateFeedback" TEXT,
  "encryptedPrivateNotes" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stage_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stage_reviews_stageProgressId_reviewerId_key" ON "stage_reviews"("stageProgressId", "reviewerId");
CREATE INDEX "stage_reviews_reviewerId_submittedAt_idx" ON "stage_reviews"("reviewerId", "submittedAt");

CREATE TABLE "interview_schedules" (
  "id" TEXT NOT NULL,
  "stageProgressId" TEXT NOT NULL,
  "scheduledById" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" VARCHAR(80) NOT NULL,
  "meetingUrl" TEXT,
  "location" VARCHAR(300),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "interview_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "interview_schedules_stageProgressId_startsAt_idx" ON "interview_schedules"("stageProgressId", "startsAt");
CREATE INDEX "interview_schedules_startsAt_cancelledAt_idx" ON "interview_schedules"("startsAt", "cancelledAt");

ALTER TABLE "recruitment_programs" ADD CONSTRAINT "recruitment_programs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruitment_programs" ADD CONSTRAINT "recruitment_programs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_programId_fkey" FOREIGN KEY ("programId") REFERENCES "recruitment_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_invitations" ADD CONSTRAINT "program_invitations_programId_fkey" FOREIGN KEY ("programId") REFERENCES "recruitment_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_invitations" ADD CONSTRAINT "program_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_invitations" ADD CONSTRAINT "program_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recruitment_stages" ADD CONSTRAINT "recruitment_stages_programId_fkey" FOREIGN KEY ("programId") REFERENCES "recruitment_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recruitment_stages" ADD CONSTRAINT "recruitment_stages_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_assignees" ADD CONSTRAINT "stage_assignees_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "recruitment_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stage_assignees" ADD CONSTRAINT "stage_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_programId_fkey" FOREIGN KEY ("programId") REFERENCES "recruitment_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_stage_progress" ADD CONSTRAINT "candidate_stage_progress_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "candidate_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_stage_progress" ADD CONSTRAINT "candidate_stage_progress_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "recruitment_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_stage_progress" ADD CONSTRAINT "candidate_stage_progress_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_stageProgressId_fkey" FOREIGN KEY ("stageProgressId") REFERENCES "candidate_stage_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_schedules" ADD CONSTRAINT "interview_schedules_stageProgressId_fkey" FOREIGN KEY ("stageProgressId") REFERENCES "candidate_stage_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_schedules" ADD CONSTRAINT "interview_schedules_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_candidateStageProgressId_fkey" FOREIGN KEY ("candidateStageProgressId") REFERENCES "candidate_stage_progress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

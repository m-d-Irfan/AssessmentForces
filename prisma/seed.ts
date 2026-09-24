import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import {
  AssessmentStatus,
  AuthProvider,
  CompanyMemberRole,
  Difficulty,
  MembershipStatus,
  PrismaClient,
  ProblemStatus,
  ProblemType,
  UserRole,
  UserStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

const DEFAULT_ADMIN_EMAIL = "admin@devassess.local";
const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

async function seedAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === "production" && password === DEFAULT_ADMIN_PASSWORD) {
    throw new Error("SEED_ADMIN_PASSWORD must be changed before seeding production");
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      displayName: "Platform Administrator",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    create: {
      email,
      passwordHash,
      displayName: "Platform Administrator",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: AuthProvider.LOCAL,
        providerAccountId: email,
      },
    },
    update: { providerEmail: email },
    create: {
      userId: admin.id,
      provider: AuthProvider.LOCAL,
      providerAccountId: email,
      providerEmail: email,
    },
  });
}

async function seedCreditPackages(): Promise<void> {
  const packages = [
    { name: "Starter", description: "10 candidate invitation credits", credits: 10, price: 500 },
    { name: "Growth", description: "50 candidate invitation credits", credits: 50, price: 2_000 },
    { name: "Scale", description: "100 candidate invitation credits", credits: 100, price: 3_500 },
  ];

  for (const creditPackage of packages) {
    await prisma.creditPackage.upsert({
      where: { name: creditPackage.name },
      update: { ...creditPackage, currency: "BDT", isActive: true, deletedAt: null },
      create: { ...creditPackage, currency: "BDT" },
    });
  }
}

async function seedDemoData(): Promise<void> {
  if (process.env.SEED_DEMO_DATA !== "true") return;

  const demoPassword = await hashPassword("DemoUser123!");
  const recruiter = await prisma.user.upsert({
    where: { email: "recruiter@devassess.local" },
    update: { role: UserRole.RECRUITER, status: UserStatus.ACTIVE },
    create: {
      id: "seed_recruiter",
      email: "recruiter@devassess.local",
      passwordHash: demoPassword,
      displayName: "Demo Recruiter",
      role: UserRole.RECRUITER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  const candidate = await prisma.user.upsert({
    where: { email: "candidate@devassess.local" },
    update: { role: UserRole.CANDIDATE, status: UserStatus.ACTIVE },
    create: {
      id: "seed_candidate",
      email: "candidate@devassess.local",
      passwordHash: demoPassword,
      displayName: "Demo Candidate",
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.candidateProfile.upsert({
    where: { userId: candidate.id },
    update: {},
    create: {
      userId: candidate.id,
      headline: "Backend developer candidate",
      yearsExperience: 2,
      skills: ["TypeScript", "Node.js", "PostgreSQL"],
    },
  });

  const company = await prisma.company.upsert({
    where: { slug: "demo-technologies" },
    update: { name: "Demo Technologies", createdById: recruiter.id },
    create: {
      id: "seed_company",
      slug: "demo-technologies",
      name: "Demo Technologies",
      description: "Seed company for local API demonstrations",
      createdById: recruiter.id,
      verifiedAt: new Date(),
    },
  });

  await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: recruiter.id } },
    update: { role: CompanyMemberRole.OWNER, status: MembershipStatus.ACTIVE },
    create: {
      companyId: company.id,
      userId: recruiter.id,
      role: CompanyMemberRole.OWNER,
      status: MembershipStatus.ACTIVE,
    },
  });

  await prisma.companyCreditBalance.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id, availableCredits: 0 },
  });

  const problem = await prisma.problem.upsert({
    where: { id: "seed_problem_typescript" },
    update: {},
    create: {
      id: "seed_problem_typescript",
      companyId: company.id,
      creatorId: recruiter.id,
      title: "TypeScript type safety",
      type: ProblemType.SINGLE_CHOICE,
      difficulty: Difficulty.EASY,
      status: ProblemStatus.PUBLISHED,
    },
  });

  const problemVersion = await prisma.problemVersion.upsert({
    where: { problemId_version: { problemId: problem.id, version: 1 } },
    update: {},
    create: {
      id: "seed_problem_typescript_v1",
      problemId: problem.id,
      version: 1,
      prompt: "Which TypeScript feature checks the shape of values during development?",
      explanation: "Static types allow TypeScript to detect incompatible values before runtime.",
    },
  });

  const options = [
    { label: "A", content: "Static type checking", isCorrect: true, order: 1 },
    { label: "B", content: "Runtime garbage collection", isCorrect: false, order: 2 },
    { label: "C", content: "HTTP caching", isCorrect: false, order: 3 },
    { label: "D", content: "Database indexing", isCorrect: false, order: 4 },
  ];

  for (const option of options) {
    await prisma.problemOption.upsert({
      where: {
        problemVersionId_order: {
          problemVersionId: problemVersion.id,
          order: option.order,
        },
      },
      update: option,
      create: { problemVersionId: problemVersion.id, ...option },
    });
  }

  const assessment = await prisma.assessment.upsert({
    where: { id: "seed_assessment_backend" },
    update: {},
    create: {
      id: "seed_assessment_backend",
      companyId: company.id,
      createdById: recruiter.id,
      title: "Backend Developer Fundamentals",
      description: "Seed assessment for local development",
      durationMinutes: 30,
      passPercentage: 60,
      totalPoints: 10,
      status: AssessmentStatus.DRAFT,
    },
  });

  await prisma.assessmentItem.upsert({
    where: { assessmentId_order: { assessmentId: assessment.id, order: 1 } },
    update: { problemVersionId: problemVersion.id, points: 10 },
    create: {
      id: "seed_assessment_item_typescript",
      assessmentId: assessment.id,
      problemVersionId: problemVersion.id,
      points: 10,
      order: 1,
    },
  });
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedCreditPackages();
  await seedDemoData();
  console.info("Database seed completed");
}

main()
  .catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

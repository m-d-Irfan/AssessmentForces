import {
  ProgramInvitationType,
  ProgramMemberRole,
  RecruitmentStageType,
  StageDecision,
} from "@prisma/client";
import { adjustCreditsBodySchema } from "../../src/modules/admin/admin.validation.js";
import { saveAnswerBodySchema } from "../../src/modules/attempts/attempt.validation.js";
import {
  createProgramBodySchema,
  inviteToProgramBodySchema,
  reorderStagesBodySchema,
  scheduleInterviewBodySchema,
  submitReviewBodySchema,
} from "../../src/modules/recruitment/recruitment.validation.js";

describe("workflow validation", () => {
  it("normalizes a valid recruitment program", () => {
    const result = createProgramBodySchema.parse({
      companyId: "company-1",
      title: " Backend Hiring ",
      position: " Backend Engineer ",
    });
    expect(result).toMatchObject({
      title: "Backend Hiring",
      position: "Backend Engineer",
      creditCost: 1,
    });
  });

  it("requires member roles only for team invitations", () => {
    expect(
      inviteToProgramBodySchema.safeParse({
        email: "HR@Example.com",
        type: ProgramInvitationType.MEMBER,
      }).success,
    ).toBe(false);
    const member = inviteToProgramBodySchema.parse({
      email: "HR@Example.com",
      type: ProgramInvitationType.MEMBER,
      memberRole: ProgramMemberRole.HR,
    });
    expect(member.email).toBe("hr@example.com");
    expect(
      inviteToProgramBodySchema.safeParse({
        email: "candidate@example.com",
        type: ProgramInvitationType.CANDIDATE,
        memberRole: ProgramMemberRole.HR,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate or empty stage order submissions", () => {
    expect(reorderStagesBodySchema.safeParse({ stageIds: [] }).success).toBe(false);
    expect(reorderStagesBodySchema.safeParse({ stageIds: ["a", "a"] }).success).toBe(false);
    expect(reorderStagesBodySchema.parse({ stageIds: ["a", "b"] }).stageIds).toEqual(["a", "b"]);
  });

  it("requires interview end time after start time", () => {
    expect(
      scheduleInterviewBodySchema.safeParse({
        startsAt: "2027-01-01T12:00:00Z",
        endsAt: "2027-01-01T11:00:00Z",
        timezone: "Asia/Dhaka",
      }).success,
    ).toBe(false);
    expect(
      scheduleInterviewBodySchema.safeParse({
        startsAt: "2027-01-01T12:00:00Z",
        endsAt: "2027-01-01T13:00:00Z",
        timezone: "Asia/Dhaka",
      }).success,
    ).toBe(true);
  });

  it("limits review scores and accepts an explicit decision", () => {
    expect(
      submitReviewBodySchema.safeParse({ score: 101, decision: StageDecision.PASS }).success,
    ).toBe(false);
    expect(
      submitReviewBodySchema.safeParse({ score: 80, decision: StageDecision.PASS }).success,
    ).toBe(true);
  });

  it("requires at least one answer field", () => {
    expect(saveAnswerBodySchema.safeParse({}).success).toBe(false);
    expect(
      saveAnswerBodySchema.safeParse({ sourceCode: "return true;", language: "typescript" })
        .success,
    ).toBe(true);
  });

  it("rejects zero-value administrative credit adjustments", () => {
    expect(
      adjustCreditsBodySchema.safeParse({ amount: 0, reason: "No change needed" }).success,
    ).toBe(false);
    expect(
      adjustCreditsBodySchema.safeParse({ amount: -5, reason: "Correct duplicate credit entry" })
        .success,
    ).toBe(true);
  });

  it("retains supported stage type values", () => {
    expect(RecruitmentStageType.HR_INTERVIEW).toBe("HR_INTERVIEW");
  });
});

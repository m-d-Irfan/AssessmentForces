import { ProgramMemberRole, UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../errors/app-error.js";

export async function requireProgramMember(
  userId: string,
  userRole: UserRole,
  programId: string,
  allowedRoles?: ProgramMemberRole[],
) {
  if (userRole === UserRole.ADMIN) return null;
  const member = await prisma.programMember.findUnique({
    where: { programId_userId: { programId, userId } },
  });
  if (!member || (allowedRoles && !allowedRoles.includes(member.role))) {
    throw new AppError(
      403,
      "PROGRAM_ACCESS_DENIED",
      "You do not have access to this recruitment program",
    );
  }
  return member;
}

export function requireLeadRole(userId: string, userRole: UserRole, programId: string) {
  return requireProgramMember(userId, userRole, programId, [ProgramMemberRole.LEAD_RECRUITER]);
}

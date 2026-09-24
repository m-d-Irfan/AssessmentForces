import { MembershipStatus, UserRole } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../errors/app-error.js";

export async function requireCompanyAccess(
  userId: string,
  role: UserRole,
  companyId: string,
): Promise<void> {
  if (role === UserRole.ADMIN) return;
  const membership = await prisma.companyMembership.findFirst({
    where: { userId, companyId, status: MembershipStatus.ACTIVE, company: { deletedAt: null } },
    select: { id: true },
  });
  if (!membership) {
    throw new AppError(
      403,
      "COMPANY_ACCESS_DENIED",
      "You cannot manage resources for this company",
    );
  }
}

export async function accessibleCompanyIds(
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  if (role === UserRole.ADMIN) return null;
  const memberships = await prisma.companyMembership.findMany({
    where: { userId, status: MembershipStatus.ACTIVE, company: { deletedAt: null } },
    select: { companyId: true },
  });
  return memberships.map((membership) => membership.companyId);
}

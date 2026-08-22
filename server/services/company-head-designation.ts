import { db } from "../db/client.js";
import { recordSecurityEvent } from "./security-events.js";

export interface CompanyHeadDesignationPlan {
  email: string;
  userId: string;
  identityRealm: "corporate_support";
  accountVerified: true;
  supportRole: "director" | "agent" | null;
  supportStatus: "active" | "revoked" | null;
  companyPosition: string | null;
  companyPositionStatus: "active" | "vacant" | "revoked" | null;
  wouldChange: boolean;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("A valid corporate email is required");
  }
  return normalized;
}

async function resolveDesignation(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await db
    .selectFrom("users")
    .select(["id", "identityRealm", "accountStatus", "emailVerifiedAt"])
    .where("email", "=", email)
    .where("identityRealm", "=", "corporate_support")
    .executeTakeFirst();
  if (
    !user ||
    user.identityRealm !== "corporate_support" ||
    user.accountStatus !== "active" ||
    user.emailVerifiedAt === null
  ) {
    throw new Error(
      "The corporate support account must exist and have a verified email",
    );
  }
  const [supportStaff, companyProfile, activeHead, designationState] =
    await Promise.all([
      db
        .selectFrom("umfSupportStaff")
        .select(["role", "status"])
        .where("userId", "=", user.id)
        .executeTakeFirst(),
      db
        .selectFrom("companyStaffProfiles")
        .select(["position", "status"])
        .where("userId", "=", user.id)
        .executeTakeFirst(),
      db
        .selectFrom("companyStaffProfiles")
        .select("userId")
        .where("position", "=", "platform_head")
        .where("status", "=", "active")
        .where("userId", "!=", user.id)
        .executeTakeFirst(),
      db
        .selectFrom("corporateBootstrapState")
        .select("claimedByUserId")
        .where("id", "=", "company_head")
        .executeTakeFirst(),
    ]);
  if (activeHead) {
    throw new Error("Another active platform head is already designated");
  }
  if (
    designationState?.claimedByUserId &&
    designationState.claimedByUserId !== user.id
  ) {
    throw new Error("The recorded platform head belongs to another account");
  }
  return { email, user, supportStaff, companyProfile, designationState };
}

export async function planCompanyHeadDesignation(
  email: string,
): Promise<CompanyHeadDesignationPlan> {
  const context = await resolveDesignation(email);
  return {
    email: context.email,
    userId: context.user.id,
    identityRealm: "corporate_support",
    accountVerified: true,
    supportRole: context.supportStaff?.role ?? null,
    supportStatus: context.supportStaff?.status ?? null,
    companyPosition: context.companyProfile?.position ?? null,
    companyPositionStatus: context.companyProfile?.status ?? null,
    wouldChange:
      context.supportStaff?.role !== "director" ||
      context.supportStaff?.status !== "active" ||
      context.companyProfile?.position !== "platform_head" ||
      context.companyProfile?.status !== "active" ||
      context.designationState?.claimedByUserId !== context.user.id,
  };
}

export async function applyCompanyHeadDesignation(
  email: string,
): Promise<CompanyHeadDesignationPlan> {
  const context = await resolveDesignation(email);
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    if (context.supportStaff) {
      await transaction
        .updateTable("umfSupportStaff")
        .set({
          role: "director",
          status: "active",
          approvedByUserId: context.user.id,
          updatedAt: now,
          revokedAt: null,
        })
        .where("userId", "=", context.user.id)
        .execute();
    } else {
      await transaction
        .insertInto("umfSupportStaff")
        .values({
          userId: context.user.id,
          role: "director",
          status: "active",
          approvedByUserId: context.user.id,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .execute();
    }
    if (context.companyProfile) {
      await transaction
        .updateTable("companyStaffProfiles")
        .set({
          position: "platform_head",
          reportsToUserId: null,
          status: "active",
          appointedByUserId: context.user.id,
          updatedAt: now,
          revokedAt: null,
        })
        .where("userId", "=", context.user.id)
        .execute();
    } else {
      await transaction
        .insertInto("companyStaffProfiles")
        .values({
          userId: context.user.id,
          position: "platform_head",
          reportsToUserId: null,
          status: "active",
          appointedByUserId: context.user.id,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .execute();
    }
    if (context.designationState) {
      await transaction
        .updateTable("corporateBootstrapState")
        .set({ claimedByUserId: context.user.id, claimedAt: now })
        .where("id", "=", "company_head")
        .execute();
    } else {
      await transaction
        .insertInto("corporateBootstrapState")
        .values({
          id: "company_head",
          claimedByUserId: context.user.id,
          claimedAt: now,
        })
        .execute();
    }
  });
  await recordSecurityEvent("company_head_bootstrapped", context.user.id, {
    mode: "manual_local_designation",
  });
  return planCompanyHeadDesignation(context.email);
}

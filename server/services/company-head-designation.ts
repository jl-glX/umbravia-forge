import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "../db/client.js";
import { recordSecurityEvent } from "./security-events.js";

const CONFIGURED_HEAD_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface ConfiguredCompanyHeadBootstrapResult {
  isCompanyHead: boolean;
  changed: boolean;
  reason:
    | "designated"
    | "already_designated"
    | "bootstrap_not_configured"
    | "account_not_eligible"
    | "email_not_designated"
    | "head_already_claimed";
}

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
  mode:
    | "manual_local_designation"
    | "configured_email_bootstrap" = "manual_local_designation",
): Promise<CompanyHeadDesignationPlan> {
  const context = await resolveDesignation(email);
  const wouldChange =
    context.supportStaff?.role !== "director" ||
    context.supportStaff?.status !== "active" ||
    context.companyProfile?.position !== "platform_head" ||
    context.companyProfile?.status !== "active" ||
    context.designationState?.claimedByUserId !== context.user.id;
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    const [activeHead, designationState] = await Promise.all([
      transaction
        .selectFrom("companyStaffProfiles")
        .select("userId")
        .where("position", "=", "platform_head")
        .where("status", "=", "active")
        .where("userId", "!=", context.user.id)
        .executeTakeFirst(),
      transaction
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
      designationState.claimedByUserId !== context.user.id
    ) {
      throw new Error("The recorded platform head belongs to another account");
    }
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
    if (designationState) {
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
  if (wouldChange) {
    await recordSecurityEvent("company_head_bootstrapped", context.user.id, {
      mode,
    });
  }
  return planCompanyHeadDesignation(context.email);
}

function configuredCompanyHeadHash(): Buffer | null {
  const configured =
    process.env.UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256?.trim().toLowerCase();
  if (!configured || !CONFIGURED_HEAD_HASH_PATTERN.test(configured)) {
    return null;
  }
  return Buffer.from(configured, "hex");
}

function emailMatchesConfiguredHead(
  email: string,
  configured: Buffer,
): boolean {
  const actual = createHash("sha256").update(normalizeEmail(email)).digest();
  return timingSafeEqual(actual, configured);
}

async function hasCompanyHeadAuthority(userId: string): Promise<boolean> {
  const [supportStaff, companyProfile, designationState] = await Promise.all([
    db
      .selectFrom("umfSupportStaff")
      .select("userId")
      .where("userId", "=", userId)
      .where("role", "=", "director")
      .where("status", "=", "active")
      .executeTakeFirst(),
    db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("userId", "=", userId)
      .where("position", "=", "platform_head")
      .where("status", "=", "active")
      .executeTakeFirst(),
    db
      .selectFrom("corporateBootstrapState")
      .select("claimedByUserId")
      .where("id", "=", "company_head")
      .executeTakeFirst(),
  ]);
  return Boolean(
    supportStaff &&
    companyProfile &&
    designationState?.claimedByUserId === userId,
  );
}

async function removeSameEmailCommercialHeadRelations(
  corporateUserId: string,
  email: string,
): Promise<boolean> {
  const commercialUser = await db
    .selectFrom("users")
    .select("id")
    .where("identityRealm", "=", "commercial")
    .where("email", "=", normalizeEmail(email))
    .executeTakeFirst();
  if (!commercialUser || commercialUser.id === corporateUserId) {
    return false;
  }
  const [supportStaff, companyProfile, designationState] = await Promise.all([
    db
      .selectFrom("umfSupportStaff")
      .select("userId")
      .where("userId", "=", commercialUser.id)
      .executeTakeFirst(),
    db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("userId", "=", commercialUser.id)
      .executeTakeFirst(),
    db
      .selectFrom("corporateBootstrapState")
      .select("claimedByUserId")
      .where("id", "=", "company_head")
      .where("claimedByUserId", "=", commercialUser.id)
      .executeTakeFirst(),
  ]);
  if (!supportStaff && !companyProfile && !designationState) {
    return false;
  }
  await db.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom("umfSupportStaff")
      .where("userId", "=", commercialUser.id)
      .execute();
    await transaction
      .deleteFrom("companyStaffProfiles")
      .where("userId", "=", commercialUser.id)
      .execute();
    await transaction
      .deleteFrom("corporateBootstrapState")
      .where("id", "=", "company_head")
      .where("claimedByUserId", "=", commercialUser.id)
      .execute();
  });
  return true;
}

/**
 * Completes the one-time corporate bootstrap only for the verified support
 * identity whose normalized email matches the externally configured digest.
 * It never changes the commercial account itself; it may remove only corporate
 * authority relations that historical code attached to its same-email row.
 */
export async function ensureConfiguredCompanyHead(
  userId: string,
): Promise<ConfiguredCompanyHeadBootstrapResult> {
  const configuredHash = configuredCompanyHeadHash();
  if (!configuredHash) {
    return {
      isCompanyHead: false,
      changed: false,
      reason: "bootstrap_not_configured",
    };
  }
  const user = await db
    .selectFrom("users")
    .select([
      "id",
      "email",
      "identityRealm",
      "accountStatus",
      "emailVerifiedAt",
    ])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (
    !user ||
    user.identityRealm !== "corporate_support" ||
    user.accountStatus !== "active" ||
    user.emailVerifiedAt === null
  ) {
    return {
      isCompanyHead: false,
      changed: false,
      reason: "account_not_eligible",
    };
  }
  if (!emailMatchesConfiguredHead(user.email, configuredHash)) {
    return {
      isCompanyHead: false,
      changed: false,
      reason: "email_not_designated",
    };
  }
  if (await hasCompanyHeadAuthority(user.id)) {
    return {
      isCompanyHead: true,
      changed: false,
      reason: "already_designated",
    };
  }
  await removeSameEmailCommercialHeadRelations(user.id, user.email);
  try {
    await applyCompanyHeadDesignation(user.email, "configured_email_bootstrap");
    return {
      isCompanyHead: true,
      changed: true,
      reason: "designated",
    };
  } catch (error) {
    if (await hasCompanyHeadAuthority(user.id)) {
      return {
        isCompanyHead: true,
        changed: false,
        reason: "already_designated",
      };
    }
    if (
      error instanceof Error &&
      (error.message.includes("active platform head") ||
        error.message.includes("belongs to another account"))
    ) {
      return {
        isCompanyHead: false,
        changed: false,
        reason: "head_already_claimed",
      };
    }
    throw error;
  }
}

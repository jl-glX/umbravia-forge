import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db/client.js";

export class CompanyBootstrapUnavailableError extends Error {
  readonly statusCode = 409;
  readonly code = "COMPANY_HEAD_BOOTSTRAP_UNAVAILABLE";

  constructor() {
    super("The initial company head has already been established");
  }
}

async function hasAnyCorporateInitialization(): Promise<boolean> {
  const [state, supportStaff, companyStaff] = await Promise.all([
    db
      .selectFrom("corporateBootstrapState")
      .select("id")
      .where("id", "=", "company_head")
      .executeTakeFirst(),
    db.selectFrom("umfSupportStaff").select("userId").executeTakeFirst(),
    db.selectFrom("companyStaffProfiles").select("userId").executeTakeFirst(),
  ]);
  return Boolean(state || supportStaff || companyStaff);
}

export function isDesignatedBootstrapEmail(email: string): boolean {
  const configured =
    process.env.UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256?.trim().toLowerCase();
  if (!configured || !/^[a-f0-9]{64}$/.test(configured)) return false;
  const actual = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest();
  return timingSafeEqual(actual, Buffer.from(configured, "hex"));
}

export async function canRequestCompanyHeadBootstrap(
  email: string,
): Promise<boolean> {
  if (!isDesignatedBootstrapEmail(email)) return false;
  if (!(await hasAnyCorporateInitialization())) return true;
  return Boolean(await findFusedCompanyHead(email));
}

async function findFusedCompanyHead(email: string) {
  const state = await db
    .selectFrom("corporateBootstrapState")
    .innerJoin("users", "users.id", "corporateBootstrapState.claimedByUserId")
    .select(["users.id", "users.email", "users.identityRealm"])
    .where("corporateBootstrapState.id", "=", "company_head")
    .executeTakeFirst();
  if (!state || state.identityRealm !== "commercial") {
    return null;
  }
  const corporateIdentity = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email.trim().toLowerCase())
    .where("identityRealm", "=", "corporate_support")
    .executeTakeFirst();
  return corporateIdentity ? null : state;
}

export async function canBootstrapCompanyHead(
  userId: string,
): Promise<boolean> {
  const user = await db
    .selectFrom("users")
    .select(["email", "accountStatus", "emailVerifiedAt", "identityRealm"])
    .where("id", "=", userId)
    .executeTakeFirst();
  return Boolean(
    user?.accountStatus === "active" &&
    user.emailVerifiedAt !== null &&
    user.identityRealm === "corporate_support" &&
    isDesignatedBootstrapEmail(user.email) &&
    !(await hasAnyCorporateInitialization()),
  );
}

export async function bootstrapCompanyHead(
  userId: string,
  accessRequestId?: string,
): Promise<void> {
  const now = Date.now();
  try {
    await db.transaction().execute(async (transaction) => {
      const user = await transaction
        .selectFrom("users")
        .select(["email", "accountStatus", "emailVerifiedAt", "identityRealm"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (
        !user ||
        user.accountStatus !== "active" ||
        user.emailVerifiedAt === null ||
        user.identityRealm !== "corporate_support" ||
        !isDesignatedBootstrapEmail(user.email)
      ) {
        throw new CompanyBootstrapUnavailableError();
      }

      const [state, supportStaff, companyStaff] = await Promise.all([
        transaction
          .selectFrom("corporateBootstrapState")
          .select("id")
          .executeTakeFirst(),
        transaction
          .selectFrom("umfSupportStaff")
          .select("userId")
          .executeTakeFirst(),
        transaction
          .selectFrom("companyStaffProfiles")
          .select("userId")
          .executeTakeFirst(),
      ]);
      if (state || supportStaff || companyStaff) {
        const accessRequest = accessRequestId
          ? await transaction
              .selectFrom("umfSupportAccessRequests")
              .select("id")
              .where("id", "=", accessRequestId)
              .where("email", "=", user.email)
              .where("status", "=", "approved")
              .executeTakeFirst()
          : null;
        const fusedSource = await transaction
          .selectFrom("corporateBootstrapState")
          .innerJoin(
            "users",
            "users.id",
            "corporateBootstrapState.claimedByUserId",
          )
          .select(["users.id", "users.email", "users.identityRealm"])
          .where("corporateBootstrapState.id", "=", "company_head")
          .executeTakeFirst();
        if (
          !accessRequest ||
          !fusedSource ||
          fusedSource.identityRealm !== "commercial"
        ) {
          throw new CompanyBootstrapUnavailableError();
        }
        const oldUserId = fusedSource.id;
        await transaction
          .updateTable("umfSupportStaff")
          .set({ approvedByUserId: userId })
          .where("approvedByUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("companyStaffProfiles")
          .set({ appointedByUserId: userId })
          .where("appointedByUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("companyStaffProfiles")
          .set({ reportsToUserId: userId })
          .where("reportsToUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("corporateRoleAssignments")
          .set({ assignedByUserId: userId })
          .where("assignedByUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("corporateRoleDelegations")
          .set({ delegatedByUserId: userId })
          .where("delegatedByUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("umfSupportAccessRequests")
          .set({ reviewedByUserId: userId })
          .where("reviewedByUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("umfSupportAccessRequests")
          .set({ activatedUserId: userId })
          .where("activatedUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("umfSupportTickets")
          .set({ assigneeUserId: userId })
          .where("assigneeUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("umfSupportMessages")
          .set({ authorUserId: userId })
          .where("authorUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("corporateRoleDelegations")
          .set({ recipientUserId: userId })
          .where("recipientUserId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("corporateRoleAssignments")
          .set({ userId })
          .where("userId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("companyStaffProfiles")
          .set({ userId })
          .where("userId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("umfSupportStaff")
          .set({ userId })
          .where("userId", "=", oldUserId)
          .execute();
        await transaction
          .updateTable("corporateBootstrapState")
          .set({ claimedByUserId: userId, claimedAt: now })
          .where("id", "=", "company_head")
          .where("claimedByUserId", "=", oldUserId)
          .execute();
      } else {
        await transaction
          .insertInto("corporateBootstrapState")
          .values({
            id: "company_head",
            claimedByUserId: userId,
            claimedAt: now,
          })
          .execute();
        await transaction
          .insertInto("umfSupportStaff")
          .values({
            userId,
            role: "director",
            status: "active",
            approvedByUserId: userId,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
        await transaction
          .insertInto("companyStaffProfiles")
          .values({
            userId,
            position: "platform_head",
            reportsToUserId: null,
            status: "active",
            appointedByUserId: userId,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      }
      const openRequests = await transaction
        .selectFrom("umfSupportAccessRequests")
        .select("id")
        .where("email", "=", user.email)
        .where("status", "in", ["pending", "approved"])
        .$if(Boolean(accessRequestId), (query) =>
          query.where("id", "=", accessRequestId!),
        )
        .execute();
      await transaction
        .updateTable("umfSupportAccessRequests")
        .set({
          status: "activated",
          activationCodeHash: null,
          activationExpiresAt: null,
          reviewedByUserId: userId,
          reviewedAt: now,
          activatedUserId: userId,
          updatedAt: now,
        })
        .where("email", "=", user.email)
        .where("status", "in", ["pending", "approved"])
        .$if(Boolean(accessRequestId), (query) =>
          query.where("id", "=", accessRequestId!),
        )
        .execute();
      for (const request of openRequests) {
        await transaction
          .deleteFrom("umfSupportAccessCredentials")
          .where("requestId", "=", request.id)
          .execute();
      }
      await transaction
        .insertInto("securityEvents")
        .values({
          id: `security-${randomBytes(12).toString("hex")}`,
          userId,
          type: "company_head_bootstrapped",
          createdAt: now,
          metadata: JSON.stringify({
            mode:
              state || supportStaff || companyStaff
                ? "separated_from_commercial_identity"
                : accessRequestId
                  ? "designated_support_activation"
                  : "designated_verified_account",
          }),
        })
        .execute();
    });
  } catch (error) {
    if (error instanceof CompanyBootstrapUnavailableError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      throw new CompanyBootstrapUnavailableError();
    }
    throw error;
  }
}

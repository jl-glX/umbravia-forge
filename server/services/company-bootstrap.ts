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
  const [state, operator, supportStaff, companyStaff] = await Promise.all([
    db
      .selectFrom("corporateBootstrapState")
      .select("id")
      .where("id", "=", "company_head")
      .executeTakeFirst(),
    db.selectFrom("platformOperators").select("userId").executeTakeFirst(),
    db.selectFrom("umfSupportStaff").select("userId").executeTakeFirst(),
    db.selectFrom("companyStaffProfiles").select("userId").executeTakeFirst(),
  ]);
  return Boolean(state || operator || supportStaff || companyStaff);
}

function isDesignatedBootstrapEmail(email: string): boolean {
  const configured =
    process.env.UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256?.trim().toLowerCase();
  if (!configured || !/^[a-f0-9]{64}$/.test(configured)) return false;
  const actual = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest();
  return timingSafeEqual(actual, Buffer.from(configured, "hex"));
}

export async function canBootstrapCompanyHead(
  userId: string,
): Promise<boolean> {
  const user = await db
    .selectFrom("users")
    .select(["email", "accountStatus", "emailVerifiedAt"])
    .where("id", "=", userId)
    .executeTakeFirst();
  return Boolean(
    user?.accountStatus === "active" &&
    user.emailVerifiedAt !== null &&
    isDesignatedBootstrapEmail(user.email) &&
    !(await hasAnyCorporateInitialization()),
  );
}

export async function bootstrapCompanyHead(userId: string): Promise<void> {
  const now = Date.now();
  try {
    await db.transaction().execute(async (transaction) => {
      const user = await transaction
        .selectFrom("users")
        .select(["email", "accountStatus", "emailVerifiedAt"])
        .where("id", "=", userId)
        .executeTakeFirst();
      if (
        !user ||
        user.accountStatus !== "active" ||
        user.emailVerifiedAt === null ||
        !isDesignatedBootstrapEmail(user.email)
      ) {
        throw new CompanyBootstrapUnavailableError();
      }

      const [state, operator, supportStaff, companyStaff] = await Promise.all([
        transaction
          .selectFrom("corporateBootstrapState")
          .select("id")
          .executeTakeFirst(),
        transaction
          .selectFrom("platformOperators")
          .select("userId")
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
      if (state || operator || supportStaff || companyStaff) {
        throw new CompanyBootstrapUnavailableError();
      }

      await transaction
        .insertInto("corporateBootstrapState")
        .values({ id: "company_head", claimedByUserId: userId, claimedAt: now })
        .execute();
      await transaction
        .insertInto("platformOperators")
        .values({
          userId,
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
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
        .execute();
      await transaction
        .insertInto("securityEvents")
        .values({
          id: `security-${randomBytes(12).toString("hex")}`,
          userId,
          type: "company_head_bootstrapped",
          createdAt: now,
          metadata: JSON.stringify({ mode: "designated_verified_account" }),
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

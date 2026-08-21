import "dotenv/config";
import { closeDatabase, db, initializeDatabase } from "../server/db/client.js";
import { recordSecurityEvent } from "../server/services/security-events.js";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function normalizedEmail(value: string | null, name: string): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must contain a valid email address`);
  }
  return email;
}

const email = normalizedEmail(argument("--email"), "--email");
const confirmation = normalizedEmail(
  argument("--confirm-email"),
  "--confirm-email",
);
const apply = process.argv.includes("--apply");

if (email !== confirmation) {
  throw new Error("--email and --confirm-email must match exactly");
}

await initializeDatabase();

try {
  const user = await db
    .selectFrom("users")
    .select(["id", "accountStatus", "emailVerifiedAt"])
    .where("email", "=", email)
    .executeTakeFirst();
  if (!user) {
    throw new Error(
      "The account does not exist yet. Complete account creation before appointing the company head.",
    );
  }
  if (user.accountStatus !== "active") {
    throw new Error("The target account is not active");
  }
  if (user.emailVerifiedAt === null) {
    throw new Error("The target account email is not verified");
  }

  const [
    activeHead,
    otherCompanyStaff,
    supportRecord,
    companyRecord,
    platformOperator,
    bootstrapState,
  ] = await Promise.all([
    db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("position", "=", "platform_head")
      .where("status", "=", "active")
      .executeTakeFirst(),
    db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("status", "=", "active")
      .where("userId", "!=", user.id)
      .execute(),
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
      .selectFrom("platformOperators")
      .select("status")
      .where("userId", "=", user.id)
      .executeTakeFirst(),
    db
      .selectFrom("corporateBootstrapState")
      .select("claimedByUserId")
      .where("id", "=", "company_head")
      .executeTakeFirst(),
  ]);

  if (bootstrapState && bootstrapState.claimedByUserId !== user.id) {
    throw new Error(
      "The one-time company head bootstrap was already claimed by another account.",
    );
  }

  if (activeHead && activeHead.userId !== user.id) {
    throw new Error(
      "Another active company head already exists; revoke or replace that appointment through an audited process first.",
    );
  }
  if (otherCompanyStaff.length > 0) {
    throw new Error(
      "Other active company staff already exist; the initial single-person appointment will not overwrite them.",
    );
  }

  const plan = {
    status: apply ? "applying" : "dry_run",
    userId: user.id,
    companyPosition: "platform_head",
    supportRole: "director",
    grantsPlatformOperator: true,
    current: {
      companyPosition: companyRecord?.position ?? null,
      companyStatus: companyRecord?.status ?? null,
      supportRole: supportRecord?.role ?? null,
      supportStatus: supportRecord?.status ?? null,
      platformOperator: platformOperator?.status ?? null,
    },
  };

  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const now = Date.now();
    await db.transaction().execute(async (transaction) => {
      if (!bootstrapState) {
        await transaction
          .insertInto("corporateBootstrapState")
          .values({
            id: "company_head",
            claimedByUserId: user.id,
            claimedAt: now,
          })
          .execute();
      }
      if (supportRecord) {
        await transaction
          .updateTable("umfSupportStaff")
          .set({
            role: "director",
            status: "active",
            approvedByUserId: user.id,
            updatedAt: now,
            revokedAt: null,
          })
          .where("userId", "=", user.id)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto("umfSupportStaff")
          .values({
            userId: user.id,
            role: "director",
            status: "active",
            approvedByUserId: user.id,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      }

      if (companyRecord) {
        await transaction
          .updateTable("companyStaffProfiles")
          .set({
            position: "platform_head",
            reportsToUserId: null,
            status: "active",
            appointedByUserId: user.id,
            updatedAt: now,
            revokedAt: null,
          })
          .where("userId", "=", user.id)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto("companyStaffProfiles")
          .values({
            userId: user.id,
            position: "platform_head",
            reportsToUserId: null,
            status: "active",
            appointedByUserId: user.id,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      }

      if (platformOperator) {
        await transaction
          .updateTable("platformOperators")
          .set({ status: "active", updatedAt: now, revokedAt: null })
          .where("userId", "=", user.id)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto("platformOperators")
          .values({
            userId: user.id,
            source: "controlled_provisioning",
            status: "active",
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      }
    });

    await recordSecurityEvent("umf_support_staff_changed", user.id, {
      subjectUserId: user.id,
      role: "director",
      status: "active",
      companyPosition: "platform_head",
      provisioning: "initial_company_head",
      grantsPlatformOperator: true,
    });
    console.log(
      JSON.stringify(
        {
          ...plan,
          status: "applied",
          platformOperatorChanged: platformOperator?.status !== "active",
        },
        null,
        2,
      ),
    );
  }
} finally {
  await closeDatabase();
}

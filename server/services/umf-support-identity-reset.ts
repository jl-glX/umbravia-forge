import { createHash } from "node:crypto";
import { db } from "../db/client.js";

const resetEventTypes = [
  "umf_support_access_requested",
  "umf_support_access_approved",
  "umf_support_access_rejected",
  "umf_support_activation_failed",
  "umf_support_account_activated",
  "company_head_bootstrapped",
] as const;

function normalizedEmail(value: string, label: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${label} must be a valid email address`);
  }
  return email;
}

function fingerprint(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 24);
}

export type UmfSupportIdentityResetInput = {
  corporateEmail: string;
  legacyCommercialEmail?: string;
};

export type UmfSupportIdentityResetPlan = {
  corporateEmail: string;
  legacyCommercialEmail: string | null;
  corporateUserId: string | null;
  legacyCommercialUserId: string | null;
  supportStaffRows: number;
  companyStaffRows: number;
  roleAssignmentRows: number;
  roleDelegationRows: number;
  accessRequestRows: number;
  supportDeliveryRows: number;
  bootstrapRows: number;
  corporateUserRows: number;
};

async function resolveResetContext(input: UmfSupportIdentityResetInput) {
  const corporateEmail = normalizedEmail(
    input.corporateEmail,
    "corporateEmail",
  );
  const legacyCommercialEmail = input.legacyCommercialEmail
    ? normalizedEmail(input.legacyCommercialEmail, "legacyCommercialEmail")
    : null;
  const [corporateUser, commercialUser] = await Promise.all([
    db
      .selectFrom("users")
      .select("id")
      .where("identityRealm", "=", "corporate_support")
      .where("email", "=", corporateEmail)
      .executeTakeFirst(),
    legacyCommercialEmail
      ? db
          .selectFrom("users")
          .select("id")
          .where("identityRealm", "=", "commercial")
          .where("email", "=", legacyCommercialEmail)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  const targetUserIds = [corporateUser?.id, commercialUser?.id].filter(
    (value): value is string => Boolean(value),
  );
  const targetEmails = [corporateEmail, legacyCommercialEmail].filter(
    (value): value is string => Boolean(value),
  );
  const bootstrapState = await db
    .selectFrom("corporateBootstrapState")
    .select("claimedByUserId")
    .where("id", "=", "company_head")
    .executeTakeFirst();
  if (
    bootstrapState?.claimedByUserId &&
    !targetUserIds.includes(bootstrapState.claimedByUserId)
  ) {
    throw new Error(
      "The corporate reset is blocked because the company head belongs to another identity",
    );
  }
  if (targetUserIds.length > 0) {
    const [otherSupportStaff, otherCompanyStaff] = await Promise.all([
      db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "not in", targetUserIds)
        .executeTakeFirst(),
      db
        .selectFrom("companyStaffProfiles")
        .select("userId")
        .where("userId", "not in", targetUserIds)
        .executeTakeFirst(),
    ]);
    if (otherSupportStaff || otherCompanyStaff) {
      throw new Error(
        "The corporate reset is blocked because other staff records exist",
      );
    }
  } else {
    const [supportStaff, companyStaff] = await Promise.all([
      db.selectFrom("umfSupportStaff").select("userId").executeTakeFirst(),
      db.selectFrom("companyStaffProfiles").select("userId").executeTakeFirst(),
    ]);
    if (supportStaff || companyStaff) {
      throw new Error(
        "The corporate reset is blocked because its owner could not be resolved",
      );
    }
  }
  return {
    corporateEmail,
    legacyCommercialEmail,
    corporateUserId: corporateUser?.id ?? null,
    legacyCommercialUserId: commercialUser?.id ?? null,
    targetUserIds,
    targetEmails,
    bootstrapState,
  };
}

async function countRows<T>(promise: Promise<T[]>): Promise<number> {
  return (await promise).length;
}

export async function planUmfSupportIdentityReset(
  input: UmfSupportIdentityResetInput,
): Promise<UmfSupportIdentityResetPlan> {
  const context = await resolveResetContext(input);
  const users = context.targetUserIds;
  const emails = context.targetEmails;
  const byUsers = users.length > 0;
  const [
    supportStaffRows,
    companyStaffRows,
    roleAssignmentRows,
    roleDelegationRows,
    accessRequestRows,
    supportDeliveryRows,
    bootstrapRows,
  ] = await Promise.all([
    byUsers
      ? countRows(
          db
            .selectFrom("umfSupportStaff")
            .select("userId")
            .where("userId", "in", users)
            .execute(),
        )
      : 0,
    byUsers
      ? countRows(
          db
            .selectFrom("companyStaffProfiles")
            .select("userId")
            .where("userId", "in", users)
            .execute(),
        )
      : 0,
    byUsers
      ? countRows(
          db
            .selectFrom("corporateRoleAssignments")
            .select("id")
            .where((expression) =>
              expression.or([
                expression("userId", "in", users),
                expression("assignedByUserId", "in", users),
              ]),
            )
            .execute(),
        )
      : 0,
    byUsers
      ? countRows(
          db
            .selectFrom("corporateRoleDelegations")
            .select("id")
            .where((expression) =>
              expression.or([
                expression("recipientUserId", "in", users),
                expression("delegatedByUserId", "in", users),
              ]),
            )
            .execute(),
        )
      : 0,
    countRows(
      db
        .selectFrom("umfSupportAccessRequests")
        .select("id")
        .where((expression) =>
          expression.or([
            expression("email", "in", emails),
            ...(byUsers ? [expression("activatedUserId", "in", users)] : []),
          ]),
        )
        .execute(),
    ),
    countRows(
      db
        .selectFrom("emailDeliveries")
        .select("id")
        .where("platformScope", "=", "support")
        .where((expression) =>
          expression.or([
            expression("recipient", "in", emails),
            ...(byUsers ? [expression("userId", "in", users)] : []),
          ]),
        )
        .execute(),
    ),
    countRows(
      db
        .selectFrom("corporateBootstrapState")
        .select("id")
        .where("id", "=", "company_head")
        .execute(),
    ),
  ]);
  return {
    corporateEmail: context.corporateEmail,
    legacyCommercialEmail: context.legacyCommercialEmail,
    corporateUserId: context.corporateUserId,
    legacyCommercialUserId: context.legacyCommercialUserId,
    supportStaffRows,
    companyStaffRows,
    roleAssignmentRows,
    roleDelegationRows,
    accessRequestRows,
    supportDeliveryRows,
    bootstrapRows,
    corporateUserRows: context.corporateUserId ? 1 : 0,
  };
}

export async function applyUmfSupportIdentityReset(
  input: UmfSupportIdentityResetInput,
): Promise<UmfSupportIdentityResetPlan> {
  const plan = await planUmfSupportIdentityReset(input);
  const context = await resolveResetContext(input);
  const users = context.targetUserIds;
  const emails = context.targetEmails;
  const fingerprints = emails.map(fingerprint);
  await db.transaction().execute(async (transaction) => {
    if (users.length > 0) {
      await transaction
        .deleteFrom("corporateRoleDelegations")
        .where((expression) =>
          expression.or([
            expression("recipientUserId", "in", users),
            expression("delegatedByUserId", "in", users),
          ]),
        )
        .execute();
      await transaction
        .deleteFrom("corporateRoleAssignments")
        .where((expression) =>
          expression.or([
            expression("userId", "in", users),
            expression("assignedByUserId", "in", users),
          ]),
        )
        .execute();
      await transaction
        .deleteFrom("companyStaffProfiles")
        .where("userId", "in", users)
        .execute();
      await transaction
        .deleteFrom("umfSupportStaff")
        .where("userId", "in", users)
        .execute();
    }
    if (context.bootstrapState) {
      await transaction
        .deleteFrom("corporateBootstrapState")
        .where("id", "=", "company_head")
        .execute();
    }
    await transaction
      .deleteFrom("umfSupportAccessRequests")
      .where((expression) =>
        expression.or([
          expression("email", "in", emails),
          ...(users.length > 0
            ? [expression("activatedUserId", "in", users)]
            : []),
        ]),
      )
      .execute();
    await transaction
      .deleteFrom("emailDeliveries")
      .where("platformScope", "=", "support")
      .where((expression) =>
        expression.or([
          expression("recipient", "in", emails),
          ...(users.length > 0 ? [expression("userId", "in", users)] : []),
        ]),
      )
      .execute();
    if (users.length > 0 || fingerprints.length > 0) {
      await transaction
        .deleteFrom("securityEvents")
        .where("type", "in", [...resetEventTypes])
        .where((expression) =>
          expression.or([
            ...(users.length > 0 ? [expression("userId", "in", users)] : []),
            ...fingerprints.map((value) =>
              expression("metadata", "like", `%${value}%`),
            ),
          ]),
        )
        .execute();
    }
    if (context.corporateUserId) {
      await transaction
        .deleteFrom("users")
        .where("id", "=", context.corporateUserId)
        .where("identityRealm", "=", "corporate_support")
        .execute();
    }
  });
  return plan;
}

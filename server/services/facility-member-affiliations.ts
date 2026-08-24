import { db } from "../db/client.js";

export class FacilityMemberAffiliationPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FacilityMemberAffiliationPolicyError";
  }
}

export async function getFacilityMemberAffiliationPolicy(facilityId: string) {
  const [facility, staff] = await Promise.all([
    db
      .selectFrom("facilityProfiles")
      .select("allowStaffMemberAffiliations")
      .where("id", "=", facilityId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("facilityMemberships")
      .innerJoin("users", "users.id", "facilityMemberships.userId")
      .select([
        "users.id as userId",
        "users.name",
        "users.email",
        "facilityMemberships.role",
        "facilityMemberships.staffMemberAffiliationAllowed as specificallyAllowed",
        "facilityMemberships.memberAffiliation",
      ])
      .where("facilityMemberships.facilityId", "=", facilityId)
      .where("facilityMemberships.status", "=", "active")
      .where("facilityMemberships.role", "in", ["admin", "trainer"])
      .where("users.accountStatus", "=", "active")
      .orderBy("users.name", "asc")
      .execute(),
  ]);
  return {
    allowAllStaff: facility.allowStaffMemberAffiliations === 1,
    staff: staff.map((person) => ({
      ...person,
      specificallyAllowed: person.specificallyAllowed === 1,
      memberAffiliation: person.memberAffiliation === 1,
    })),
  };
}

export async function updateFacilityMemberAffiliationPolicy(
  facilityId: string,
  allowAllStaff: boolean,
  specificallyAllowedUserIds: string[],
) {
  const uniqueIds = [...new Set(specificallyAllowedUserIds)];
  const eligible = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select("facilityMemberships.userId")
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.status", "=", "active")
    .where("facilityMemberships.role", "in", ["admin", "trainer"])
    .where("users.accountStatus", "=", "active")
    .execute();
  const eligibleIds = new Set(eligible.map((row) => row.userId));
  if (uniqueIds.some((userId) => !eligibleIds.has(userId))) {
    throw new FacilityMemberAffiliationPolicyError(
      "STAFF_MEMBER_AFFILIATION_SELECTION_INVALID",
    );
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("facilityProfiles")
      .set({
        allowStaffMemberAffiliations: allowAllStaff ? 1 : 0,
        updatedAt: Date.now(),
      })
      .where("id", "=", facilityId)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("facilityMemberships")
      .set({ staffMemberAffiliationAllowed: 0, updatedAt: Date.now() })
      .where("facilityId", "=", facilityId)
      .where("role", "in", ["admin", "trainer"])
      .execute();
    if (uniqueIds.length > 0) {
      await transaction
        .updateTable("facilityMemberships")
        .set({ staffMemberAffiliationAllowed: 1, updatedAt: Date.now() })
        .where("facilityId", "=", facilityId)
        .where("userId", "in", uniqueIds)
        .where("role", "in", ["admin", "trainer"])
        .execute();
    }
  });
  return getFacilityMemberAffiliationPolicy(facilityId);
}

export async function staffMayAffiliateAsMember(
  facilityId: string,
  userId: string,
): Promise<boolean> {
  const membership = await db
    .selectFrom("facilityMemberships")
    .innerJoin(
      "facilityProfiles",
      "facilityProfiles.id",
      "facilityMemberships.facilityId",
    )
    .select([
      "facilityMemberships.role",
      "facilityMemberships.status",
      "facilityMemberships.staffMemberAffiliationAllowed",
      "facilityProfiles.allowStaffMemberAffiliations",
    ])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", userId)
    .executeTakeFirst();
  return Boolean(
    membership &&
    membership.status === "active" &&
    membership.role !== "owner" &&
    membership.role !== "member" &&
    (membership.staffMemberAffiliationAllowed === 1 ||
      membership.allowStaffMemberAffiliations === 1),
  );
}

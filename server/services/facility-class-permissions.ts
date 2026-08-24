import { db } from "../db/client.js";

export const facilityClassPermissions = [
  "classes.create",
  "classes.update",
  "classes.delete",
] as const;

export type FacilityClassPermission = (typeof facilityClassPermissions)[number];
export type FacilityPermissionEffect = "allow" | "deny";

export function parseFacilityClassPermissions(
  value: string,
): Partial<Record<FacilityClassPermission, FacilityPermissionEffect>> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      facilityClassPermissions.flatMap((permission) => {
        const effect = parsed[permission];
        return effect === "allow" || effect === "deny"
          ? [[permission, effect]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

export async function hasFacilityClassPermission(
  userId: string,
  facilityId: string,
  permission: FacilityClassPermission,
): Promise<boolean> {
  const membership = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select([
      "facilityMemberships.role",
      "facilityMemberships.status",
      "facilityMemberships.classPermissions",
      "users.accountStatus",
      "users.emailVerifiedAt",
    ])
    .where("facilityId", "=", facilityId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (
    !membership ||
    membership.status !== "active" ||
    membership.accountStatus !== "active"
  ) {
    return false;
  }
  if (membership.role === "owner") return true;
  if (membership.emailVerifiedAt === null) return false;

  const effect = parseFacilityClassPermissions(membership.classPermissions)[
    permission
  ];
  if (effect) return effect === "allow";
  return membership.role === "admin";
}

export async function updateFacilityClassPermissions(
  facilityId: string,
  userId: string,
  permissions: Partial<
    Record<FacilityClassPermission, FacilityPermissionEffect>
  >,
): Promise<void> {
  const membership = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select([
      "facilityMemberships.role",
      "users.accountStatus",
      "users.emailVerifiedAt",
    ])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.status", "=", "active")
    .executeTakeFirst();
  if (
    !membership ||
    membership.accountStatus !== "active" ||
    membership.emailVerifiedAt === null
  ) {
    throw new Error("FACILITY_PERMISSION_RECIPIENT_NOT_VERIFIED");
  }
  if (membership.role !== "admin") {
    throw new Error("FACILITY_PERMISSION_RECIPIENT_INVALID");
  }

  await db
    .updateTable("facilityMemberships")
    .set({
      classPermissions: JSON.stringify(permissions),
      updatedAt: Date.now(),
    })
    .where("facilityId", "=", facilityId)
    .where("userId", "=", userId)
    .execute();
}

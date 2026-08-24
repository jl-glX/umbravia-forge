import { db } from "../db/client.js";
import type { FacilityRole } from "../db/types.js";

export interface FacilityContext {
  id: string;
  slug: string;
  name: string;
  role: FacilityRole;
  membershipStatus: "active" | "invited";
  accessMode: "full" | "read_only";
}

export class FacilityAccessDeniedError extends Error {
  constructor() {
    super("The requested facility is not available to this account");
    this.name = "FacilityAccessDeniedError";
  }
}

export async function listFacilityContexts(
  userId: string,
): Promise<FacilityContext[]> {
  const facilities = await db
    .selectFrom("facilityMemberships")
    .innerJoin(
      "facilityProfiles",
      "facilityProfiles.id",
      "facilityMemberships.facilityId",
    )
    .select([
      "facilityProfiles.id as id",
      "facilityProfiles.slug as slug",
      "facilityProfiles.name as name",
      "facilityMemberships.role as role",
      "facilityMemberships.status as membershipStatus",
    ])
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.status", "in", ["active", "invited"])
    .where("facilityProfiles.status", "=", "active")
    .orderBy("facilityMemberships.createdAt", "asc")
    .orderBy("facilityProfiles.id", "asc")
    .execute();
  return facilities
    .sort((left, right) => {
      if (left.membershipStatus === right.membershipStatus) return 0;
      return left.membershipStatus === "active" ? -1 : 1;
    })
    .map((facility) => ({
      ...facility,
      membershipStatus:
        facility.membershipStatus === "active"
          ? ("active" as const)
          : ("invited" as const),
      accessMode:
        facility.membershipStatus === "active"
          ? ("full" as const)
          : ("read_only" as const),
    }));
}

export async function isPlatformOperator(userId: string): Promise<boolean> {
  const operator = await db
    .selectFrom("platformOperators")
    .innerJoin("users", "users.id", "platformOperators.userId")
    .select("platformOperators.userId")
    .where("platformOperators.userId", "=", userId)
    .where("platformOperators.status", "=", "active")
    .where("users.identityRealm", "=", "commercial")
    .executeTakeFirst();
  return Boolean(operator);
}

export async function resolveFacilityContext(
  userId: string,
  requestedFacilityId?: string,
): Promise<FacilityContext | null> {
  if (
    requestedFacilityId !== undefined &&
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(requestedFacilityId)
  ) {
    throw new FacilityAccessDeniedError();
  }

  const facilities = await listFacilityContexts(userId);
  if (requestedFacilityId === undefined) return facilities[0] ?? null;

  const requested = facilities.find(
    (facility) => facility.id === requestedFacilityId,
  );
  if (!requested) throw new FacilityAccessDeniedError();
  return requested;
}

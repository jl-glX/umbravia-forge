import { db } from "../db/client.js";
import type { FacilityRole } from "../db/types.js";

export interface FacilityContext {
  id: string;
  slug: string;
  name: string;
  role: FacilityRole;
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
  return db
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
    ])
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.status", "=", "active")
    .where("facilityProfiles.status", "=", "active")
    .orderBy("facilityMemberships.createdAt", "asc")
    .orderBy("facilityProfiles.id", "asc")
    .execute();
}

export async function isPlatformOperator(userId: string): Promise<boolean> {
  const operator = await db
    .selectFrom("platformOperators")
    .select("userId")
    .where("userId", "=", userId)
    .where("status", "=", "active")
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

import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";

export async function createActiveTestFacility(
  database: Kysely<Database>,
  id: string,
  options: { createdAt?: number; name?: string } = {},
) {
  const now = options.createdAt ?? Date.now();
  await database
    .insertInto("facilityProfiles")
    .values({
      id,
      slug: id,
      name: options.name ?? id,
      logoDataUrl: "",
      accentColor: "#2563eb",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}

export async function createActivePlatformOperator(
  database: Kysely<Database>,
  userId: string,
  createdAt = Date.now(),
) {
  await database
    .insertInto("platformOperators")
    .values({
      userId,
      source: "controlled_provisioning",
      status: "active",
      createdAt,
      updatedAt: createdAt,
      revokedAt: null,
    })
    .execute();
}

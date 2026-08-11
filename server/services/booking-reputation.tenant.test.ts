import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("booking reputation tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let reputation: typeof import("./booking-reputation.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-reputation-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    reputation = await import("./booking-reputation.js");
    await database.initializeDatabase();

    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("users")
      .values({
        id: "shared-member",
        email: "shared-member@example.com",
        phone: null,
        name: "Shared member",
        avatarDataUrl: "",
        password: "synthetic-hash",
        role: "member",
        sessionIdleTimeoutMinutes: 60,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "primary:shared-member",
          facilityId: "primary",
          userId: "shared-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:shared-member",
          facilityId: "secondary",
          userId: "shared-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("maintains independent scores and events for each facility", async () => {
    await reputation.adjustBookingReputation({
      userId: "shared-member",
      facilityId: "primary",
      pointsDelta: -10,
      reason: "Primary-only adjustment",
    });
    await reputation.adjustBookingReputation({
      userId: "shared-member",
      facilityId: "secondary",
      pointsDelta: -25,
      reason: "Secondary-only adjustment",
    });

    await expect(
      reputation.getBookingReputation("shared-member", "primary"),
    ).resolves.toMatchObject({ score: 90 });
    await expect(
      reputation.getBookingReputation("shared-member", "secondary"),
    ).resolves.toMatchObject({ score: 75 });

    const rows = await database.db
      .selectFrom("bookingReputations")
      .select(["facilityId", "userId", "score"])
      .where("userId", "=", "shared-member")
      .orderBy("facilityId")
      .execute();
    expect(rows).toEqual([
      { facilityId: "primary", userId: "shared-member", score: 90 },
      { facilityId: "secondary", userId: "shared-member", score: 75 },
    ]);

    const events = await database.db
      .selectFrom("bookingReputationEvents")
      .select(["facilityId", "reason"])
      .orderBy("facilityId")
      .execute();
    expect(events).toEqual([
      { facilityId: "primary", reason: "Primary-only adjustment" },
      { facilityId: "secondary", reason: "Secondary-only adjustment" },
    ]);
  });
});

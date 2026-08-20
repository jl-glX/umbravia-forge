import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("tenant foundation migration", () => {
  let directory: string;
  let database: typeof import("./client.js");

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-tenant-foundation-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();

    await database.db
      .insertInto("users")
      .values([
        {
          id: "legacy-admin-first",
          email: "first-admin@example.com",
          phone: null,
          name: "First admin",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: 10,
        },
        {
          id: "legacy-admin-second",
          email: "second-admin@example.com",
          phone: null,
          name: "Second admin",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: 20,
        },
        {
          id: "legacy-trainer",
          email: "trainer@example.com",
          phone: null,
          name: "Trainer",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "trainer",
          sessionIdleTimeoutMinutes: 60,
          createdAt: 30,
        },
        {
          id: "legacy-member",
          email: "member@example.com",
          phone: null,
          name: "Member",
          avatarDataUrl: "",
          password: "synthetic-hash",
          role: "member",
          sessionIdleTimeoutMinutes: 60,
          createdAt: 40,
        },
      ])
      .execute();

    await database.initializeDatabase();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("does not create an implicit compatibility facility", async () => {
    await expect(
      database.db.selectFrom("facilityProfiles").select("id").execute(),
    ).resolves.toEqual([]);
  });

  it("does not grant facility or platform authority from a global role", async () => {
    const memberships = await database.db
      .selectFrom("facilityMemberships")
      .select("id")
      .execute();
    const operators = await database.db
      .selectFrom("platformOperators")
      .select("userId")
      .execute();
    expect(memberships).toEqual([]);
    expect(operators).toEqual([]);
  });

  it("keeps the backfill idempotent", async () => {
    await database.initializeDatabase();
    const memberships = await database.db
      .selectFrom("facilityMemberships")
      .select("id")
      .execute();
    expect(memberships).toHaveLength(0);
  });

  it("closes inherited noncanonical scopes instead of granting access", async () => {
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "legacy-retired-scope",
        slug: "legacy-retired-scope",
        name: "Retired scope",
        logoDataUrl: "",
        accentColor: "#64748b",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "legacy-retired-scope:legacy-member",
        facilityId: "legacy-retired-scope",
        userId: "legacy-member",
        role: "member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await database.initializeDatabase();

    await expect(
      database.db
        .selectFrom("facilityProfiles")
        .select("status")
        .where("id", "=", "legacy-retired-scope")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "closed" });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("status")
        .where("id", "=", "legacy-retired-scope:legacy-member")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "suspended" });
    await expect(
      database.db
        .insertInto("activitySessions")
        .values({
          id: "legacy-retired-session",
          facilityId: "legacy-retired-scope",
          name: "Rejected session",
          description: "",
          trainerId: "legacy-trainer",
          trainerName: "Legacy trainer",
          maxCapacity: 1,
          scheduledAt: now + 60_000,
        })
        .execute(),
    ).rejects.toThrow("Facility scope is not active");
  });
});

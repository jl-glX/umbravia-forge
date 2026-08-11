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

  it("keeps the existing primary facility as the compatibility tenant", async () => {
    await expect(
      database.db
        .selectFrom("facilityProfiles")
        .select(["id", "slug", "status", "createdAt"])
        .where("id", "=", "primary")
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      id: "primary",
      slug: "primary",
      status: "active",
    });
  });

  it("backfills every legacy account and assigns one deterministic owner", async () => {
    const memberships = await database.db
      .selectFrom("facilityMemberships")
      .select(["facilityId", "userId", "role", "status"])
      .orderBy("userId")
      .execute();

    expect(memberships).toEqual([
      {
        facilityId: "primary",
        userId: "legacy-admin-first",
        role: "owner",
        status: "active",
      },
      {
        facilityId: "primary",
        userId: "legacy-admin-second",
        role: "admin",
        status: "active",
      },
      {
        facilityId: "primary",
        userId: "legacy-member",
        role: "member",
        status: "active",
      },
      {
        facilityId: "primary",
        userId: "legacy-trainer",
        role: "trainer",
        status: "active",
      },
    ]);
  });

  it("keeps the backfill idempotent", async () => {
    await database.initializeDatabase();
    const memberships = await database.db
      .selectFrom("facilityMemberships")
      .select("id")
      .execute();
    expect(memberships).toHaveLength(4);
  });
});

import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("community tenant migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    migratedDatabase = undefined;
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("moves legacy parental controls into primary and permits a pair per facility", async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-community-v21-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    const now = Date.now();
    await baselineDatabase.db
      .insertInto("users")
      .values([
        {
          id: "community-child",
          email: "community-child@example.com",
          phone: null,
          name: "Child",
          avatarDataUrl: "",
          password: "test-only",
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
        {
          id: "community-guardian",
          email: "community-guardian@example.com",
          phone: null,
          name: "Guardian",
          avatarDataUrl: "",
          password: "test-only",
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
      ])
      .execute();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TABLE parentalControls;
      CREATE TABLE parentalControls (
        id TEXT PRIMARY KEY,
        childUserId TEXT NOT NULL,
        guardianUserId TEXT NOT NULL,
        settings TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(childUserId, guardianUserId)
      );
      INSERT INTO parentalControls (
        id, childUserId, guardianUserId, settings, status, createdAt, updatedAt
      ) VALUES (
        'legacy-control', 'community-child', 'community-guardian', '{}',
        'parental_control_active', 10, 10
      );
    `);
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();
    await migratedDatabase.db
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
    await migratedDatabase.db
      .insertInto("parentalControls")
      .values({
        id: "secondary-control",
        facilityId: "secondary",
        childUserId: "community-child",
        guardianUserId: "community-guardian",
        settings: "{}",
        status: "parental_control_active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await expect(
      migratedDatabase.db
        .selectFrom("parentalControls")
        .select(["id", "facilityId"])
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([
      { id: "legacy-control", facilityId: "primary" },
      { id: "secondary-control", facilityId: "secondary" },
    ]);
  });
});

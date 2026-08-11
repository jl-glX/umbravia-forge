import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("commercial trial tenant migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    migratedDatabase = undefined;
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("moves the legacy trial into primary and allows one trial per facility", async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-commercial-v22-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.db
      .insertInto("users")
      .values({
        id: "commercial-migration-owner",
        email: "commercial-migration@example.com",
        phone: null,
        name: "Migration Owner",
        avatarDataUrl: "",
        password: "test-only",
        role: "admin",
        sessionIdleTimeoutMinutes: 10080,
        createdAt: 10,
      })
      .execute();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TABLE commercialTrials;
      CREATE TABLE commercialTrials (
        id TEXT PRIMARY KEY,
        ownerUserId TEXT NOT NULL,
        facilityName TEXT NOT NULL,
        facilityType TEXT NOT NULL,
        approximateMembers INTEGER,
        trainerCount INTEGER,
        spaceCount INTEGER,
        usualCapacity INTEGER,
        classTypes TEXT NOT NULL DEFAULT '[]',
        scheduleNotes TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL,
        currency TEXT NOT NULL,
        usesBookings INTEGER NOT NULL DEFAULT 1,
        usesWaitlist INTEGER NOT NULL DEFAULT 1,
        templateKey TEXT NOT NULL,
        status TEXT NOT NULL,
        subdomain TEXT NOT NULL,
        realDataDeclaration TEXT NOT NULL DEFAULT 'undeclared',
        conversionDraft TEXT NOT NULL DEFAULT '[]',
        startedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        pausedAt INTEGER,
        closedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO commercialTrials (
        id, ownerUserId, facilityName, facilityType, approximateMembers,
        trainerCount, spaceCount, usualCapacity, classTypes, scheduleNotes,
        locale, currency, usesBookings, usesWaitlist, templateKey, status,
        subdomain, realDataDeclaration, conversionDraft, startedAt, expiresAt,
        pausedAt, closedAt, createdAt, updatedAt
      ) VALUES (
        'primary', 'commercial-migration-owner', 'Legacy Facility',
        'traditional_gym', NULL, NULL, NULL, 20, '[]', '', 'es', 'EUR', 1, 1,
        'traditional_gym', 'trial_active', 'legacy-demo', 'undeclared', '[]',
        10, 20, NULL, NULL, 10, 10
      );
    `);
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();

    await expect(
      migratedDatabase.db
        .selectFrom("commercialTrials")
        .select([
          "id",
          "facilityId",
          "autoCleanupEligible",
          "dataReviewRequestedAt",
          "cleanupEligibleAt",
        ])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      id: "primary",
      facilityId: "primary",
      autoCleanupEligible: 0,
      dataReviewRequestedAt: null,
      cleanupEligibleAt: null,
    });

    const migratedTrial = await migratedDatabase.db
      .selectFrom("commercialTrials")
      .selectAll()
      .executeTakeFirstOrThrow();
    await migratedDatabase.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary Facility",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: 20,
        updatedAt: 20,
      })
      .execute();
    await migratedDatabase.db
      .insertInto("commercialTrials")
      .values({
        ...migratedTrial,
        id: "trial-secondary",
        facilityId: "secondary",
        facilityName: "Secondary Facility",
        subdomain: "secondary-demo",
      })
      .execute();
    await expect(
      migratedDatabase.db
        .selectFrom("commercialTrials")
        .select(["id", "facilityId"])
        .orderBy("facilityId")
        .execute(),
    ).resolves.toEqual([
      { id: "primary", facilityId: "primary" },
      { id: "trial-secondary", facilityId: "secondary" },
    ]);
  });
});

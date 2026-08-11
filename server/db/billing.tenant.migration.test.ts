import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("billing tenant migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    migratedDatabase = undefined;
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("moves legacy billing records into the primary facility", async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-billing-v18-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TABLE billingRecords;
      CREATE TABLE billingRecords (
        id TEXT PRIMARY KEY,
        userId TEXT,
        customerName TEXT NOT NULL,
        customerEmail TEXT NOT NULL DEFAULT '',
        concept TEXT NOT NULL,
        billingCycle TEXT NOT NULL,
        customCycleLabel TEXT NOT NULL DEFAULT '',
        amountCents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        status TEXT NOT NULL,
        dueAt INTEGER,
        paidAt INTEGER,
        invoiceNumber TEXT,
        notes TEXT NOT NULL DEFAULT '',
        archivedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO billingRecords (
        id, userId, customerName, customerEmail, concept, billingCycle,
        customCycleLabel, amountCents, currency, status, dueAt, paidAt,
        invoiceNumber, notes, archivedAt, createdAt, updatedAt
      ) VALUES (
        'legacy-billing', NULL, 'Legacy customer', 'legacy@example.com',
        'Legacy membership', 'monthly', '', 4500, 'EUR', 'pending', NULL,
        NULL, 'LEGACY-001', '', NULL, 10, 10
      );
    `);
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();

    await expect(
      migratedDatabase.db
        .selectFrom("billingRecords")
        .select(["id", "facilityId", "concept"])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      id: "legacy-billing",
      facilityId: "primary",
      concept: "Legacy membership",
    });
  });
});

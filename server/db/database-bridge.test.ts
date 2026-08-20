import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("SQLite to PostgreSQL bridge planning", () => {
  let directory: string;
  let database: typeof import("./client.js");
  let bridge: typeof import("./database-bridge.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-db-bridge-"));
    vi.stubEnv("DATA_DIRECTORY", join(directory, "active"));
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    bridge = await import("./database-bridge.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates and inventories a complete isolated SQLite environment", async () => {
    const environmentPath = join(directory, "sandbox", "database.sqlite");
    await database.createSqliteEnvironmentDatabase(environmentPath);

    const inspection = bridge.inspectSqliteDatabase(environmentPath);
    const plan = bridge.buildSqliteToPostgresMigrationPlan(environmentPath);

    expect(inspection.ready).toBe(true);
    expect(inspection.rowCounts.facilityProfiles).toBe(0);
    expect(plan.targetProvider).toBe("postgresql");
    expect(plan.executionEnabled).toBe(false);
    expect(plan.excludedByDefault).toContain("sessions");
  });

  it("blocks readiness when a required table is missing", async () => {
    const environmentPath = join(directory, "incomplete", "database.sqlite");
    await database.createSqliteEnvironmentDatabase(environmentPath);
    const sqlite = new Database(environmentPath);
    sqlite.exec("DROP TABLE feedback");
    sqlite.close();

    const inspection = bridge.inspectSqliteDatabase(environmentPath);
    expect(inspection.ready).toBe(false);
    expect(inspection.missingTables).toContain("feedback");
  });
});

import { describe, expect, it } from "vitest";
import { parse } from "pgsql-ast-parser";
import { migratableTables } from "./database-bridge.js";
import {
  postgresInitialSchema,
  postgresMigrationSql,
  postgresMigrationVersions,
} from "./postgres-migrations.js";

describe("PostgreSQL migrations", () => {
  it("keeps migration versions ordered and unique", () => {
    const versions = postgresMigrationVersions();
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(1);
  });

  it("contains syntactically valid PostgreSQL statements", () => {
    expect(() => parse(postgresInitialSchema)).not.toThrow();
    for (const migration of postgresMigrationSql()) {
      expect(() => parse(migration)).not.toThrow();
    }
  });

  it("covers every application table expected by isolated SQLite environments", () => {
    const sql = postgresMigrationSql().join("\n");
    const legacyTableNames = new Map([
      ["gymClasses", "activitySessions"],
      ["classBookingConfigurations", "activitySessionBookingConfigurations"],
      ["classSessionContents", "activitySessionContents"],
    ]);
    const tables = new Set(
      [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map(
        (match) => legacyTableNames.get(match[1]) ?? match[1],
      ),
    );

    expect([...migratableTables].sort()).toEqual([...tables].sort());
  });

  it("keeps legacy activity identifiers out of the resulting schema", () => {
    const activityMigration = postgresMigrationSql().at(-1) ?? "";

    expect(activityMigration).toContain('ALTER TABLE "gymClasses"');
    expect(activityMigration).toContain('RENAME TO "activitySessions"');
    expect(activityMigration).not.toContain(
      'CREATE OR REPLACE VIEW "gymClasses"',
    );
  });
});

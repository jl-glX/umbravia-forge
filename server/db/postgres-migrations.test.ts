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
      [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)]
        .map((match) => legacyTableNames.get(match[1]) ?? match[1])
        .filter((tableName) => tableName !== "managerTerminalAccess"),
    );

    expect([...migratableTables].sort()).toEqual([...tables].sort());
  });

  it("purges the retired browser-terminal credentials after historical migrations", () => {
    const retirement = postgresMigrationSql().find((sql) =>
      sql.includes('DROP TABLE IF EXISTS "managerTerminalAccess"'),
    );
    expect(retirement).toBeDefined();
  });

  it("scopes legacy transactional email with explicit UMF Support evidence", () => {
    const migration = postgresMigrationSql().find(
      (sql) =>
        sql.includes('ALTER TABLE "emailDeliveries"') &&
        sql.includes('ADD COLUMN IF NOT EXISTS "platformScope"'),
    );
    expect(migration).toContain("DEFAULT 'commercial'");
    expect(migration).toContain('FROM "umfSupportMessages"');
    expect(migration).toContain("SET \"platformScope\" = 'support'");
    expect(migration).toContain('"idx_emailDeliveries_scope_due"');
  });

  it("separates support role requests from account credentials", () => {
    const migration = postgresMigrationSql().find((sql) =>
      sql.includes('ADD COLUMN IF NOT EXISTS "requestedRole"'),
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "activationKind"');
    expect(migration).toContain('FROM "umfSupportAccessCredentials"');
    expect(migration).toContain("'director', 'agent'");
    expect(migration).toContain("'staff', 'designated_head'");
  });

  it("creates support mail and opt-in notification storage in maintained migrations", () => {
    const mailMigration = postgresMigrationSql().find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS "umfSupportMailDrafts"'),
    );
    expect(mailMigration).toContain('"content" TEXT NOT NULL');
    expect(mailMigration).toContain('"deliveryIds" TEXT NOT NULL');
    const notificationMigration = postgresMigrationSql().find((sql) =>
      sql.includes(
        'CREATE TABLE IF NOT EXISTS "umfSupportNotificationPreferences"',
      ),
    );
    expect(notificationMigration).toContain(
      'CREATE TABLE IF NOT EXISTS "umfSupportPushSubscriptions"',
    );
    expect(notificationMigration).toContain(
      '"enabled" INTEGER NOT NULL DEFAULT 0',
    );
    expect(notificationMigration).toContain('"subscriptionProtected" TEXT');
  });

  it("keeps legacy activity identifiers out of the resulting schema", () => {
    const activityMigration =
      postgresMigrationSql().find((sql) =>
        sql.includes('RENAME TO "activitySessions"'),
      ) ?? "";

    expect(activityMigration).toContain('ALTER TABLE "gymClasses"');
    expect(activityMigration).toContain('RENAME TO "activitySessions"');
    expect(activityMigration).not.toContain(
      'CREATE OR REPLACE VIEW "gymClasses"',
    );
  });
});

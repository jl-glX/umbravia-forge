import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "../lib/supported-locales.js";

const LOCALE_TABLES = [
  "commercialTrials",
  "administratorSignupProvisioning",
  "umfSupportAccessRequests",
] as const;

const LOCALE_CHECK =
  /CHECK\s*\(\s*"?locale"?\s+IN\s*\(\s*(?:'[^']+'\s*,?\s*)+\)\s*\)/i;

function downgradeLocaleChecks(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");
  database.transaction(() => {
    for (const table of LOCALE_TABLES) {
      const schema = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table) as { sql: string };
      const dependentSql = database
        .prepare(
          `SELECT sql
           FROM sqlite_master
           WHERE tbl_name = ?
             AND type IN ('index', 'trigger')
             AND sql IS NOT NULL
           ORDER BY type, name`,
        )
        .all(table) as Array<{ sql: string }>;
      const columns = database
        .prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<{ name: string }>;
      const columnList = columns.map(({ name }) => `"${name}"`).join(", ");
      const temporaryTable = `${table}_legacy_locale`;
      const legacySchema = schema.sql
        .replace(LOCALE_CHECK, "CHECK(locale IN ('es', 'en', 'de', 'de-CH'))")
        .replace(
          /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/i,
          `CREATE TABLE "${temporaryTable}"`,
        );

      database.exec(`
        ${legacySchema};
        INSERT INTO "${temporaryTable}" (${columnList})
        SELECT ${columnList} FROM "${table}";
        DROP TABLE "${table}";
        ALTER TABLE "${temporaryTable}" RENAME TO "${table}";
      `);
      for (const dependent of dependentSql) database.exec(dependent.sql);
    }
  })();
  database.pragma("foreign_keys = ON");
}

describe("supported locale SQLite migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    migratedDatabase = undefined;
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("rebuilds legacy checks without losing rows, indexes, triggers or relationships", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-supported-locales-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.closeDatabase();

    const databasePath = join(directory, "database.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      INSERT INTO users (id, email, name, password, role, createdAt)
      VALUES ('locale-user', 'locale-user@example.com', 'Locale User', 'hash', 'admin', 1);
      INSERT INTO facilityProfiles (
        id, slug, name, logoDataUrl, accentColor, status, createdAt, updatedAt
      ) VALUES (
        'facility-locale-test', 'locale-test', 'Locale Test', '', '#334155',
        'active', 1, 1
      );
      INSERT INTO commercialTrials (
        id, facilityId, ownerUserId, facilityName, facilityType, locale,
        currency, templateKey, status, subdomain, startedAt, expiresAt,
        createdAt, updatedAt
      ) VALUES (
        'locale-trial', 'facility-locale-test', 'locale-user', 'Locale Test',
        'traditional_gym', 'es', 'EUR', 'standard', 'trial_active',
        'locale-test', 1, 9999999999999, 1, 1
      );
      INSERT INTO commercialTrialEvents (
        id, trialId, actorUserId, type, createdAt
      ) VALUES (
        'locale-event', 'locale-trial', 'locale-user', 'created', 1
      );
      INSERT INTO administratorSignupProvisioning (
        userId, facilityName, facilityType, locale, createdAt
      ) VALUES (
        'locale-user', 'Locale Test', 'traditional_gym', 'es', 1
      );
      INSERT INTO umfSupportAccessRequests (
        id, email, name, lastName, locale, status, createdAt, updatedAt
      ) VALUES (
        'locale-request', 'locale-request@example.com', 'Locale', 'Request',
        'es', 'approved', 1, 1
      );
      INSERT INTO umfSupportAccessCredentials (
        requestId, passwordHash, activationKind, createdAt, expiresAt
      ) VALUES (
        'locale-request', 'hash', 'staff', 1, 9999999999999
      );
    `);

    const dependentDefinitionsBefore = legacy
      .prepare(
        `SELECT type, name
         FROM sqlite_master
         WHERE tbl_name IN (?, ?, ?)
           AND type IN ('index', 'trigger')
           AND sql IS NOT NULL
         ORDER BY type, name`,
      )
      .all(...LOCALE_TABLES);
    downgradeLocaleChecks(legacy);
    expect(() =>
      legacy
        .prepare("UPDATE commercialTrials SET locale = 'fr' WHERE id = ?")
        .run("locale-trial"),
    ).toThrow();
    expect(legacy.pragma("foreign_key_check")).toEqual([]);
    legacy.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();
    await migratedDatabase.initializeDatabase();
    await migratedDatabase.closeDatabase();
    migratedDatabase = undefined;

    const migrated = new Database(databasePath);
    migrated.pragma("foreign_keys = ON");
    for (const locale of SUPPORTED_LOCALES) {
      migrated
        .prepare("UPDATE commercialTrials SET locale = ? WHERE id = ?")
        .run(locale, "locale-trial");
      migrated
        .prepare(
          "UPDATE administratorSignupProvisioning SET locale = ? WHERE userId = ?",
        )
        .run(locale, "locale-user");
      migrated
        .prepare("UPDATE umfSupportAccessRequests SET locale = ? WHERE id = ?")
        .run(locale, "locale-request");
    }

    expect(
      migrated
        .prepare("SELECT trialId, actorUserId FROM commercialTrialEvents")
        .get(),
    ).toEqual({ trialId: "locale-trial", actorUserId: "locale-user" });
    expect(
      migrated
        .prepare("SELECT requestId FROM umfSupportAccessCredentials")
        .get(),
    ).toEqual({ requestId: "locale-request" });
    expect(migrated.pragma("foreign_key_check")).toEqual([]);
    expect(
      migrated
        .prepare(
          `SELECT type, name
           FROM sqlite_master
           WHERE tbl_name IN (?, ?, ?)
             AND type IN ('index', 'trigger')
             AND sql IS NOT NULL
           ORDER BY type, name`,
        )
        .all(...LOCALE_TABLES),
    ).toEqual(dependentDefinitionsBefore);
    migrated.close();
  });
});

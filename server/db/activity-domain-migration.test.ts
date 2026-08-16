import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateLegacyActivityDomainSqlite } from "./activity-domain-migration.js";

describe("activity domain SQLite migration", () => {
  it("renames legacy tables and references without losing data", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE facilityProfiles (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE gymClasses (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL REFERENCES facilityProfiles(id),
        name TEXT NOT NULL
      );
      CREATE TABLE classBookingConfigurations (
        classId TEXT PRIMARY KEY REFERENCES gymClasses(id),
        configuration TEXT NOT NULL
      );
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL REFERENCES gymClasses(id),
        userId TEXT NOT NULL REFERENCES users(id)
      );
      CREATE TABLE waitlistEntries (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL REFERENCES gymClasses(id),
        userId TEXT NOT NULL REFERENCES users(id),
        UNIQUE(classId, userId)
      );
      CREATE TABLE classSessionContents (
        classId TEXT PRIMARY KEY REFERENCES gymClasses(id),
        terminology TEXT NOT NULL
      );
      CREATE TABLE sessionContentProgress (
        classId TEXT NOT NULL REFERENCES gymClasses(id),
        userId TEXT NOT NULL REFERENCES users(id),
        PRIMARY KEY(classId, userId)
      );
      CREATE TABLE bookingAnalyticsEvents (
        id TEXT PRIMARY KEY,
        classId TEXT REFERENCES gymClasses(id)
      );

      INSERT INTO facilityProfiles VALUES ('facility-1');
      INSERT INTO users VALUES ('user-1');
      INSERT INTO gymClasses VALUES ('session-1', 'facility-1', 'Yoga');
      INSERT INTO classBookingConfigurations VALUES ('session-1', '{}');
      INSERT INTO bookings VALUES ('booking-1', 'session-1', 'user-1');
      INSERT INTO waitlistEntries VALUES ('waitlist-1', 'session-1', 'user-1');
      INSERT INTO classSessionContents VALUES ('session-1', 'Práctica');
      INSERT INTO sessionContentProgress VALUES ('session-1', 'user-1');
      INSERT INTO bookingAnalyticsEvents VALUES ('event-1', 'session-1');
    `);

    migrateLegacyActivityDomainSqlite(database);
    migrateLegacyActivityDomainSqlite(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "activitySessions",
        "activitySessionBookingConfigurations",
        "activitySessionContents",
      ]),
    );
    expect(tables.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "gymClasses",
        "classBookingConfigurations",
        "classSessionContents",
      ]),
    );
    expect(
      database
        .prepare("SELECT type FROM sqlite_master WHERE name = 'gymClasses'")
        .get(),
    ).toBeUndefined();

    for (const tableName of [
      "activitySessionBookingConfigurations",
      "bookings",
      "waitlistEntries",
      "activitySessionContents",
      "sessionContentProgress",
      "bookingAnalyticsEvents",
    ]) {
      const columns = database
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>;
      expect(columns.map(({ name }) => name)).toContain("activitySessionId");
      expect(columns.map(({ name }) => name)).not.toContain("classId");
    }

    expect(
      database
        .prepare(
          "SELECT id, facilityId, name FROM activitySessions WHERE id = ?",
        )
        .get("session-1"),
    ).toEqual({
      id: "session-1",
      facilityId: "facility-1",
      name: "Yoga",
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });
});

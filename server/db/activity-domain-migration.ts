import type Database from "better-sqlite3";

export function migrateLegacyActivityDomainSqlite(
  sqliteDatabase: Database.Database,
): void {
  const tableExists = (tableName: string) =>
    Boolean(
      sqliteDatabase
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(tableName),
    );
  const columnExists = (tableName: string, columnName: string) =>
    (
      sqliteDatabase.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>
    ).some((column) => column.name === columnName);

  const migrate = sqliteDatabase.transaction(() => {
    sqliteDatabase.exec(`
      DROP TRIGGER IF EXISTS trg_gymClasses_facility_insert;
      DROP TRIGGER IF EXISTS trg_gymClasses_facility_update;
      DROP INDEX IF EXISTS idx_gymClasses_facility_scheduled;
      DROP INDEX IF EXISTS idx_gymClasses_scheduledAt;
      DROP INDEX IF EXISTS idx_classBookingConfigurations_series;
      DROP INDEX IF EXISTS idx_bookings_classId;
      DROP INDEX IF EXISTS idx_bookings_active_user_class;
      DROP INDEX IF EXISTS idx_waitlistEntries_classId;
      DROP INDEX IF EXISTS idx_waitlistEntries_class_expiry;
      DROP INDEX IF EXISTS idx_bookingAnalyticsEvents_class_event;
    `);

    const tableRenames: Array<[string, string]> = [
      ["gymClasses", "activitySessions"],
      ["classBookingConfigurations", "activitySessionBookingConfigurations"],
      ["classSessionContents", "activitySessionContents"],
    ];
    for (const [legacyName, canonicalName] of tableRenames) {
      if (tableExists(legacyName) && !tableExists(canonicalName)) {
        sqliteDatabase.exec(
          `ALTER TABLE ${legacyName} RENAME TO ${canonicalName}`,
        );
      }
    }

    const columnRenames: Array<[string, string, string]> = [
      ["activitySessionBookingConfigurations", "classId", "activitySessionId"],
      ["bookings", "classId", "activitySessionId"],
      ["waitlistEntries", "classId", "activitySessionId"],
      ["activitySessionContents", "classId", "activitySessionId"],
      ["sessionContentProgress", "classId", "activitySessionId"],
      ["bookingAnalyticsEvents", "classId", "activitySessionId"],
    ];
    for (const [tableName, legacyName, canonicalName] of columnRenames) {
      if (
        tableExists(tableName) &&
        columnExists(tableName, legacyName) &&
        !columnExists(tableName, canonicalName)
      ) {
        sqliteDatabase.exec(
          `ALTER TABLE ${tableName} RENAME COLUMN ${legacyName} TO ${canonicalName}`,
        );
      }
    }
  });

  migrate();
}

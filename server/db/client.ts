import "dotenv/config";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database as DatabaseSchema } from "./types.js";
import { generateSupportId } from "../lib/support-id.js";
import { initializeCommunitySchema } from "./community-schema.js";
import { initializeE2eeSchema } from "./e2ee-schema.js";
import { createPostgresDatabaseRuntime } from "./postgres-client.js";
import { resolveDatabaseProvider } from "./runtime.js";

export const databaseProvider = resolveDatabaseProvider(process.env);
const postgresRuntime =
  databaseProvider === "postgresql"
    ? createPostgresDatabaseRuntime(process.env)
    : null;
const sqliteDb = databaseProvider === "sqlite" ? createSqliteDatabase() : null;

function createSqliteDatabase(): Database.Database {
  const dataDirectory =
    process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
  const databasePath = path.join(dataDirectory, "database.sqlite");
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}

function requireSqliteDatabase(): Database.Database {
  if (!sqliteDb) {
    throw new Error("The active database provider is not SQLite");
  }
  return sqliteDb;
}

export const db: Kysely<DatabaseSchema> =
  postgresRuntime?.db ??
  new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: requireSqliteDatabase() }),
    log:
      process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

export async function checkDatabaseConnection(): Promise<void> {
  if (postgresRuntime) {
    await postgresRuntime.check();
    return;
  }
  await db.selectFrom("facilityProfiles").select("id").limit(1).execute();
}

function reconcileDuplicateBookings(): number {
  return requireSqliteDatabase()
    .prepare(
      `WITH ranked AS (
         SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY classId, userId
             ORDER BY
               CASE status WHEN 'confirmed' THEN 0 ELSE 1 END,
               createdAt ASC,
               id ASC
           ) AS activeRank
         FROM bookings
         WHERE status IN ('confirmed', 'waitlist')
       )
       UPDATE bookings
       SET status = 'cancelled',
           cancelledAt = COALESCE(cancelledAt, ?)
       WHERE id IN (SELECT id FROM ranked WHERE activeRank > 1)`,
    )
    .run(Date.now()).changes;
}

function removeStaleWaitlistEntries(): number {
  return requireSqliteDatabase()
    .prepare(
      `DELETE FROM waitlistEntries
       WHERE promotedAt IS NULL
         AND EXISTS (
           SELECT 1 FROM bookings
           WHERE bookings.classId = waitlistEntries.classId
             AND bookings.userId = waitlistEntries.userId
             AND bookings.status = 'confirmed'
         )`,
    )
    .run().changes;
}

export async function reconcileBookingIntegrity(): Promise<{
  duplicateBookings: number;
  staleWaitlistEntries: number;
}> {
  if (postgresRuntime) {
    return postgresRuntime.reconcileBookingIntegrity();
  }
  return {
    duplicateBookings: reconcileDuplicateBookings(),
    staleWaitlistEntries: removeStaleWaitlistEntries(),
  };
}

export async function initializeDatabase() {
  console.log("Initializing database...");

  if (postgresRuntime) {
    await postgresRuntime.initialize();
    console.log("PostgreSQL database initialized successfully");
    return;
  }

  await initializeSqliteSchema(requireSqliteDatabase());
}

export async function createSqliteEnvironmentDatabase(
  databasePath: string,
): Promise<void> {
  const parentDirectory = path.dirname(databasePath);
  if (!fs.existsSync(parentDirectory)) {
    fs.mkdirSync(parentDirectory, { recursive: true });
  }
  if (fs.existsSync(databasePath)) {
    throw new Error("The SQLite environment database already exists");
  }

  const environmentDatabase = new Database(databasePath);
  environmentDatabase.pragma("foreign_keys = ON");
  environmentDatabase.pragma("journal_mode = WAL");
  environmentDatabase.pragma("busy_timeout = 5000");
  try {
    await initializeSqliteSchema(environmentDatabase);
  } finally {
    environmentDatabase.close();
  }
}

async function initializeSqliteSchema(
  sqliteDb: Database.Database,
): Promise<void> {
  const tables = sqliteDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;

  const tableNames = tables.map((t) => t.name);

  if (!tableNames.includes("users")) {
    console.log("Creating users table...");
    sqliteDb.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        phone TEXT UNIQUE,
        name TEXT NOT NULL,
        lastName TEXT NOT NULL DEFAULT '',
        countryCode TEXT NOT NULL DEFAULT 'ES',
        locale TEXT NOT NULL DEFAULT 'es',
        accountStatus TEXT NOT NULL DEFAULT 'active' CHECK(accountStatus IN ('pending_verification', 'active', 'security_review')),
        emailVerifiedAt INTEGER,
        termsVersion TEXT NOT NULL DEFAULT 'draft-v1',
        termsAcceptedAt INTEGER,
        privacyVersion TEXT NOT NULL DEFAULT 'draft-v1',
        privacyAcceptedAt INTEGER,
        avatarDataUrl TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member',
        sessionIdleTimeoutMinutes INTEGER NOT NULL DEFAULT 10080,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX idx_users_email ON users(email);
      CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
      CREATE INDEX idx_users_role ON users(role);
    `);
  } else {
    // Check if password and role columns exist, add them if they don't
    const userColumns = sqliteDb
      .prepare("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;

    const columnNames = userColumns.map((c) => c.name);

    if (!columnNames.includes("password")) {
      console.log("Adding password column to users table...");
      sqliteDb.exec(
        "ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''",
      );
    }

    if (!columnNames.includes("role")) {
      console.log("Adding role column to users table...");
      sqliteDb.exec(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
      );

      // Create index if it doesn't exist
      const indexes = sqliteDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'",
        )
        .all() as Array<{ name: string }>;

      if (!indexes.some((idx) => idx.name === "idx_users_role")) {
        sqliteDb.exec("CREATE INDEX idx_users_role ON users(role)");
      }
    }

    if (!columnNames.includes("phone")) {
      console.log("Adding phone column to users table...");
      sqliteDb.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    }

    if (!columnNames.includes("avatarDataUrl")) {
      console.log("Adding avatar column to users table...");
      sqliteDb.exec(
        "ALTER TABLE users ADD COLUMN avatarDataUrl TEXT NOT NULL DEFAULT ''",
      );
    }

    if (!columnNames.includes("sessionIdleTimeoutMinutes")) {
      console.log("Adding session inactivity preference to users table...");
      sqliteDb.exec(
        "ALTER TABLE users ADD COLUMN sessionIdleTimeoutMinutes INTEGER NOT NULL DEFAULT 10080",
      );
    }

    const accountIdentityColumns: Array<[string, string]> = [
      ["lastName", "TEXT NOT NULL DEFAULT ''"],
      ["countryCode", "TEXT NOT NULL DEFAULT 'ES'"],
      ["locale", "TEXT NOT NULL DEFAULT 'es'"],
      ["accountStatus", "TEXT NOT NULL DEFAULT 'active'"],
      ["emailVerifiedAt", "INTEGER"],
      ["termsVersion", "TEXT NOT NULL DEFAULT 'draft-v1'"],
      ["termsAcceptedAt", "INTEGER"],
      ["privacyVersion", "TEXT NOT NULL DEFAULT 'draft-v1'"],
      ["privacyAcceptedAt", "INTEGER"],
    ];
    for (const [column, definition] of accountIdentityColumns) {
      if (!columnNames.includes(column)) {
        sqliteDb.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
      }
    }

    const indexes = sqliteDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'",
      )
      .all() as Array<{ name: string }>;
    if (!indexes.some((idx) => idx.name === "idx_users_phone")) {
      sqliteDb.exec(
        "CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL",
      );
    }
  }

  if (!tableNames.includes("accountSupportIdentifiers")) {
    console.log("Creating account support identifiers table...");
    sqliteDb.exec(`
      CREATE TABLE accountSupportIdentifiers (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        publicId TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
        rotationReason TEXT CHECK(rotationReason IS NULL OR rotationReason IN ('account_recovery', 'security_incident', 'administrative_correction')),
        createdAt INTEGER NOT NULL,
        revokedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_supportIdentifiers_active_user
        ON accountSupportIdentifiers(userId)
        WHERE status = 'active';
      CREATE INDEX idx_supportIdentifiers_publicId
        ON accountSupportIdentifiers(publicId);
      CREATE INDEX idx_supportIdentifiers_userId
        ON accountSupportIdentifiers(userId);
    `);
  }

  if (!tableNames.includes("emailVerificationChallenges")) {
    console.log("Creating email verification challenges table...");
    sqliteDb.exec(`
      CREATE TABLE emailVerificationChallenges (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        codeHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_emailVerificationChallenges_userId
        ON emailVerificationChallenges(userId);
      CREATE INDEX idx_emailVerificationChallenges_expiresAt
        ON emailVerificationChallenges(expiresAt);
    `);
  } else {
    const emailChallengeColumns = sqliteDb
      .prepare("PRAGMA table_info(emailVerificationChallenges)")
      .all() as Array<{ name: string }>;
    if (!emailChallengeColumns.some((column) => column.name === "codeHash")) {
      sqliteDb.exec(
        "ALTER TABLE emailVerificationChallenges ADD COLUMN codeHash TEXT NOT NULL DEFAULT ''",
      );
    }
  }

  if (!tableNames.includes("accountRecoveryChallenges")) {
    console.log("Creating account recovery challenges table...");
    sqliteDb.exec(`
      CREATE TABLE accountRecoveryChallenges (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        codeHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_accountRecoveryChallenges_userId
        ON accountRecoveryChallenges(userId);
      CREATE INDEX idx_accountRecoveryChallenges_expiresAt
        ON accountRecoveryChallenges(expiresAt);
    `);
  } else {
    sqliteDb.exec(`
      DELETE FROM accountRecoveryChallenges
       WHERE id IN (
         SELECT id
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY userId
                      ORDER BY createdAt DESC, id DESC
                    ) AS duplicatePosition
               FROM accountRecoveryChallenges
           ) ranked
          WHERE duplicatePosition > 1
       );
      DROP INDEX IF EXISTS idx_accountRecoveryChallenges_userId;
      CREATE UNIQUE INDEX idx_accountRecoveryChallenges_userId
        ON accountRecoveryChallenges(userId);
    `);
  }

  if (!tableNames.includes("emailDeliveries")) {
    console.log("Creating transactional email deliveries table...");
    sqliteDb.exec(`
      CREATE TABLE emailDeliveries (
        id TEXT PRIMARY KEY,
        userId TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('email_verification', 'account_recovery', 'support_update', 'security_notice')),
        recipient TEXT NOT NULL,
        locale TEXT NOT NULL,
        payloadEncrypted TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'retry', 'sent', 'failed', 'superseded')),
        attempts INTEGER NOT NULL DEFAULT 0,
        maxAttempts INTEGER NOT NULL DEFAULT 5,
        nextAttemptAt INTEGER NOT NULL,
        messageId TEXT,
        lastError TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        sentAt INTEGER,
        expiresAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_emailDeliveries_due
        ON emailDeliveries(status, nextAttemptAt);
      CREATE INDEX idx_emailDeliveries_user
        ON emailDeliveries(userId, createdAt);
      CREATE INDEX idx_emailDeliveries_expiry
        ON emailDeliveries(expiresAt);
    `);
  } else {
    const deliveryDefinition = sqliteDb
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'emailDeliveries'",
      )
      .get() as { sql?: string } | undefined;
    if (!deliveryDefinition?.sql?.includes("account_recovery")) {
      console.log("Expanding transactional email delivery types...");
      sqliteDb.exec(`
        ALTER TABLE emailDeliveries RENAME TO emailDeliveriesLegacy;
        CREATE TABLE emailDeliveries (
          id TEXT PRIMARY KEY,
          userId TEXT,
          kind TEXT NOT NULL CHECK(kind IN ('email_verification', 'account_recovery', 'support_update', 'security_notice')),
          recipient TEXT NOT NULL,
          locale TEXT NOT NULL,
          payloadEncrypted TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'retry', 'sent', 'failed', 'superseded')),
          attempts INTEGER NOT NULL DEFAULT 0,
          maxAttempts INTEGER NOT NULL DEFAULT 5,
          nextAttemptAt INTEGER NOT NULL,
          messageId TEXT,
          lastError TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          sentAt INTEGER,
          expiresAt INTEGER NOT NULL,
          FOREIGN KEY(userId) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO emailDeliveries
          SELECT * FROM emailDeliveriesLegacy;
        DROP TABLE emailDeliveriesLegacy;
        CREATE INDEX idx_emailDeliveries_due
          ON emailDeliveries(status, nextAttemptAt);
        CREATE INDEX idx_emailDeliveries_user
          ON emailDeliveries(userId, createdAt);
        CREATE INDEX idx_emailDeliveries_expiry
          ON emailDeliveries(expiresAt);
      `);
    }
  }

  if (!tableNames.includes("antiAutomationChallenges")) {
    console.log("Creating first-party anti-automation challenges table...");
    sqliteDb.exec(`
      CREATE TABLE antiAutomationChallenges (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL CHECK(action IN ('login', 'signup', 'recovery', 'form_access', 'feedback')),
        nonce TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        consumedAt INTEGER
      );
      CREATE INDEX idx_antiAutomationChallenges_expiry
        ON antiAutomationChallenges(expiresAt);
    `);
  } else {
    const antiAutomationDefinition = sqliteDb
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'antiAutomationChallenges'",
      )
      .get() as { sql?: string } | undefined;
    if (!antiAutomationDefinition?.sql?.includes("'recovery'")) {
      console.log("Expanding anti-automation challenge actions...");
      sqliteDb.exec(`
        ALTER TABLE antiAutomationChallenges RENAME TO antiAutomationChallengesLegacy;
        CREATE TABLE antiAutomationChallenges (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL CHECK(action IN ('login', 'signup', 'recovery', 'form_access', 'feedback')),
          nonce TEXT NOT NULL,
          difficulty INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          expiresAt INTEGER NOT NULL,
          consumedAt INTEGER
        );
        INSERT INTO antiAutomationChallenges
          SELECT * FROM antiAutomationChallengesLegacy;
        DROP TABLE antiAutomationChallengesLegacy;
        CREATE INDEX idx_antiAutomationChallenges_expiry
          ON antiAutomationChallenges(expiresAt);
      `);
    }
  }

  const usersWithoutSupportId = sqliteDb
    .prepare(
      `SELECT users.id
       FROM users
       LEFT JOIN accountSupportIdentifiers identifiers
         ON identifiers.userId = users.id AND identifiers.status = 'active'
       WHERE identifiers.id IS NULL`,
    )
    .all() as Array<{ id: string }>;
  const insertSupportId = sqliteDb.prepare(
    `INSERT INTO accountSupportIdentifiers
     (id, userId, publicId, status, rotationReason, createdAt, revokedAt)
     VALUES (?, ?, ?, 'active', NULL, ?, NULL)`,
  );

  for (const user of usersWithoutSupportId) {
    let inserted = false;
    while (!inserted) {
      const publicId = generateSupportId();
      try {
        insertSupportId.run(
          `support-${randomUUID()}`,
          user.id,
          publicId,
          Date.now(),
        );
        inserted = true;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("UNIQUE constraint failed")
        ) {
          throw error;
        }
      }
    }
  }

  if (!tableNames.includes("accountDeletionPreferences")) {
    console.log("Creating account deletion preferences table...");
    sqliteDb.exec(`
      CREATE TABLE accountDeletionPreferences (
        userId TEXT PRIMARY KEY,
        inactivityMonths INTEGER CHECK(inactivityMonths IS NULL OR inactivityMonths IN (6, 12, 18, 24, 36)),
        lastMeaningfulActivityAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  if (!tableNames.includes("accountDeletionRequests")) {
    console.log("Creating account deletion requests table...");
    sqliteDb.exec(`
      CREATE TABLE accountDeletionRequests (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK(trigger IN ('manual', 'inactivity')),
        status TEXT NOT NULL CHECK(status IN ('scheduled', 'cancelled', 'processing', 'completed')),
        requestedAt INTEGER NOT NULL,
        graceEndsAt INTEGER NOT NULL,
        cancelledAt INTEGER,
        completedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_deletionRequests_userId ON accountDeletionRequests(userId);
      CREATE INDEX idx_deletionRequests_status_grace
        ON accountDeletionRequests(status, graceEndsAt);
      CREATE UNIQUE INDEX idx_deletionRequests_scheduled_user
        ON accountDeletionRequests(userId)
        WHERE status = 'scheduled';
    `);
  }

  if (!tableNames.includes("accountDataDeletionDrafts")) {
    console.log("Creating account data deletion drafts table...");
    sqliteDb.exec(`
      CREATE TABLE accountDataDeletionDrafts (
        userId TEXT PRIMARY KEY,
        selectedCategories TEXT NOT NULL DEFAULT '[]',
        intent TEXT NOT NULL CHECK(intent IN ('selected_data', 'account_closure')),
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  if (!tableNames.includes("accountDeletionJobs")) {
    console.log("Creating account deletion jobs table...");
    sqliteDb.exec(`
      CREATE TABLE accountDeletionJobs (
        id TEXT PRIMARY KEY,
        requestId TEXT NOT NULL UNIQUE,
        userId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'blocked_retention_review', 'cancelled', 'completed')),
        executionEnabled INTEGER NOT NULL DEFAULT 0 CHECK(executionEnabled IN (0, 1)),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        completedAt INTEGER,
        FOREIGN KEY(requestId) REFERENCES accountDeletionRequests(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_accountDeletionJobs_user_status
        ON accountDeletionJobs(userId, status);
    `);
  }

  if (!tableNames.includes("accountRepresentatives")) {
    console.log("Creating account representatives table...");
    sqliteDb.exec(`
      CREATE TABLE accountRepresentatives (
        id TEXT PRIMARY KEY,
        ownerUserId TEXT NOT NULL,
        representativeUserId TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL CHECK(reason IN ('hospitalization', 'temporary_incapacity', 'permanent_incapacity', 'death_contingency', 'other')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending_review', 'approved', 'revoked', 'expired')),
        startsAt INTEGER NOT NULL,
        expiresAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        revokedAt INTEGER,
        FOREIGN KEY(ownerUserId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(representativeUserId) REFERENCES users(id) ON DELETE CASCADE,
        CHECK(ownerUserId <> representativeUserId)
      );
      CREATE INDEX idx_accountRepresentatives_owner
        ON accountRepresentatives(ownerUserId, status);
      CREATE INDEX idx_accountRepresentatives_representative
        ON accountRepresentatives(representativeUserId, status);
      CREATE UNIQUE INDEX idx_accountRepresentatives_open_pair
        ON accountRepresentatives(ownerUserId, representativeUserId)
        WHERE status IN ('draft', 'pending_review', 'approved');
    `);
  }

  if (!tableNames.includes("dataRetentionPolicies")) {
    console.log("Creating data retention policies table...");
    sqliteDb.exec(`
      CREATE TABLE dataRetentionPolicies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        dataCategory TEXT NOT NULL,
        retentionDays INTEGER CHECK(retentionDays IS NULL OR retentionDays > 0),
        legalBasisReference TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'retired')),
        version INTEGER NOT NULL DEFAULT 1,
        reviewedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX idx_retentionPolicies_status
        ON dataRetentionPolicies(status);
      CREATE INDEX idx_retentionPolicies_jurisdiction
        ON dataRetentionPolicies(jurisdiction);
    `);
  }

  if (!tableNames.includes("dataRetentionRecords")) {
    console.log("Creating data retention records table...");
    sqliteDb.exec(`
      CREATE TABLE dataRetentionRecords (
        id TEXT PRIMARY KEY,
        userId TEXT,
        policyId TEXT NOT NULL,
        sourceType TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'retained' CHECK(status IN ('retained', 'legal_hold', 'scheduled_deletion', 'released')),
        retainUntil INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        releasedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(policyId) REFERENCES dataRetentionPolicies(id)
      );
      CREATE UNIQUE INDEX idx_retentionRecords_source
        ON dataRetentionRecords(sourceType, sourceId);
      CREATE INDEX idx_retentionRecords_status_until
        ON dataRetentionRecords(status, retainUntil);
      CREATE INDEX idx_retentionRecords_userId
        ON dataRetentionRecords(userId);
    `);
  }

  if (!tableNames.includes("gymClasses")) {
    console.log("Creating gymClasses table...");
    sqliteDb.exec(`
      CREATE TABLE gymClasses (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL DEFAULT 'primary',
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        trainerId TEXT NOT NULL,
        trainerName TEXT NOT NULL,
        maxCapacity INTEGER NOT NULL,
        scheduledAt INTEGER NOT NULL
      );
      CREATE INDEX idx_gymClasses_facility_scheduled
        ON gymClasses(facilityId, scheduledAt);
      CREATE INDEX idx_gymClasses_scheduledAt ON gymClasses(scheduledAt);
    `);
  } else {
    const classColumns = requireSqliteDatabase()
      .prepare("PRAGMA table_info(gymClasses)")
      .all() as Array<{ name: string }>;
    if (!classColumns.some((column) => column.name === "facilityId")) {
      sqliteDb.exec(
        "ALTER TABLE gymClasses ADD COLUMN facilityId TEXT NOT NULL DEFAULT 'primary'",
      );
    }
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_gymClasses_facility_scheduled
        ON gymClasses(facilityId, scheduledAt);
    `);
  }

  if (!tableNames.includes("classBookingConfigurations")) {
    sqliteDb.exec(`
      CREATE TABLE classBookingConfigurations (
        classId TEXT PRIMARY KEY,
        configuration TEXT NOT NULL DEFAULT '{}',
        lifecycleState TEXT NOT NULL DEFAULT 'active' CHECK(lifecycleState IN ('active', 'suspended', 'cancelled')),
        seriesId TEXT,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(classId) REFERENCES gymClasses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_classBookingConfigurations_series
        ON classBookingConfigurations(seriesId);
    `);
  }

  if (!tableNames.includes("bookings")) {
    console.log("Creating bookings table...");
    sqliteDb.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled', 'waitlist')),
        createdAt INTEGER NOT NULL,
        cancelledAt INTEGER,
        FOREIGN KEY(classId) REFERENCES gymClasses(id),
        FOREIGN KEY(userId) REFERENCES users(id)
      );
      CREATE INDEX idx_bookings_classId ON bookings(classId);
      CREATE INDEX idx_bookings_userId ON bookings(userId);
      CREATE INDEX idx_bookings_status ON bookings(status);
      CREATE UNIQUE INDEX idx_bookings_active_user_class
        ON bookings(classId, userId)
        WHERE status IN ('confirmed', 'waitlist');
    `);
  } else {
    const duplicateBookings = reconcileDuplicateBookings();
    if (duplicateBookings > 0) {
      console.warn(
        `Reconciled ${duplicateBookings} duplicate active booking(s).`,
      );
    }
    sqliteDb.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_user_class
        ON bookings(classId, userId)
        WHERE status IN ('confirmed', 'waitlist');
    `);
  }

  if (!tableNames.includes("bookingLifecycles")) {
    sqliteDb.exec(`
      CREATE TABLE bookingLifecycles (
        bookingId TEXT PRIMARY KEY,
        lifecycleStatus TEXT NOT NULL,
        attendanceIntention TEXT NOT NULL DEFAULT 'unanswered',
        intentionUpdatedAt INTEGER,
        confirmedAt INTEGER,
        lastReminderAt INTEGER,
        reminderCount INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(bookingId) REFERENCES bookings(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_bookingLifecycles_status
        ON bookingLifecycles(lifecycleStatus, attendanceIntention);
    `);
  } else {
    const lifecycleColumns = sqliteDb
      .prepare("PRAGMA table_info(bookingLifecycles)")
      .all() as Array<{ name: string }>;
    const lifecycleColumnNames = lifecycleColumns.map((column) => column.name);
    if (!lifecycleColumnNames.includes("lastReminderAt")) {
      sqliteDb.exec(
        "ALTER TABLE bookingLifecycles ADD COLUMN lastReminderAt INTEGER",
      );
    }
    if (!lifecycleColumnNames.includes("reminderCount")) {
      sqliteDb.exec(
        "ALTER TABLE bookingLifecycles ADD COLUMN reminderCount INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  sqliteDb.exec(`
    INSERT OR IGNORE INTO bookingLifecycles (
      bookingId,
      lifecycleStatus,
      attendanceIntention,
      intentionUpdatedAt,
      confirmedAt,
      lastReminderAt,
      reminderCount,
      updatedAt
    )
    SELECT
      id,
      CASE
        WHEN status = 'waitlist' THEN 'waitlisted'
        WHEN status = 'cancelled' THEN 'cancelled_on_time'
        ELSE 'confirmation_pending'
      END,
      'unanswered',
      NULL,
      NULL,
      NULL,
      0,
      createdAt
    FROM bookings;
  `);

  if (!tableNames.includes("waitlistEntries")) {
    console.log("Creating waitlistEntries table...");
    sqliteDb.exec(`
      CREATE TABLE waitlistEntries (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL,
        userId TEXT NOT NULL,
        position INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        promotedAt INTEGER,
        promotionExpiresAt INTEGER,
        FOREIGN KEY(classId) REFERENCES gymClasses(id),
        FOREIGN KEY(userId) REFERENCES users(id),
        UNIQUE(classId, userId)
      );
      CREATE INDEX idx_waitlistEntries_classId ON waitlistEntries(classId);
      CREATE INDEX idx_waitlistEntries_userId ON waitlistEntries(userId);
    `);
  } else {
    const waitlistColumns = sqliteDb
      .prepare("PRAGMA table_info(waitlistEntries)")
      .all() as Array<{ name: string }>;
    if (
      !waitlistColumns.some((column) => column.name === "promotionExpiresAt")
    ) {
      sqliteDb.exec(
        "ALTER TABLE waitlistEntries ADD COLUMN promotionExpiresAt INTEGER",
      );
    }
  }

  if (!tableNames.includes("bookingReputations")) {
    sqliteDb.exec(`
      CREATE TABLE bookingReputations (
        facilityId TEXT NOT NULL DEFAULT 'primary',
        userId TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 100 CHECK(score BETWEEN 0 AND 100),
        penaltyUntil INTEGER,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY(facilityId, userId),
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_bookingReputations_penalty
        ON bookingReputations(penaltyUntil);
    `);
  }

  if (!tableNames.includes("bookingReputationEvents")) {
    sqliteDb.exec(`
      CREATE TABLE bookingReputationEvents (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL DEFAULT 'primary',
        userId TEXT NOT NULL,
        bookingId TEXT,
        type TEXT NOT NULL,
        pointsDelta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(bookingId) REFERENCES bookings(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_bookingReputationEvents_user
        ON bookingReputationEvents(userId, createdAt DESC);
    `);
  }

  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookingReputationEvents_booking_type
      ON bookingReputationEvents(bookingId, type);
    CREATE INDEX IF NOT EXISTS idx_waitlistEntries_class_expiry
      ON waitlistEntries(classId, promotionExpiresAt);
  `);

  if (!tableNames.includes("classSessionContents")) {
    sqliteDb.exec(`
      CREATE TABLE classSessionContents (
        classId TEXT PRIMARY KEY,
        terminology TEXT NOT NULL DEFAULT 'Contenido de la sesión',
        blocks TEXT NOT NULL DEFAULT '[]',
        commentsEnabled INTEGER NOT NULL DEFAULT 0 CHECK(commentsEnabled IN (0, 1)),
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(classId) REFERENCES gymClasses(id) ON DELETE CASCADE
      );
    `);
  }

  if (!tableNames.includes("sessionContentProgress")) {
    sqliteDb.exec(`
      CREATE TABLE sessionContentProgress (
        classId TEXT NOT NULL,
        userId TEXT NOT NULL,
        completedBlockIds TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY(classId, userId),
        FOREIGN KEY(classId) REFERENCES gymClasses(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_sessionContentProgress_user
        ON sessionContentProgress(userId, updatedAt DESC);
    `);
  }

  const staleWaitlistEntries = removeStaleWaitlistEntries();
  if (staleWaitlistEntries > 0) {
    console.warn(
      `Removed ${staleWaitlistEntries} stale waitlist entr${
        staleWaitlistEntries === 1 ? "y" : "ies"
      } after reconciling active bookings.`,
    );
  }

  if (!tableNames.includes("sessions")) {
    console.log("Creating sessions table...");
    sqliteDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastSeenAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        revokedAt INTEGER,
        userAgent TEXT NOT NULL DEFAULT '',
        remembered INTEGER NOT NULL DEFAULT 0,
        formVerifiedAt INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_sessions_userId ON sessions(userId);
      CREATE INDEX idx_sessions_expiresAt ON sessions(expiresAt);
    `);
  } else {
    const sessionColumns = sqliteDb
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const sessionColumnNames = sessionColumns.map((column) => column.name);

    if (!sessionColumnNames.includes("lastSeenAt")) {
      sqliteDb.exec(
        "ALTER TABLE sessions ADD COLUMN lastSeenAt INTEGER NOT NULL DEFAULT 0",
      );
      sqliteDb.exec(
        "UPDATE sessions SET lastSeenAt = createdAt WHERE lastSeenAt = 0",
      );
    }

    if (!sessionColumnNames.includes("userAgent")) {
      sqliteDb.exec(
        "ALTER TABLE sessions ADD COLUMN userAgent TEXT NOT NULL DEFAULT ''",
      );
    }

    if (!sessionColumnNames.includes("remembered")) {
      sqliteDb.exec(
        "ALTER TABLE sessions ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0",
      );
    }

    if (!sessionColumnNames.includes("formVerifiedAt")) {
      sqliteDb.exec(
        "ALTER TABLE sessions ADD COLUMN formVerifiedAt INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  if (!tableNames.includes("mfaCredentials")) {
    sqliteDb.exec(`
      CREATE TABLE mfaCredentials (
        userId TEXT PRIMARY KEY,
        secretEncrypted TEXT NOT NULL,
        recoveryCodeHashes TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        enabledAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  if (!tableNames.includes("authChallenges")) {
    sqliteDb.exec(`
      CREATE TABLE authChallenges (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumedAt INTEGER,
        rememberDevice INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_authChallenges_userId ON authChallenges(userId);
      CREATE INDEX idx_authChallenges_expiresAt ON authChallenges(expiresAt);
    `);
  } else {
    const challengeColumns = sqliteDb
      .prepare("PRAGMA table_info(authChallenges)")
      .all() as Array<{ name: string }>;
    if (!challengeColumns.some((column) => column.name === "rememberDevice")) {
      sqliteDb.exec(
        "ALTER TABLE authChallenges ADD COLUMN rememberDevice INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  if (!tableNames.includes("securityEvents")) {
    sqliteDb.exec(`
      CREATE TABLE securityEvents (
        id TEXT PRIMARY KEY,
        userId TEXT,
        type TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_securityEvents_userId ON securityEvents(userId);
      CREATE INDEX idx_securityEvents_createdAt ON securityEvents(createdAt);
    `);
  }

  if (!tableNames.includes("passkeyCredentials")) {
    sqliteDb.exec(`
      CREATE TABLE passkeyCredentials (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        publicKey TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT NOT NULL DEFAULT '[]',
        deviceType TEXT NOT NULL,
        backedUp INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_passkeyCredentials_userId ON passkeyCredentials(userId);
    `);
  }

  if (!tableNames.includes("webauthnChallenges")) {
    sqliteDb.exec(`
      CREATE TABLE webauthnChallenges (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        challenge TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('registration', 'authentication')),
        rememberDevice INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        consumedAt INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_webauthnChallenges_userId ON webauthnChallenges(userId);
      CREATE INDEX idx_webauthnChallenges_expiresAt ON webauthnChallenges(expiresAt);
    `);
  }

  if (!tableNames.includes("feedback")) {
    sqliteDb.exec(`
      CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        userId TEXT,
        category TEXT NOT NULL CHECK(category IN ('suggestion', 'problem', 'accessibility', 'other')),
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'closed')),
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_feedback_userId ON feedback(userId);
      CREATE INDEX idx_feedback_createdAt ON feedback(createdAt);
    `);
  }

  if (!tableNames.includes("supportTickets")) {
    console.log("Creating Forge Support tables...");
    sqliteDb.exec(`
      CREATE TABLE supportTickets (
        id TEXT PRIMARY KEY,
        publicId TEXT NOT NULL UNIQUE,
        facilityId TEXT NOT NULL DEFAULT 'primary',
        requesterUserId TEXT NOT NULL,
        assigneeUserId TEXT,
        subject TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('account', 'billing', 'reservations', 'technical', 'safety', 'general')),
        priority TEXT NOT NULL CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
        status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
        source TEXT NOT NULL CHECK(source IN ('web', 'api', 'system')),
        relatedType TEXT,
        relatedId TEXT,
        context TEXT NOT NULL DEFAULT '{}',
        firstResponseDueAt INTEGER NOT NULL,
        resolutionDueAt INTEGER NOT NULL,
        firstRespondedAt INTEGER,
        resolvedAt INTEGER,
        closedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(requesterUserId) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY(assigneeUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_supportTickets_requester ON supportTickets(requesterUserId, updatedAt DESC);
      CREATE INDEX idx_supportTickets_queue ON supportTickets(facilityId, status, priority, updatedAt DESC);
      CREATE INDEX idx_supportTickets_assignee ON supportTickets(assigneeUserId, status, updatedAt DESC);

      CREATE TABLE supportAgents (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL DEFAULT 'primary',
        userId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('agent', 'manager')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(facilityId, userId)
      );
      CREATE INDEX idx_supportAgents_active ON supportAgents(facilityId, active, role);

      CREATE TABLE supportMessages (
        id TEXT PRIMARY KEY,
        ticketId TEXT NOT NULL,
        authorUserId TEXT,
        visibility TEXT NOT NULL CHECK(visibility IN ('requester', 'internal')),
        body TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(ticketId) REFERENCES supportTickets(id) ON DELETE CASCADE,
        FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_supportMessages_ticket ON supportMessages(ticketId, createdAt);

      CREATE TABLE supportAttachments (
        id TEXT PRIMARY KEY,
        ticketId TEXT NOT NULL,
        messageId TEXT,
        uploadedByUserId TEXT NOT NULL,
        fileName TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL,
        storageKey TEXT NOT NULL UNIQUE,
        checksumSha256 TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(ticketId) REFERENCES supportTickets(id) ON DELETE CASCADE,
        FOREIGN KEY(messageId) REFERENCES supportMessages(id) ON DELETE SET NULL,
        FOREIGN KEY(uploadedByUserId) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_supportAttachments_ticket ON supportAttachments(ticketId, createdAt);

      CREATE TABLE supportEvents (
        id TEXT PRIMARY KEY,
        ticketId TEXT NOT NULL,
        actorUserId TEXT,
        type TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(ticketId) REFERENCES supportTickets(id) ON DELETE CASCADE,
        FOREIGN KEY(actorUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_supportEvents_ticket ON supportEvents(ticketId, createdAt);

      CREATE TABLE supportKnowledgeArticles (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
        authorUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        publishedAt INTEGER,
        FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_supportKnowledge_status ON supportKnowledgeArticles(status, category, updatedAt DESC);
    `);
  }

  if (!tableNames.includes("billingRecords")) {
    sqliteDb.exec(`
      CREATE TABLE billingRecords (
        id TEXT PRIMARY KEY,
        userId TEXT,
        customerName TEXT NOT NULL,
        customerEmail TEXT NOT NULL DEFAULT '',
        concept TEXT NOT NULL,
        billingCycle TEXT NOT NULL CHECK(billingCycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'trial_day', 'custom')),
        customCycleLabel TEXT NOT NULL DEFAULT '',
        amountCents INTEGER NOT NULL CHECK(amountCents >= 0),
        currency TEXT NOT NULL DEFAULT 'EUR',
        status TEXT NOT NULL CHECK(status IN ('paid', 'unpaid', 'pending')),
        dueAt INTEGER,
        paidAt INTEGER,
        invoiceNumber TEXT,
        notes TEXT NOT NULL DEFAULT '',
        archivedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_billingRecords_userId ON billingRecords(userId);
      CREATE INDEX idx_billingRecords_status ON billingRecords(status);
      CREATE INDEX idx_billingRecords_dueAt ON billingRecords(dueAt);
      CREATE INDEX idx_billingRecords_archivedAt ON billingRecords(archivedAt);
    `);
  } else {
    const billingColumns = sqliteDb
      .prepare("PRAGMA table_info(billingRecords)")
      .all() as Array<{ name: string }>;
    const billingColumnNames = billingColumns.map((column) => column.name);

    if (!billingColumnNames.includes("customCycleLabel")) {
      sqliteDb.exec(
        "ALTER TABLE billingRecords ADD COLUMN customCycleLabel TEXT NOT NULL DEFAULT ''",
      );
    }

    if (!billingColumnNames.includes("archivedAt")) {
      sqliteDb.exec("ALTER TABLE billingRecords ADD COLUMN archivedAt INTEGER");
    }

    sqliteDb.exec(
      "CREATE INDEX IF NOT EXISTS idx_billingRecords_archivedAt ON billingRecords(archivedAt)",
    );
  }

  if (!tableNames.includes("facilityProfiles")) {
    console.log("Creating facilityProfiles table...");
    sqliteDb.exec(`
      CREATE TABLE facilityProfiles (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        logoDataUrl TEXT NOT NULL DEFAULT '',
        accentColor TEXT NOT NULL DEFAULT '#2563eb',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'closed')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
  } else {
    const facilityColumns = sqliteDb
      .prepare("PRAGMA table_info(facilityProfiles)")
      .all() as Array<{ name: string }>;
    const facilityColumnNames = facilityColumns.map((column) => column.name);
    if (!facilityColumnNames.includes("slug")) {
      sqliteDb.exec(
        "ALTER TABLE facilityProfiles ADD COLUMN slug TEXT NOT NULL DEFAULT ''",
      );
      sqliteDb.exec("UPDATE facilityProfiles SET slug = id WHERE slug = ''");
    }
    if (!facilityColumnNames.includes("status")) {
      sqliteDb.exec(
        "ALTER TABLE facilityProfiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'closed'))",
      );
    }
    if (!facilityColumnNames.includes("createdAt")) {
      sqliteDb.exec(
        "ALTER TABLE facilityProfiles ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0",
      );
      sqliteDb.exec(
        "UPDATE facilityProfiles SET createdAt = updatedAt WHERE createdAt = 0",
      );
    }
    sqliteDb.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_facilityProfiles_slug ON facilityProfiles(slug)",
    );
  }

  const facilityCreatedAt = Date.now();
  sqliteDb
    .prepare(
      `INSERT OR IGNORE INTO facilityProfiles
       (id, slug, name, logoDataUrl, accentColor, status, createdAt, updatedAt)
       VALUES ('primary', 'primary', 'Centro Umbravia Forge', '', '#2563eb', 'active', ?, ?)`,
    )
    .run(facilityCreatedAt, facilityCreatedAt);

  sqliteDb.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_gymClasses_facility_insert
    BEFORE INSERT ON gymClasses
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_gymClasses_facility_update
    BEFORE UPDATE OF facilityId ON gymClasses
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
  `);

  if (!tableNames.includes("facilityMemberships")) {
    console.log("Creating facilityMemberships table...");
    sqliteDb.exec(`
      CREATE TABLE facilityMemberships (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        userId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'trainer', 'member')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'invited', 'suspended', 'left')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(facilityId, userId)
      );
      CREATE INDEX idx_facilityMemberships_user
        ON facilityMemberships(userId, status);
      CREATE INDEX idx_facilityMemberships_facility_role
        ON facilityMemberships(facilityId, role, status);
    `);
  }

  const membershipBackfillAt = Date.now();
  sqliteDb
    .prepare(
      `INSERT OR IGNORE INTO facilityMemberships
       (id, facilityId, userId, role, status, createdAt, updatedAt)
       SELECT 'primary:' || id,
              'primary',
              id,
              CASE role
                WHEN 'admin' THEN 'admin'
                WHEN 'trainer' THEN 'trainer'
                ELSE 'member'
              END,
              'active',
              createdAt,
              ?
       FROM users`,
    )
    .run(membershipBackfillAt);

  const reputationColumns = sqliteDb
    .prepare("PRAGMA table_info(bookingReputations)")
    .all() as Array<{ name: string }>;
  if (!reputationColumns.some((column) => column.name === "facilityId")) {
    sqliteDb.exec(`
      ALTER TABLE bookingReputations RENAME TO bookingReputationsLegacy;
      CREATE TABLE bookingReputations (
        facilityId TEXT NOT NULL,
        userId TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 100 CHECK(score BETWEEN 0 AND 100),
        penaltyUntil INTEGER,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY(facilityId, userId),
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO bookingReputations
        (facilityId, userId, score, penaltyUntil, updatedAt)
      SELECT 'primary', userId, score, penaltyUntil, updatedAt
      FROM bookingReputationsLegacy;
      DROP TABLE bookingReputationsLegacy;
    `);
  }

  const reputationEventColumns = sqliteDb
    .prepare("PRAGMA table_info(bookingReputationEvents)")
    .all() as Array<{ name: string }>;
  if (!reputationEventColumns.some((column) => column.name === "facilityId")) {
    sqliteDb.exec(`
      ALTER TABLE bookingReputationEvents
        RENAME TO bookingReputationEventsLegacy;
      CREATE TABLE bookingReputationEvents (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        userId TEXT NOT NULL,
        bookingId TEXT,
        type TEXT NOT NULL,
        pointsDelta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(bookingId) REFERENCES bookings(id) ON DELETE SET NULL
      );
      INSERT INTO bookingReputationEvents
        (id, facilityId, userId, bookingId, type, pointsDelta, reason, createdAt)
      SELECT id, 'primary', userId, bookingId, type, pointsDelta, reason, createdAt
      FROM bookingReputationEventsLegacy;
      DROP TABLE bookingReputationEventsLegacy;
    `);
  }

  sqliteDb.exec(`
    DROP INDEX IF EXISTS idx_bookingReputations_penalty;
    DROP INDEX IF EXISTS idx_bookingReputationEvents_user;
    CREATE INDEX IF NOT EXISTS idx_bookingReputations_facility_penalty
      ON bookingReputations(facilityId, penaltyUntil);
    CREATE INDEX IF NOT EXISTS idx_bookingReputationEvents_facility_user
      ON bookingReputationEvents(facilityId, userId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_bookingReputationEvents_booking_type
      ON bookingReputationEvents(bookingId, type);
  `);
  sqliteDb
    .prepare(
      `UPDATE facilityMemberships
       SET role = 'owner', updatedAt = ?
       WHERE id = (
         SELECT membership.id
         FROM facilityMemberships AS membership
         INNER JOIN users AS user ON user.id = membership.userId
         WHERE membership.facilityId = 'primary'
           AND membership.status = 'active'
           AND user.role = 'admin'
         ORDER BY user.createdAt ASC, user.id ASC
         LIMIT 1
       )
       AND NOT EXISTS (
         SELECT 1
         FROM facilityMemberships
         WHERE facilityId = 'primary'
           AND role = 'owner'
           AND status = 'active'
       )`,
    )
    .run(membershipBackfillAt);

  if (!tableNames.includes("commercialTrials")) {
    console.log("Creating commercialTrials tables...");
    sqliteDb.exec(`
      CREATE TABLE commercialTrials (
        id TEXT PRIMARY KEY,
        ownerUserId TEXT NOT NULL,
        facilityName TEXT NOT NULL,
        facilityType TEXT NOT NULL CHECK(facilityType IN (
          'traditional_gym', 'crossfit', 'hyrox', 'functional_training',
          'personal_training', 'powerlifting', 'strongman', 'bodybuilding',
          'martial_arts', 'yoga', 'pilates', 'indoor_cycling',
          'multidisciplinary', 'custom'
        )),
        approximateMembers INTEGER,
        trainerCount INTEGER,
        spaceCount INTEGER,
        usualCapacity INTEGER,
        classTypes TEXT NOT NULL DEFAULT '[]',
        scheduleNotes TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL CHECK(locale IN ('es', 'en', 'de', 'de-CH')),
        currency TEXT NOT NULL,
        usesBookings INTEGER NOT NULL DEFAULT 1 CHECK(usesBookings IN (0, 1)),
        usesWaitlist INTEGER NOT NULL DEFAULT 1 CHECK(usesWaitlist IN (0, 1)),
        templateKey TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'trial_active', 'trial_paused_support', 'trial_conversion_review',
          'trial_expired', 'trial_closed'
        )),
        subdomain TEXT NOT NULL,
        realDataDeclaration TEXT NOT NULL DEFAULT 'undeclared' CHECK(realDataDeclaration IN (
          'undeclared', 'yes', 'no', 'assistance'
        )),
        conversionDraft TEXT NOT NULL DEFAULT '[]',
        startedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        pausedAt INTEGER,
        closedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(ownerUserId) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_commercialTrials_status ON commercialTrials(status);
      CREATE INDEX idx_commercialTrials_expiry ON commercialTrials(expiresAt);

      CREATE TABLE commercialTrialEvents (
        id TEXT PRIMARY KEY,
        trialId TEXT NOT NULL,
        actorUserId TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(trialId) REFERENCES commercialTrials(id) ON DELETE CASCADE,
        FOREIGN KEY(actorUserId) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_commercialTrialEvents_trial
        ON commercialTrialEvents(trialId, createdAt DESC);
    `);
  } else {
    const commercialColumns = sqliteDb
      .prepare("PRAGMA table_info(commercialTrials)")
      .all() as Array<{ name: string }>;
    if (
      !commercialColumns.some((column) => column.name === "conversionDraft")
    ) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN conversionDraft TEXT NOT NULL DEFAULT '[]'",
      );
    }
  }

  if (!tableNames.includes("commercialRequests")) {
    sqliteDb.exec(`
      CREATE TABLE commercialRequests (
        id TEXT PRIMARY KEY,
        trialId TEXT NOT NULL,
        requesterUserId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('commercial_contact', 'support', 'problem')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_review', 'resolved', 'cancelled')),
        name TEXT NOT NULL,
        facilityName TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        preferredChannel TEXT NOT NULL CHECK(preferredChannel IN ('email', 'phone', 'whatsapp')),
        preferredTime TEXT NOT NULL DEFAULT '',
        contactConsent INTEGER NOT NULL CHECK(contactConsent IN (0, 1)),
        includeEnvironmentSummary INTEGER NOT NULL DEFAULT 0 CHECK(includeEnvironmentSummary IN (0, 1)),
        environmentSummary TEXT,
        problemCategory TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        resolvedAt INTEGER,
        FOREIGN KEY(trialId) REFERENCES commercialTrials(id) ON DELETE CASCADE,
        FOREIGN KEY(requesterUserId) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_commercialRequests_trial
        ON commercialRequests(trialId, createdAt DESC);
      CREATE INDEX idx_commercialRequests_status
        ON commercialRequests(status, kind);
    `);
  }

  if (!tableNames.includes("delegationGrants")) {
    console.log("Creating delegationGrants table...");
    sqliteDb.exec(`
      CREATE TABLE delegationGrants (
        id TEXT PRIMARY KEY,
        ownerUserId TEXT NOT NULL,
        delegateUserId TEXT,
        tokenHash TEXT NOT NULL UNIQUE,
        tokenPreview TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'bookings' CHECK(scope = 'bookings'),
        duration TEXT NOT NULL CHECK(duration IN ('24h', '7d', '30d', 'indefinite')),
        expiresAt INTEGER,
        createdAt INTEGER NOT NULL,
        redeemedAt INTEGER,
        revokedAt INTEGER,
        ownerHiddenAt INTEGER,
        delegateHiddenAt INTEGER,
        FOREIGN KEY(ownerUserId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(delegateUserId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_delegationGrants_owner ON delegationGrants(ownerUserId);
      CREATE INDEX idx_delegationGrants_delegate ON delegationGrants(delegateUserId);
      CREATE INDEX idx_delegationGrants_expiry ON delegationGrants(expiresAt);
    `);
  } else {
    const delegationColumns = sqliteDb
      .prepare("PRAGMA table_info(delegationGrants)")
      .all() as Array<{ name: string }>;
    const delegationColumnNames = delegationColumns.map(
      (column) => column.name,
    );
    if (!delegationColumnNames.includes("ownerHiddenAt")) {
      sqliteDb.exec(
        "ALTER TABLE delegationGrants ADD COLUMN ownerHiddenAt INTEGER",
      );
    }
    if (!delegationColumnNames.includes("delegateHiddenAt")) {
      sqliteDb.exec(
        "ALTER TABLE delegationGrants ADD COLUMN delegateHiddenAt INTEGER",
      );
    }
  }

  initializeCommunitySchema(sqliteDb);
  initializeE2eeSchema(sqliteDb);

  console.log("Database initialized successfully");
}

export async function closeDatabase(): Promise<void> {
  if (postgresRuntime) {
    await postgresRuntime.close();
    return;
  }
  requireSqliteDatabase().close();
}

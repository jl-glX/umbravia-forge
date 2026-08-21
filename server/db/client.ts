import "dotenv/config";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database as DatabaseSchema } from "./types.js";
import { generateSupportId } from "../lib/support-id.js";
import { migrateLegacyActivityDomainSqlite } from "./activity-domain-migration.js";
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

function quoteSqliteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error("Unexpected SQLite schema identifier");
  }
  return `"${identifier}"`;
}

function enforceActiveFacilityBoundary(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      UPDATE facilityMemberships
      SET status = 'suspended', updatedAt = MAX(updatedAt, CAST(unixepoch('subsec') * 1000 AS INTEGER))
      WHERE facilityId IN (
        SELECT id FROM facilityProfiles WHERE id NOT LIKE 'facility-%'
      ) AND status IN ('active', 'invited');

      UPDATE facilityProfiles
      SET status = 'closed', updatedAt = MAX(updatedAt, CAST(unixepoch('subsec') * 1000 AS INTEGER))
      WHERE id NOT LIKE 'facility-%' AND status <> 'closed';

    `);

    const facilityTables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;
    for (const { name } of facilityTables) {
      if (name === "facilityProfiles") continue;
      const columns = database
        .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(name)})`)
        .all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "facilityId")) continue;
      const table = quoteSqliteIdentifier(name);
      const insertTrigger = quoteSqliteIdentifier(
        `trg_${name}_active_facility_insert`,
      );
      const updateTrigger = quoteSqliteIdentifier(
        `trg_${name}_active_facility_update`,
      );
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS ${insertTrigger}
        BEFORE INSERT ON ${table}
        WHEN NEW.facilityId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM facilityProfiles
          WHERE id = NEW.facilityId AND status = 'active'
        )
        BEGIN
          SELECT RAISE(ABORT, 'Facility scope is not active');
        END;

        CREATE TRIGGER IF NOT EXISTS ${updateTrigger}
        BEFORE UPDATE OF facilityId ON ${table}
        WHEN NEW.facilityId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM facilityProfiles
          WHERE id = NEW.facilityId AND status = 'active'
        )
        BEGIN
          SELECT RAISE(ABORT, 'Facility scope is not active');
        END;
      `);
    }
  })();
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
             PARTITION BY activitySessionId, userId
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
           WHERE bookings.activitySessionId = waitlistEntries.activitySessionId
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
  migrateLegacyActivityDomainSqlite(sqliteDb);

  const tables = sqliteDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;

  const tableNames = tables.map((t) => t.name);
  const legacyFacilityBackfillRequired = [
    "activitySessions",
    "billingRecords",
    "supportKnowledgeArticles",
    "bookingReputations",
    "bookingReputationEvents",
    "commercialTrials",
    "parentalControls",
  ].some((tableName) => {
    if (!tableNames.includes(tableName)) return false;
    const columns = sqliteDb
      .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
      .all() as Array<{ name: string }>;
    return !columns.some((column) => column.name === "facilityId");
  });

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

  if (!tableNames.includes("activitySessions")) {
    console.log("Creating activitySessions table...");
    sqliteDb.exec(`
      CREATE TABLE activitySessions (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        trainerId TEXT NOT NULL,
        trainerName TEXT NOT NULL,
        maxCapacity INTEGER NOT NULL,
        scheduledAt INTEGER NOT NULL
      );
      CREATE INDEX idx_activitySessions_facility_scheduled
        ON activitySessions(facilityId, scheduledAt);
      CREATE INDEX idx_activitySessions_scheduledAt
        ON activitySessions(scheduledAt);
    `);
  } else {
    const classColumns = sqliteDb
      .prepare("PRAGMA table_info(activitySessions)")
      .all() as Array<{ name: string }>;
    if (!classColumns.some((column) => column.name === "facilityId")) {
      sqliteDb.exec(
        "ALTER TABLE activitySessions ADD COLUMN facilityId TEXT NOT NULL DEFAULT 'legacy-import-quarantine'",
      );
    }
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_activitySessions_facility_scheduled
        ON activitySessions(facilityId, scheduledAt);
      CREATE INDEX IF NOT EXISTS idx_activitySessions_scheduledAt
        ON activitySessions(scheduledAt);
    `);
  }

  if (!tableNames.includes("activitySessionBookingConfigurations")) {
    sqliteDb.exec(`
      CREATE TABLE activitySessionBookingConfigurations (
        activitySessionId TEXT PRIMARY KEY,
        configuration TEXT NOT NULL DEFAULT '{}',
        lifecycleState TEXT NOT NULL DEFAULT 'active' CHECK(lifecycleState IN ('active', 'suspended', 'cancelled')),
        seriesId TEXT,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_activitySessionBookingConfigurations_series
        ON activitySessionBookingConfigurations(seriesId);
    `);
  }
  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_activitySessionBookingConfigurations_series
      ON activitySessionBookingConfigurations(seriesId);
  `);

  if (!tableNames.includes("bookings")) {
    console.log("Creating bookings table...");
    sqliteDb.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        activitySessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled', 'waitlist')),
        createdAt INTEGER NOT NULL,
        cancelledAt INTEGER,
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id),
        FOREIGN KEY(userId) REFERENCES users(id)
      );
      CREATE INDEX idx_bookings_activitySessionId
        ON bookings(activitySessionId);
      CREATE INDEX idx_bookings_userId ON bookings(userId);
      CREATE INDEX idx_bookings_status ON bookings(status);
      CREATE UNIQUE INDEX idx_bookings_active_user_activitySession
        ON bookings(activitySessionId, userId)
        WHERE status IN ('confirmed', 'waitlist');
    `);
  } else {
    const duplicateBookings = reconcileDuplicateBookings();
    if (duplicateBookings > 0) {
      console.warn(
        `Reconciled ${duplicateBookings} duplicate active booking(s).`,
      );
    }
  }
  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_activitySessionId
      ON bookings(activitySessionId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_user_activitySession
      ON bookings(activitySessionId, userId)
      WHERE status IN ('confirmed', 'waitlist');
  `);

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
        activitySessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        position INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        promotedAt INTEGER,
        promotionExpiresAt INTEGER,
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id),
        FOREIGN KEY(userId) REFERENCES users(id),
        UNIQUE(activitySessionId, userId)
      );
      CREATE INDEX idx_waitlistEntries_activitySessionId
        ON waitlistEntries(activitySessionId);
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
  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_waitlistEntries_activitySessionId
      ON waitlistEntries(activitySessionId);
  `);

  if (!tableNames.includes("bookingReputations")) {
    sqliteDb.exec(`
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
      CREATE INDEX idx_bookingReputations_penalty
        ON bookingReputations(penaltyUntil);
    `);
  }

  if (!tableNames.includes("bookingReputationEvents")) {
    sqliteDb.exec(`
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
      CREATE INDEX idx_bookingReputationEvents_user
        ON bookingReputationEvents(userId, createdAt DESC);
    `);
  }

  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookingReputationEvents_booking_type
      ON bookingReputationEvents(bookingId, type);
    CREATE INDEX IF NOT EXISTS idx_waitlistEntries_activitySession_expiry
      ON waitlistEntries(activitySessionId, promotionExpiresAt);
  `);

  if (!tableNames.includes("activitySessionContents")) {
    sqliteDb.exec(`
      CREATE TABLE activitySessionContents (
        activitySessionId TEXT PRIMARY KEY,
        terminology TEXT NOT NULL DEFAULT 'Contenido de la sesión',
        blocks TEXT NOT NULL DEFAULT '[]',
        commentsEnabled INTEGER NOT NULL DEFAULT 0 CHECK(commentsEnabled IN (0, 1)),
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id) ON DELETE CASCADE
      );
    `);
  }

  if (!tableNames.includes("sessionContentProgress")) {
    sqliteDb.exec(`
      CREATE TABLE sessionContentProgress (
        activitySessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        completedBlockIds TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY(activitySessionId, userId),
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id) ON DELETE CASCADE,
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

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS applicationTenants (
      id TEXT PRIMARY KEY CHECK(id IN ('commercial', 'corporate-support')),
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('commercial', 'corporate_support')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO applicationTenants
      (id, name, kind, status, createdAt, updatedAt)
    VALUES
      ('commercial', 'Umbravia Forge Commercial', 'commercial', 'active', 0, 0),
      ('corporate-support', 'Umbravia Forge Corporate Support', 'corporate_support', 'active', 0, 0);
  `);

  if (!tableNames.includes("supportTickets")) {
    console.log("Creating Forge Support tables...");
    sqliteDb.exec(`
      CREATE TABLE supportTickets (
        id TEXT PRIMARY KEY,
        publicId TEXT NOT NULL UNIQUE,
        applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
          CHECK(applicationTenantId IN ('commercial', 'corporate-support')),
        facilityId TEXT NOT NULL,
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
        FOREIGN KEY(applicationTenantId) REFERENCES applicationTenants(id) ON DELETE RESTRICT,
        FOREIGN KEY(requesterUserId) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY(assigneeUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_supportTickets_requester ON supportTickets(requesterUserId, updatedAt DESC);
      CREATE INDEX idx_supportTickets_queue ON supportTickets(facilityId, status, priority, updatedAt DESC);
      CREATE INDEX idx_supportTickets_assignee ON supportTickets(assigneeUserId, status, updatedAt DESC);

      CREATE TABLE supportAgents (
        id TEXT PRIMARY KEY,
        applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
          CHECK(applicationTenantId IN ('commercial', 'corporate-support')),
        facilityId TEXT NOT NULL,
        userId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('agent', 'manager')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(applicationTenantId) REFERENCES applicationTenants(id) ON DELETE RESTRICT,
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
        applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
          CHECK(applicationTenantId IN ('commercial', 'corporate-support')),
        facilityId TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
        authorUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        publishedAt INTEGER,
        FOREIGN KEY(applicationTenantId) REFERENCES applicationTenants(id) ON DELETE RESTRICT,
        FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE(facilityId, slug)
      );
      CREATE INDEX idx_supportKnowledge_status ON supportKnowledgeArticles(facilityId, status, category, updatedAt DESC);
    `);
  }

  const supportTicketColumns = sqliteDb
    .prepare("PRAGMA table_info(supportTickets)")
    .all() as Array<{ name: string }>;
  if (
    !supportTicketColumns.some(
      (column) => column.name === "applicationTenantId",
    )
  ) {
    sqliteDb.exec(`
      ALTER TABLE supportTickets
        ADD COLUMN applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
        CHECK(applicationTenantId IN ('commercial', 'corporate-support'));
    `);
  }

  const supportAgentColumns = sqliteDb
    .prepare("PRAGMA table_info(supportAgents)")
    .all() as Array<{ name: string }>;
  if (
    !supportAgentColumns.some((column) => column.name === "applicationTenantId")
  ) {
    sqliteDb.exec(`
      ALTER TABLE supportAgents
        ADD COLUMN applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
        CHECK(applicationTenantId IN ('commercial', 'corporate-support'));
    `);
  }

  if (!tableNames.includes("billingRecords")) {
    sqliteDb.exec(`
      CREATE TABLE billingRecords (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
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
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
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

    if (!billingColumnNames.includes("facilityId")) {
      sqliteDb.exec(
        "ALTER TABLE billingRecords ADD COLUMN facilityId TEXT NOT NULL DEFAULT 'legacy-import-quarantine'",
      );
    }

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

  const legacyFacilityId = "legacy-import-quarantine";
  const legacyUsersExist = Boolean(
    sqliteDb.prepare("SELECT 1 FROM users LIMIT 1").get(),
  );
  if (
    legacyUsersExist &&
    (legacyFacilityBackfillRequired || !tableNames.includes("facilityProfiles"))
  ) {
    const facilityCreatedAt = Date.now();
    sqliteDb
      .prepare(
        `INSERT OR IGNORE INTO facilityProfiles
         (id, slug, name, logoDataUrl, accentColor, status, createdAt, updatedAt)
         VALUES (?, ?, 'Legacy import under review', '', '#64748b', 'closed', ?, ?)`,
      )
      .run(
        legacyFacilityId,
        legacyFacilityId,
        facilityCreatedAt,
        facilityCreatedAt,
      );
  }

  sqliteDb.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_activitySessions_facility_insert
    BEFORE INSERT ON activitySessions
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_activitySessions_facility_update
    BEFORE UPDATE OF facilityId ON activitySessions
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
  `);

  if (!tableNames.includes("bookingAnalyticsEvents")) {
    sqliteDb.exec(`
      CREATE TABLE bookingAnalyticsEvents (
        id TEXT PRIMARY KEY,
        deduplicationKey TEXT NOT NULL UNIQUE,
        facilityId TEXT NOT NULL,
        bookingId TEXT,
        activitySessionId TEXT,
        memberUserId TEXT,
        trainerUserId TEXT,
        eventType TEXT NOT NULL CHECK(eventType IN (
          'baseline_import',
          'booking_created',
          'waitlist_promoted',
          'promotion_expired',
          'booking_cancelled',
          'attendance_intention_changed',
          'attendance_recorded',
          'attendance_corrected'
        )),
        source TEXT NOT NULL CHECK(source IN ('baseline', 'live')),
        fromState TEXT,
        toState TEXT NOT NULL,
        activityName TEXT NOT NULL,
        scheduledAt INTEGER NOT NULL,
        capacitySnapshot INTEGER NOT NULL CHECK(capacitySnapshot >= 0),
        occurredAt INTEGER NOT NULL,
        recordedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(bookingId) REFERENCES bookings(id) ON DELETE SET NULL,
        FOREIGN KEY(activitySessionId) REFERENCES activitySessions(id) ON DELETE SET NULL,
        FOREIGN KEY(memberUserId) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(trainerUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_bookingAnalyticsEvents_facility_occurred
        ON bookingAnalyticsEvents(facilityId, occurredAt);
      CREATE INDEX idx_bookingAnalyticsEvents_facility_scheduled
        ON bookingAnalyticsEvents(facilityId, scheduledAt);
      CREATE INDEX idx_bookingAnalyticsEvents_member_scheduled
        ON bookingAnalyticsEvents(facilityId, memberUserId, scheduledAt);
      CREATE INDEX idx_bookingAnalyticsEvents_activitySession_event
        ON bookingAnalyticsEvents(facilityId, activitySessionId, eventType, occurredAt);
    `);
    sqliteDb.exec(`
      INSERT OR IGNORE INTO bookingAnalyticsEvents (
        id,
        deduplicationKey,
        facilityId,
        bookingId,
        activitySessionId,
        memberUserId,
        trainerUserId,
        eventType,
        source,
        fromState,
        toState,
        activityName,
        scheduledAt,
        capacitySnapshot,
        occurredAt,
        recordedAt
      )
      SELECT
        'baseline:' || bookings.id,
        'baseline:' || bookings.id,
        activitySessions.facilityId,
        bookings.id,
        bookings.activitySessionId,
        bookings.userId,
        (SELECT id FROM users WHERE id = activitySessions.trainerId),
        'baseline_import',
        'baseline',
        NULL,
        COALESCE(
          bookingLifecycles.lifecycleStatus,
          CASE bookings.status
            WHEN 'waitlist' THEN 'waitlisted'
            WHEN 'cancelled' THEN 'cancelled_on_time'
            ELSE 'confirmation_pending'
          END
        ),
        activitySessions.name,
        activitySessions.scheduledAt,
        activitySessions.maxCapacity,
        bookings.createdAt,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM bookings
      INNER JOIN activitySessions
        ON activitySessions.id = bookings.activitySessionId
      LEFT JOIN bookingLifecycles
        ON bookingLifecycles.bookingId = bookings.id;
    `);
  }
  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookingAnalyticsEvents_activitySession_event
      ON bookingAnalyticsEvents(facilityId, activitySessionId, eventType, occurredAt);
  `);

  if (!tableNames.includes("analyticsSurveyDefinitions")) {
    sqliteDb.exec(`
      CREATE TABLE analyticsSurveyDefinitions (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        seriesKey TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        privacyMode TEXT NOT NULL CHECK(privacyMode IN ('anonymous', 'confidential', 'identified')),
        minimumResponses INTEGER NOT NULL DEFAULT 5 CHECK(minimumResponses BETWEEN 5 AND 50),
        status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'archived')),
        createdByUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(createdByUserId) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE(facilityId, seriesKey, version)
      );
      CREATE TABLE analyticsSurveyQuestions (
        id TEXT PRIMARY KEY,
        surveyId TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
        prompt TEXT NOT NULL,
        questionType TEXT NOT NULL CHECK(questionType IN ('scale_1_5', 'single_choice', 'multiple_choice')),
        optionsJson TEXT NOT NULL DEFAULT '[]',
        required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0, 1)),
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(surveyId) REFERENCES analyticsSurveyDefinitions(id) ON DELETE CASCADE,
        UNIQUE(surveyId, position)
      );
      CREATE TABLE analyticsSurveyCampaigns (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        surveyId TEXT NOT NULL,
        periodKey TEXT NOT NULL,
        opensAt INTEGER NOT NULL,
        closesAt INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'active', 'closed')),
        createdByUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(surveyId) REFERENCES analyticsSurveyDefinitions(id) ON DELETE RESTRICT,
        FOREIGN KEY(createdByUserId) REFERENCES users(id) ON DELETE RESTRICT,
        CHECK(closesAt > opensAt),
        UNIQUE(facilityId, periodKey)
      );
      CREATE TABLE analyticsSurveyResponses (
        id TEXT PRIMARY KEY,
        facilityId TEXT NOT NULL,
        campaignId TEXT NOT NULL,
        respondentUserId TEXT,
        submittedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(campaignId) REFERENCES analyticsSurveyCampaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(respondentUserId) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE analyticsSurveyAnswers (
        id TEXT PRIMARY KEY,
        responseId TEXT NOT NULL,
        questionId TEXT NOT NULL,
        valueJson TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(responseId) REFERENCES analyticsSurveyResponses(id) ON DELETE CASCADE,
        FOREIGN KEY(questionId) REFERENCES analyticsSurveyQuestions(id) ON DELETE RESTRICT,
        UNIQUE(responseId, questionId)
      );
      CREATE TABLE analyticsSurveyParticipations (
        campaignId TEXT NOT NULL,
        userId TEXT NOT NULL,
        completedAt INTEGER NOT NULL,
        FOREIGN KEY(campaignId) REFERENCES analyticsSurveyCampaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(campaignId, userId)
      );
      CREATE INDEX idx_analyticsSurveyDefinitions_facility_status
        ON analyticsSurveyDefinitions(facilityId, status, seriesKey, version DESC);
      CREATE INDEX idx_analyticsSurveyCampaigns_facility_window
        ON analyticsSurveyCampaigns(facilityId, status, opensAt, closesAt);
      CREATE INDEX idx_analyticsSurveyResponses_campaign
        ON analyticsSurveyResponses(campaignId, submittedAt);
      CREATE INDEX idx_analyticsSurveyAnswers_question
        ON analyticsSurveyAnswers(questionId, createdAt);
    `);
  }

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

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS crmMemberProfiles (
      id TEXT PRIMARY KEY,
      facilityId TEXT NOT NULL,
      memberUserId TEXT NOT NULL,
      manualSegment TEXT CHECK(manualSegment IS NULL OR manualSegment IN ('onboarding', 'engaged', 'attention', 'reengagement')),
      assignedToUserId TEXT,
      nextFollowUpAt INTEGER,
      updatedByUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
      FOREIGN KEY(memberUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assignedToUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(updatedByUserId) REFERENCES users(id) ON DELETE RESTRICT,
      UNIQUE(facilityId, memberUserId)
    );
    CREATE TABLE IF NOT EXISTS crmFollowUps (
      id TEXT PRIMARY KEY,
      facilityId TEXT NOT NULL,
      memberUserId TEXT NOT NULL,
      assignedToUserId TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('onboarding', 'check_in', 'retention', 'service')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'completed', 'dismissed')),
      dueAt INTEGER NOT NULL,
      completedAt INTEGER,
      createdByUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
      FOREIGN KEY(memberUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assignedToUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(createdByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_crmMemberProfiles_facility_segment
      ON crmMemberProfiles(facilityId, manualSegment, nextFollowUpAt);
    CREATE INDEX IF NOT EXISTS idx_crmFollowUps_facility_status_due
      ON crmFollowUps(facilityId, status, dueAt);
    CREATE INDEX IF NOT EXISTS idx_crmFollowUps_member
      ON crmFollowUps(facilityId, memberUserId, createdAt DESC);
  `);

  const membershipBackfillAt = Date.now();
  if (!tableNames.includes("facilityMemberships")) {
    sqliteDb
      .prepare(
        `INSERT OR IGNORE INTO facilityMemberships
         (id, facilityId, userId, role, status, createdAt, updatedAt)
         SELECT ? || ':' || id,
                ?,
                id,
                CASE role
                  WHEN 'admin' THEN 'admin'
                  WHEN 'trainer' THEN 'trainer'
                  ELSE 'member'
                END,
                'active',
                createdAt,
                ?
         FROM users
         WHERE EXISTS (SELECT 1 FROM facilityProfiles WHERE id = ?)`,
      )
      .run(
        legacyFacilityId,
        legacyFacilityId,
        membershipBackfillAt,
        legacyFacilityId,
      );
  }

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS supportKnowledgeArticles (
      id TEXT PRIMARY KEY,
      applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
        CHECK(applicationTenantId IN ('commercial', 'corporate-support')),
      facilityId TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
      authorUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      publishedAt INTEGER,
      FOREIGN KEY(applicationTenantId) REFERENCES applicationTenants(id) ON DELETE RESTRICT,
      FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
      FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE RESTRICT,
      UNIQUE(facilityId, slug)
    );
  `);

  const supportKnowledgeTenantColumns = sqliteDb
    .prepare("PRAGMA table_info(supportKnowledgeArticles)")
    .all() as Array<{ name: string }>;
  if (
    !supportKnowledgeTenantColumns.some(
      (column) => column.name === "applicationTenantId",
    )
  ) {
    sqliteDb.exec(`
      ALTER TABLE supportKnowledgeArticles
        ADD COLUMN applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
        CHECK(applicationTenantId IN ('commercial', 'corporate-support'));
    `);
  }

  const supportKnowledgeColumns = sqliteDb
    .prepare("PRAGMA table_info(supportKnowledgeArticles)")
    .all() as Array<{ name: string }>;
  if (!supportKnowledgeColumns.some((column) => column.name === "facilityId")) {
    sqliteDb.exec(`
      ALTER TABLE supportKnowledgeArticles
        RENAME TO supportKnowledgeArticlesLegacy;
      CREATE TABLE supportKnowledgeArticles (
        id TEXT PRIMARY KEY,
        applicationTenantId TEXT NOT NULL DEFAULT 'corporate-support'
          CHECK(applicationTenantId IN ('commercial', 'corporate-support')),
        facilityId TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
        authorUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        publishedAt INTEGER,
        FOREIGN KEY(applicationTenantId) REFERENCES applicationTenants(id) ON DELETE RESTRICT,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
        FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE(facilityId, slug)
      );
      INSERT INTO supportKnowledgeArticles (
        id, applicationTenantId, facilityId, slug, title, summary, body, category, status,
        authorUserId, createdAt, updatedAt, publishedAt
      )
      SELECT id, applicationTenantId, 'legacy-import-quarantine', slug, title, summary, body, category, status,
             authorUserId, createdAt, updatedAt, publishedAt
      FROM supportKnowledgeArticlesLegacy;
      DROP TABLE supportKnowledgeArticlesLegacy;
    `);
  }

  sqliteDb.exec(`
    DROP INDEX IF EXISTS idx_supportKnowledge_status;
    CREATE INDEX IF NOT EXISTS idx_supportKnowledge_status
      ON supportKnowledgeArticles(facilityId, status, category, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_supportTickets_application_queue
      ON supportTickets(applicationTenantId, facilityId, status, priority, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_supportAgents_application_active
      ON supportAgents(applicationTenantId, facilityId, active, role);
    CREATE INDEX IF NOT EXISTS idx_supportKnowledge_application_status
      ON supportKnowledgeArticles(applicationTenantId, facilityId, status, category, updatedAt DESC);
    CREATE TRIGGER IF NOT EXISTS trg_supportTickets_application_tenant_insert
    BEFORE INSERT ON supportTickets
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportTickets_application_tenant_update
    BEFORE UPDATE OF applicationTenantId ON supportTickets
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportAgents_application_tenant_insert
    BEFORE INSERT ON supportAgents
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportAgents_application_tenant_update
    BEFORE UPDATE OF applicationTenantId ON supportAgents
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportKnowledge_application_tenant_insert
    BEFORE INSERT ON supportKnowledgeArticles
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportKnowledge_application_tenant_update
    BEFORE UPDATE OF applicationTenantId ON supportKnowledgeArticles
    WHEN NOT EXISTS (
      SELECT 1 FROM applicationTenants WHERE id = NEW.applicationTenantId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown application tenant');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportTickets_facility_insert
    BEFORE INSERT ON supportTickets
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportTickets_facility_update
    BEFORE UPDATE OF facilityId ON supportTickets
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportAgents_facility_insert
    BEFORE INSERT ON supportAgents
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportAgents_facility_update
    BEFORE UPDATE OF facilityId ON supportAgents
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportKnowledge_facility_insert
    BEFORE INSERT ON supportKnowledgeArticles
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supportKnowledge_facility_update
    BEFORE UPDATE OF facilityId ON supportKnowledgeArticles
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
  `);

  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_billingRecords_facility_status
      ON billingRecords(facilityId, status, updatedAt DESC);
    CREATE TRIGGER IF NOT EXISTS trg_billingRecords_facility_insert
    BEFORE INSERT ON billingRecords
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_billingRecords_facility_update
    BEFORE UPDATE OF facilityId ON billingRecords
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
  `);

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
      SELECT 'legacy-import-quarantine', userId, score, penaltyUntil, updatedAt
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
      SELECT id, 'legacy-import-quarantine', userId, bookingId, type, pointsDelta, reason, createdAt
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
         WHERE membership.facilityId = 'legacy-import-quarantine'
           AND membership.status = 'active'
           AND user.role = 'admin'
         ORDER BY user.createdAt ASC, user.id ASC
         LIMIT 1
       )
       AND NOT EXISTS (
         SELECT 1
         FROM facilityMemberships
         WHERE facilityId = 'legacy-import-quarantine'
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
        facilityId TEXT NOT NULL UNIQUE,
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
        autoCleanupEligible INTEGER NOT NULL DEFAULT 0 CHECK(autoCleanupEligible IN (0, 1)),
        dataReviewRequestedAt INTEGER,
        cleanupEligibleAt INTEGER,
        conversionDraft TEXT NOT NULL DEFAULT '[]',
        startedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        pausedAt INTEGER,
        closedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE,
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
    if (!commercialColumns.some((column) => column.name === "facilityId")) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN facilityId TEXT NOT NULL DEFAULT 'legacy-import-quarantine'",
      );
    }
    if (
      !commercialColumns.some((column) => column.name === "conversionDraft")
    ) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN conversionDraft TEXT NOT NULL DEFAULT '[]'",
      );
    }
    if (
      !commercialColumns.some((column) => column.name === "autoCleanupEligible")
    ) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN autoCleanupEligible INTEGER NOT NULL DEFAULT 0 CHECK(autoCleanupEligible IN (0, 1))",
      );
    }
    if (
      !commercialColumns.some(
        (column) => column.name === "dataReviewRequestedAt",
      )
    ) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN dataReviewRequestedAt INTEGER",
      );
    }
    if (
      !commercialColumns.some((column) => column.name === "cleanupEligibleAt")
    ) {
      sqliteDb.exec(
        "ALTER TABLE commercialTrials ADD COLUMN cleanupEligibleAt INTEGER",
      );
    }
  }

  sqliteDb.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercialTrials_facility
      ON commercialTrials(facilityId);
    CREATE INDEX IF NOT EXISTS idx_commercialTrials_cleanup
      ON commercialTrials(autoCleanupEligible, cleanupEligibleAt);
    CREATE TRIGGER IF NOT EXISTS trg_commercialTrials_facility_insert
    BEFORE INSERT ON commercialTrials
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_commercialTrials_facility_update
    BEFORE UPDATE OF facilityId ON commercialTrials
    WHEN NOT EXISTS (
      SELECT 1 FROM facilityProfiles WHERE id = NEW.facilityId
    )
    BEGIN
      SELECT RAISE(ABORT, 'Unknown facility');
    END;
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS administratorSignupProvisioning (
      userId TEXT PRIMARY KEY,
      facilityName TEXT NOT NULL,
      facilityType TEXT NOT NULL CHECK(facilityType IN (
        'traditional_gym', 'crossfit', 'hyrox', 'functional_training',
        'personal_training', 'powerlifting', 'strongman', 'bodybuilding',
        'martial_arts', 'yoga', 'pilates', 'indoor_cycling',
        'multidisciplinary', 'custom'
      )),
      locale TEXT NOT NULL CHECK(locale IN ('es', 'en', 'de', 'de-CH')),
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS corporateRoleAssignments (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      profileId TEXT NOT NULL CHECK(profileId IN (
        'manager-core',
        'manager-coordinator',
        'manager-flow-administrator',
        'manager-account',
        'manager-security',
        'manager-resource',
        'manager-encryption',
        'manager-environment',
        'manager-email',
        'manager-notification',
        'manager-support'
      )),
      assignedByUserId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assignedByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_corporateRoleAssignments_active
      ON corporateRoleAssignments(userId, profileId)
      WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_corporateRoleAssignments_user
      ON corporateRoleAssignments(userId, status);

    CREATE TABLE IF NOT EXISTS corporateRoleDelegations (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL CHECK(profileId IN (
        'manager-core',
        'manager-coordinator',
        'manager-flow-administrator',
        'manager-account',
        'manager-security',
        'manager-resource',
        'manager-encryption',
        'manager-environment',
        'manager-email',
        'manager-notification',
        'manager-support'
      )),
      delegatedByUserId TEXT NOT NULL,
      recipientUserId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'accepted', 'rejected', 'withdrawn', 'renounced'
      )),
      assignmentId TEXT,
      createdAt INTEGER NOT NULL,
      respondedAt INTEGER,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(delegatedByUserId) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(recipientUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assignmentId) REFERENCES corporateRoleAssignments(id) ON DELETE SET NULL,
      CHECK(delegatedByUserId <> recipientUserId)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_corporateRoleDelegations_pending
      ON corporateRoleDelegations(recipientUserId, profileId)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_corporateRoleDelegations_recipient
      ON corporateRoleDelegations(recipientUserId, status, createdAt DESC);

    CREATE TABLE IF NOT EXISTS managerTerminalAccess (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      accessMode TEXT NOT NULL CHECK(accessMode IN ('internal', 'external')),
      credentialHash TEXT NOT NULL UNIQUE,
      terminalSessionHash TEXT UNIQUE,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER,
      lastActivityAt INTEGER NOT NULL,
      lastHeartbeatAt INTEGER NOT NULL,
      consumedAt INTEGER,
      terminalSessionExpiresAt INTEGER,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_managerTerminalAccess_user
      ON managerTerminalAccess(userId, expiresAt);
    CREATE INDEX IF NOT EXISTS idx_managerTerminalAccess_session
      ON managerTerminalAccess(terminalSessionHash, terminalSessionExpiresAt);

    CREATE TABLE IF NOT EXISTS managerOrganizationalUnits (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('department', 'workgroup')),
      parentUnitId TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      createdByUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(parentUnitId) REFERENCES managerOrganizationalUnits(id) ON DELETE SET NULL,
      FOREIGN KEY(createdByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_managerOrganizationalUnits_parent
      ON managerOrganizationalUnits(parentUnitId, status);

    CREATE TABLE IF NOT EXISTS managerOrganizationalMemberships (
      id TEXT PRIMARY KEY,
      unitId TEXT NOT NULL,
      userId TEXT NOT NULL,
      membershipRole TEXT NOT NULL DEFAULT 'member' CHECK(membershipRole IN ('lead', 'member')),
      assignedByUserId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(unitId) REFERENCES managerOrganizationalUnits(id) ON DELETE CASCADE,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(assignedByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_managerOrganizationalMemberships_active
      ON managerOrganizationalMemberships(unitId, userId)
      WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_managerOrganizationalMemberships_user
      ON managerOrganizationalMemberships(userId, status);

    CREATE TABLE IF NOT EXISTS managerTemporaryPermissions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      profileId TEXT NOT NULL CHECK(profileId IN (
        'manager-core',
        'manager-coordinator',
        'manager-flow-administrator',
        'manager-account',
        'manager-security',
        'manager-resource',
        'manager-encryption',
        'manager-environment',
        'manager-email',
        'manager-notification',
        'manager-support'
      )),
      unitId TEXT,
      accessMode TEXT NOT NULL DEFAULT 'any' CHECK(accessMode IN ('internal', 'external', 'any')),
      grantedByUserId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      startsAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL CHECK(expiresAt > startsAt),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(unitId) REFERENCES managerOrganizationalUnits(id) ON DELETE CASCADE,
      FOREIGN KEY(grantedByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_managerTemporaryPermissions_user
      ON managerTemporaryPermissions(userId, status, expiresAt);
    CREATE INDEX IF NOT EXISTS idx_managerTemporaryPermissions_unit
      ON managerTemporaryPermissions(unitId, status, expiresAt);
  `);

  const managerTerminalColumns = sqliteDb
    .prepare("PRAGMA table_info(managerTerminalAccess)")
    .all() as Array<{ name: string }>;
  if (
    !managerTerminalColumns.some((column) => column.name === "lastHeartbeatAt")
  ) {
    sqliteDb.exec(
      "ALTER TABLE managerTerminalAccess ADD COLUMN lastHeartbeatAt INTEGER NOT NULL DEFAULT 0",
    );
    sqliteDb.exec(
      "UPDATE managerTerminalAccess SET lastHeartbeatAt = lastActivityAt WHERE lastHeartbeatAt = 0",
    );
  }
  if (
    !managerTerminalColumns.some((column) => column.name === "scopeProfileId")
  ) {
    sqliteDb.exec(
      "ALTER TABLE managerTerminalAccess ADD COLUMN scopeProfileId TEXT",
    );
  }
  if (
    !managerTerminalColumns.some(
      (column) => column.name === "allowTemporaryPermissions",
    )
  ) {
    sqliteDb.exec(
      "ALTER TABLE managerTerminalAccess ADD COLUMN allowTemporaryPermissions INTEGER NOT NULL DEFAULT 0 CHECK(allowTemporaryPermissions IN (0, 1))",
    );
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

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS platformOperators (
      userId TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source = 'controlled_provisioning'),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_platformOperators_status
      ON platformOperators(status, userId);

    CREATE TABLE IF NOT EXISTS companyStaffProfiles (
      userId TEXT PRIMARY KEY,
      position TEXT NOT NULL CHECK(position IN (
        'platform_head',
        'area_head',
        'team_lead',
        'staff',
        'external_collaborator'
      )),
      reportsToUserId TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      appointedByUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reportsToUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(appointedByUserId) REFERENCES users(id) ON DELETE RESTRICT,
      CHECK(reportsToUserId IS NULL OR reportsToUserId <> userId)
    );
    CREATE INDEX IF NOT EXISTS idx_companyStaffProfiles_directory
      ON companyStaffProfiles(status, position, userId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companyStaffProfiles_active_head
      ON companyStaffProfiles(position)
      WHERE position = 'platform_head' AND status = 'active';

    CREATE TABLE IF NOT EXISTS umfSupportStaff (
      userId TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('director', 'agent')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      approvedByUserId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      revokedAt INTEGER,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(approvedByUserId) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_umfSupportStaff_status
      ON umfSupportStaff(status, role, userId);

    CREATE TABLE IF NOT EXISTS umfSupportAccessRequests (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      lastName TEXT NOT NULL,
      locale TEXT NOT NULL CHECK(locale IN ('es', 'en', 'de', 'de-CH')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'activated', 'expired')),
      activationCodeHash TEXT,
      activationAttempts INTEGER NOT NULL DEFAULT 0 CHECK(activationAttempts >= 0),
      activationExpiresAt INTEGER,
      reviewedByUserId TEXT,
      reviewedAt INTEGER,
      activatedUserId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(reviewedByUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(activatedUserId) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_umfSupportAccessRequests_open_email
      ON umfSupportAccessRequests(email)
      WHERE status IN ('pending', 'approved');
    CREATE INDEX IF NOT EXISTS idx_umfSupportAccessRequests_status
      ON umfSupportAccessRequests(status, createdAt DESC);

    CREATE TABLE IF NOT EXISTS umfSupportTickets (
      id TEXT PRIMARY KEY,
      publicId TEXT NOT NULL UNIQUE,
      requesterUserId TEXT,
      requesterEmail TEXT NOT NULL,
      requesterName TEXT NOT NULL,
      organizationName TEXT NOT NULL DEFAULT '',
      assigneeUserId TEXT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('account', 'billing', 'privacy', 'technical', 'security', 'general')),
      priority TEXT NOT NULL CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed')),
      source TEXT NOT NULL CHECK(source IN ('web', 'email', 'internal')),
      firstResponseDueAt INTEGER NOT NULL,
      resolutionDueAt INTEGER NOT NULL,
      firstRespondedAt INTEGER,
      resolvedAt INTEGER,
      closedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(requesterUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(assigneeUserId) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_umfSupportTickets_queue
      ON umfSupportTickets(status, priority, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_umfSupportTickets_requester
      ON umfSupportTickets(requesterEmail, updatedAt DESC);

    CREATE TABLE IF NOT EXISTS umfSupportMessages (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      authorUserId TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'internal')),
      channel TEXT NOT NULL CHECK(channel IN ('web', 'email')),
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      body TEXT NOT NULL,
      deliveryId TEXT,
      inboundMessageIdHash TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(ticketId) REFERENCES umfSupportTickets(id) ON DELETE CASCADE,
      FOREIGN KEY(authorUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(deliveryId) REFERENCES emailDeliveries(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_umfSupportMessages_inbound_id
      ON umfSupportMessages(inboundMessageIdHash)
      WHERE inboundMessageIdHash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_umfSupportMessages_mailbox
      ON umfSupportMessages(direction, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_umfSupportMessages_ticket
      ON umfSupportMessages(ticketId, createdAt);

    CREATE TABLE IF NOT EXISTS facilityCommercialSubscriptions (
      facilityId TEXT PRIMARY KEY,
      stripeLivemode INTEGER NOT NULL DEFAULT 0 CHECK(stripeLivemode IN (0, 1)),
      stripeCustomerId TEXT UNIQUE,
      stripeSubscriptionId TEXT UNIQUE,
      stripeCheckoutSessionId TEXT UNIQUE,
      stripePriceId TEXT,
      planKey TEXT CHECK(planKey IS NULL OR planKey IN ('monthly', 'annual')),
      status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN (
        'inactive', 'checkout_pending', 'trialing', 'active', 'past_due',
        'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired'
      )),
      currentPeriodEnd INTEGER,
      cancelAtPeriodEnd INTEGER NOT NULL DEFAULT 0 CHECK(cancelAtPeriodEnd IN (0, 1)),
      billingAttention TEXT NOT NULL DEFAULT 'none' CHECK(billingAttention IN (
        'none', 'payment_failed', 'payment_action_required',
        'invoice_finalization_failed'
      )),
      lastInvoiceEventAt INTEGER,
      lastReconciledAt INTEGER,
      lastStripeEventCreatedAt INTEGER,
      lastStripeEventId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_facilityCommercialSubscriptions_status
      ON facilityCommercialSubscriptions(status, currentPeriodEnd);

    CREATE TABLE IF NOT EXISTS stripeWebhookEvents (
      eventId TEXT PRIMARY KEY,
      eventType TEXT NOT NULL,
      facilityId TEXT,
      stripeCreatedAt INTEGER NOT NULL,
      livemode INTEGER NOT NULL CHECK(livemode IN (0, 1)),
      receivedAt INTEGER NOT NULL,
      processedAt INTEGER NOT NULL,
      FOREIGN KEY(facilityId) REFERENCES facilityProfiles(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stripeWebhookEvents_received
      ON stripeWebhookEvents(receivedAt DESC);
  `);

  const subscriptionColumns = sqliteDb
    .prepare("PRAGMA table_info(facilityCommercialSubscriptions)")
    .all() as Array<{ name: string }>;
  if (
    !subscriptionColumns.some(
      (column) => column.name === "stripeCheckoutSessionId",
    )
  ) {
    sqliteDb.exec(
      "ALTER TABLE facilityCommercialSubscriptions ADD COLUMN stripeCheckoutSessionId TEXT",
    );
    sqliteDb.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_facilityCommercialSubscriptions_checkout ON facilityCommercialSubscriptions(stripeCheckoutSessionId)",
    );
  }
  if (!subscriptionColumns.some((column) => column.name === "stripeLivemode")) {
    sqliteDb.exec(
      "ALTER TABLE facilityCommercialSubscriptions ADD COLUMN stripeLivemode INTEGER NOT NULL DEFAULT 0 CHECK(stripeLivemode IN (0, 1))",
    );
  }
  if (
    !subscriptionColumns.some((column) => column.name === "billingAttention")
  ) {
    sqliteDb.exec(
      "ALTER TABLE facilityCommercialSubscriptions ADD COLUMN billingAttention TEXT NOT NULL DEFAULT 'none' CHECK(billingAttention IN ('none', 'payment_failed', 'payment_action_required', 'invoice_finalization_failed'))",
    );
  }
  if (
    !subscriptionColumns.some((column) => column.name === "lastInvoiceEventAt")
  ) {
    sqliteDb.exec(
      "ALTER TABLE facilityCommercialSubscriptions ADD COLUMN lastInvoiceEventAt INTEGER",
    );
  }
  if (
    !subscriptionColumns.some((column) => column.name === "lastReconciledAt")
  ) {
    sqliteDb.exec(
      "ALTER TABLE facilityCommercialSubscriptions ADD COLUMN lastReconciledAt INTEGER",
    );
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
  enforceActiveFacilityBoundary(sqliteDb);

  console.log("Database initialized successfully");
}

export async function closeDatabase(): Promise<void> {
  if (postgresRuntime) {
    await postgresRuntime.close();
    return;
  }
  requireSqliteDatabase().close();
}

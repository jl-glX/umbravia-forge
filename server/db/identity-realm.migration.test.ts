import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("SQLite identity realm migration", () => {
  let directory: string;
  let database: typeof import("./client.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "identity-realm-migration-"));
    const legacy = new Database(join(directory, "database.sqlite"));
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member',
        createdAt INTEGER NOT NULL
      );
      INSERT INTO users (id, email, name, password, role, createdAt)
      VALUES ('legacy-commercial', 'shared-migration@example.test', 'Legacy', 'not-used', 'member', 1);
      CREATE TABLE emailChangeChallenges (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL UNIQUE,
        newEmail TEXT NOT NULL UNIQUE,
        codeHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO emailChangeChallenges (
        id, userId, newEmail, codeHash, createdAt, expiresAt, attempts
      ) VALUES (
        'legacy-change', 'legacy-commercial', 'next@example.test', 'hash', 1, 2, 0
      );
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
      INSERT INTO emailDeliveries (
        id, userId, kind, recipient, locale, payloadEncrypted, status,
        attempts, maxAttempts, nextAttemptAt, createdAt, updatedAt, expiresAt
      ) VALUES
        ('legacy-commercial-delivery', 'legacy-commercial', 'email_verification', 'commercial@example.test', 'es', 'encrypted', 'queued', 0, 5, 1, 1, 1, 100),
        ('legacy-support-delivery', NULL, 'support_update', 'support@example.test', 'es', 'encrypted', 'queued', 0, 5, 1, 1, 1, 100);
      CREATE TABLE umfSupportTickets (
        id TEXT PRIMARY KEY,
        publicId TEXT NOT NULL UNIQUE,
        requesterUserId TEXT,
        requesterEmail TEXT NOT NULL,
        requesterName TEXT NOT NULL,
        organizationName TEXT NOT NULL DEFAULT '',
        assigneeUserId TEXT,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        firstResponseDueAt INTEGER NOT NULL,
        resolutionDueAt INTEGER NOT NULL,
        firstRespondedAt INTEGER,
        resolvedAt INTEGER,
        closedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO umfSupportTickets (
        id, publicId, requesterEmail, requesterName, subject, category,
        priority, status, source, firstResponseDueAt, resolutionDueAt,
        createdAt, updatedAt
      ) VALUES (
        'legacy-ticket', 'UFS-LEGACY', 'requester@example.test', 'Requester',
        'Legacy', 'general', 'normal', 'open', 'web', 10, 20, 1, 1
      );
      CREATE TABLE umfSupportMessages (
        id TEXT PRIMARY KEY,
        ticketId TEXT NOT NULL,
        authorUserId TEXT,
        direction TEXT NOT NULL,
        channel TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        body TEXT NOT NULL,
        deliveryId TEXT,
        inboundMessageIdHash TEXT,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO umfSupportMessages (
        id, ticketId, direction, channel, sender, recipient, body, deliveryId,
        createdAt
      ) VALUES (
        'legacy-message', 'legacy-ticket', 'outbound', 'email',
        'support@example.test', 'requester@example.test', 'encrypted',
        'legacy-support-delivery', 1
      );
      CREATE TABLE umfSupportAccessRequests (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        lastName TEXT NOT NULL,
        locale TEXT NOT NULL CHECK(locale IN ('es', 'en', 'de', 'de-CH')),
        status TEXT NOT NULL,
        activationCodeHash TEXT,
        activationAttempts INTEGER NOT NULL DEFAULT 0,
        activationExpiresAt INTEGER,
        reviewedByUserId TEXT,
        reviewedAt INTEGER,
        activatedUserId TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO umfSupportAccessRequests (
        id, email, name, lastName, locale, status, activationAttempts,
        createdAt, updatedAt
      ) VALUES (
        'legacy-head-request', 'head@example.test', 'Legacy', 'Head', 'es',
        'pending', 0, 1, 1
      );
      CREATE TABLE umfSupportAccessCredentials (
        requestId TEXT PRIMARY KEY,
        passwordHash TEXT NOT NULL,
        activationKind TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL
      );
      INSERT INTO umfSupportAccessCredentials (
        requestId, passwordHash, activationKind, createdAt, expiresAt
      ) VALUES (
        'legacy-head-request', 'legacy-hash', 'designated_head', 1, 100
      );
    `);
    legacy.close();

    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves the legacy account as commercial and permits the same email corporately", async () => {
    const commercial = await database.db
      .selectFrom("users")
      .select(["id", "identityRealm"])
      .where("id", "=", "legacy-commercial")
      .executeTakeFirstOrThrow();
    expect(commercial).toEqual({
      id: "legacy-commercial",
      identityRealm: "commercial",
    });

    await expect(
      database.db
        .insertInto("users")
        .values({
          id: "new-corporate",
          email: "shared-migration@example.test",
          identityRealm: "corporate_support",
          phone: null,
          name: "Corporate",
          avatarDataUrl: "",
          password: "not-used",
          role: "admin",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: 2,
        })
        .execute(),
    ).resolves.toBeDefined();
  });

  it("scopes pending email changes to the migrated account realm", async () => {
    await expect(
      database.db
        .selectFrom("emailChangeChallenges")
        .select(["userId", "identityRealm", "newEmail"])
        .where("id", "=", "legacy-change")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      userId: "legacy-commercial",
      identityRealm: "commercial",
      newEmail: "next@example.test",
    });
  });

  it("marks only deliveries with legacy UMF Support evidence as support", async () => {
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["id", "platformScope"])
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([
      { id: "legacy-commercial-delivery", platformScope: "commercial" },
      { id: "legacy-support-delivery", platformScope: "support" },
    ]);
  });

  it("moves legacy pre-enrolment metadata onto the role request", async () => {
    await expect(
      database.db
        .selectFrom("umfSupportAccessRequests")
        .select(["requestedRole", "activationKind"])
        .where("id", "=", "legacy-head-request")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      requestedRole: "agent",
      activationKind: "designated_head",
    });
  });
});

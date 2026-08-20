import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("booking reputation tenant migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("quarantines legacy global reputation outside active facilities", async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-reputation-v17-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.db
      .insertInto("users")
      .values({
        id: "legacy-reputation-user",
        email: "legacy-reputation@example.com",
        phone: null,
        name: "Legacy reputation",
        avatarDataUrl: "",
        password: "synthetic-hash",
        role: "member",
        sessionIdleTimeoutMinutes: 60,
        createdAt: 10,
      })
      .execute();
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TABLE bookingReputationEvents;
      DROP TABLE bookingReputations;
      CREATE TABLE bookingReputations (
        userId TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        penaltyUntil INTEGER,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE bookingReputationEvents (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        bookingId TEXT,
        type TEXT NOT NULL,
        pointsDelta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO bookingReputations
        (userId, score, penaltyUntil, updatedAt)
      VALUES ('legacy-reputation-user', 72, NULL, 20);
      INSERT INTO bookingReputationEvents
        (id, userId, bookingId, type, pointsDelta, reason, createdAt)
      VALUES (
        'legacy-event',
        'legacy-reputation-user',
        NULL,
        'manual_adjustment',
        -28,
        'Legacy adjustment',
        20
      );
    `);
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();

    await expect(
      migratedDatabase.db
        .selectFrom("bookingReputations")
        .select(["facilityId", "userId", "score"])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facilityId: "legacy-import-quarantine",
      userId: "legacy-reputation-user",
      score: 72,
    });
    await expect(
      migratedDatabase.db
        .selectFrom("bookingReputationEvents")
        .select(["facilityId", "id", "reason"])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      facilityId: "legacy-import-quarantine",
      id: "legacy-event",
      reason: "Legacy adjustment",
    });
  });
});

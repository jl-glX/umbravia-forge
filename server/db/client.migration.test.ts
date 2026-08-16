import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("legacy booking migration", () => {
  let directory: string;
  let database: typeof import("./client.js");

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-booking-migration-"),
    );
    const legacy = new Database(join(directory, "database.sqlite"));
    legacy.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        cancelledAt INTEGER
      );
      INSERT INTO bookings VALUES
        ('legacy-waitlist', 'legacy-class', 'legacy-user', 'waitlist', 1, NULL),
        ('legacy-confirmed-kept', 'legacy-class', 'legacy-user', 'confirmed', 2, NULL),
        ('legacy-confirmed-duplicate', 'legacy-class', 'legacy-user', 'confirmed', 3, NULL);
      CREATE TABLE waitlistEntries (
        id TEXT PRIMARY KEY,
        classId TEXT NOT NULL,
        userId TEXT NOT NULL,
        position INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        promotedAt INTEGER,
        UNIQUE(classId, userId)
      );
      INSERT INTO waitlistEntries VALUES
        ('legacy-waitlist-entry', 'legacy-class', 'legacy-user', 1, 1, NULL);
    `);
    legacy.close();

    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps one deterministic active booking and cancels legacy duplicates", async () => {
    const bookings = await database.db
      .selectFrom("bookings")
      .select(["id", "status", "cancelledAt"])
      .orderBy("id")
      .execute();
    const active = bookings.filter((booking) =>
      ["confirmed", "waitlist"].includes(booking.status),
    );
    const cancelled = bookings.filter(
      (booking) => booking.status === "cancelled",
    );

    expect(active).toEqual([
      {
        id: "legacy-confirmed-kept",
        status: "confirmed",
        cancelledAt: null,
      },
    ]);
    expect(cancelled).toHaveLength(2);
    expect(cancelled.every((booking) => booking.cancelledAt !== null)).toBe(
      true,
    );
    expect(
      await database.db
        .selectFrom("waitlistEntries")
        .select("id")
        .where("id", "=", "legacy-waitlist-entry")
        .executeTakeFirst(),
    ).toBeUndefined();

    const lifecycleRows = await database.db
      .selectFrom("bookingLifecycles")
      .select(["bookingId", "lifecycleStatus", "attendanceIntention"])
      .orderBy("bookingId")
      .execute();
    expect(lifecycleRows).toHaveLength(3);
    expect(lifecycleRows).toContainEqual({
      bookingId: "legacy-confirmed-kept",
      lifecycleStatus: "confirmation_pending",
      attendanceIntention: "unanswered",
    });
  });

  it("applies the active-booking uniqueness constraint after reconciliation", async () => {
    await expect(
      database.db
        .insertInto("bookings")
        .values({
          id: "new-active-duplicate",
          activitySessionId: "legacy-class",
          userId: "legacy-user",
          status: "waitlist",
          createdAt: 4,
          cancelledAt: null,
        })
        .execute(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

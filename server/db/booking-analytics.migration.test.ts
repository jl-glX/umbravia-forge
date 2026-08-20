import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("booking analytics event migration", () => {
  let directory: string;
  let database: typeof import("./client.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-booking-analytics-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();

    const now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
    await database.db
      .insertInto("users")
      .values({
        id: "analytics-migration-user",
        email: "analytics-migration@example.com",
        phone: null,
        name: "Analytics Migration",
        avatarDataUrl: "",
        password: "not-used",
        role: "member",
        sessionIdleTimeoutMinutes: 10_080,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "analytics-migration-class",
        facilityId: "facility-alpha",
        name: "Migration class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 8,
        scheduledAt: now + 86_400_000,
      })
      .execute();
    await database.db
      .insertInto("bookings")
      .values({
        id: "analytics-migration-booking",
        activitySessionId: "analytics-migration-class",
        userId: "analytics-migration-user",
        status: "confirmed",
        createdAt: now,
        cancelledAt: null,
      })
      .execute();
    await database.db
      .insertInto("bookingLifecycles")
      .values({
        bookingId: "analytics-migration-booking",
        lifecycleStatus: "confirmation_pending",
        attendanceIntention: "unanswered",
        intentionUpdatedAt: null,
        confirmedAt: null,
        lastReminderAt: null,
        reminderCount: 0,
        updatedAt: now,
      })
      .execute();

    await database.db.schema.dropTable("bookingAnalyticsEvents").execute();
    await database.closeDatabase();
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("imports one honest current-state baseline without inventing transitions", async () => {
    expect(
      await database.db
        .selectFrom("bookingAnalyticsEvents")
        .select([
          "bookingId",
          "eventType",
          "source",
          "fromState",
          "toState",
          "activityName",
          "capacitySnapshot",
        ])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      bookingId: "analytics-migration-booking",
      eventType: "baseline_import",
      source: "baseline",
      fromState: null,
      toState: "confirmation_pending",
      activityName: "Migration class",
      capacitySnapshot: 8,
    });
  });

  it("anonymizes the subject when the account and booking are removed", async () => {
    await database.db
      .deleteFrom("bookingLifecycles")
      .where("bookingId", "=", "analytics-migration-booking")
      .execute();
    await database.db
      .deleteFrom("bookings")
      .where("id", "=", "analytics-migration-booking")
      .execute();
    await database.db
      .deleteFrom("users")
      .where("id", "=", "analytics-migration-user")
      .execute();

    expect(
      await database.db
        .selectFrom("bookingAnalyticsEvents")
        .select(["bookingId", "memberUserId", "activityName"])
        .executeTakeFirstOrThrow(),
    ).toEqual({
      bookingId: null,
      memberUserId: null,
      activityName: "Migration class",
    });
  });
});

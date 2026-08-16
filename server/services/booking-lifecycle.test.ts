import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("attendance intention, reputation and dynamic waitlist", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let booking: typeof import("./booking.js");
  let reputation: typeof import("./booking-reputation.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-booking-lifecycle-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    booking = await import("./booking.js");
    reputation = await import("./booking-reputation.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values(
        [
          "holder",
          "first-waiting",
          "reliable-waiting",
          "late-member",
          "reminder-member",
          "attendance-member",
          "expiry-holder",
          "expiry-first",
          "expiry-second",
          "farm-member",
          "penalty-member",
          "neutral-member",
          "batch-holder-a",
          "batch-holder-b",
          "batch-wait-a",
          "batch-wait-b",
          "batch-wait-c",
          "batch-wait-d",
        ].map((id) => ({
          id,
          email: `${id}@example.com`,
          phone: null,
          name: id,
          avatarDataUrl: "",
          password: "not-used",
          role: "member" as const,
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        })),
      )
      .execute();
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps an unanswered booking neutral and stores explicit intentions", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "intention-class",
        name: "Intention class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 4,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    const created = await booking.bookClass("intention-class", "holder");
    const initial = await database.db
      .selectFrom("bookingLifecycles")
      .selectAll()
      .where("bookingId", "=", created.bookingId)
      .executeTakeFirstOrThrow();
    expect(initial.attendanceIntention).toBe("unanswered");
    expect(initial.lifecycleStatus).toBe("confirmation_pending");

    await booking.setAttendanceIntention(
      created.bookingId,
      "holder",
      "uncertain",
    );
    const uncertain = await reputation.getBookingReputation("holder");
    expect(uncertain.score).toBe(99);

    await booking.setAttendanceIntention(created.bookingId, "holder", "yes");
    const confirmed = await database.db
      .selectFrom("bookingLifecycles")
      .selectAll()
      .where("bookingId", "=", created.bookingId)
      .executeTakeFirstOrThrow();
    expect(confirmed).toMatchObject({
      lifecycleStatus: "confirmed",
      attendanceIntention: "yes",
    });
    expect(
      await database.db
        .selectFrom("bookingAnalyticsEvents")
        .select(["eventType", "fromState", "toState", "source"])
        .where("bookingId", "=", created.bookingId)
        .orderBy("occurredAt", "asc")
        .execute(),
    ).toEqual([
      {
        eventType: "booking_created",
        fromState: null,
        toState: "confirmation_pending",
        source: "live",
      },
      {
        eventType: "attendance_intention_changed",
        fromState: "confirmation_pending",
        toState: "uncertain",
        source: "live",
      },
      {
        eventType: "attendance_intention_changed",
        fromState: "uncertain",
        toState: "confirmed",
        source: "live",
      },
    ]);
  });

  it("promotes the more reliable eligible member instead of using FIFO alone", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "dynamic-waitlist-class",
        name: "Dynamic waitlist",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 1,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    const holder = await booking.bookClass("dynamic-waitlist-class", "holder");
    await booking.bookClass("dynamic-waitlist-class", "first-waiting");
    await reputation.adjustBookingReputation({
      userId: "first-waiting",
      facilityId: "primary",
      pointsDelta: -60,
      reason: "Test-only reduced priority",
    });
    const reliable = await booking.bookClass(
      "dynamic-waitlist-class",
      "reliable-waiting",
    );

    await booking.cancelBooking(holder.bookingId, "holder");
    const promoted = await database.db
      .selectFrom("bookings")
      .select("status")
      .where("id", "=", reliable.bookingId)
      .executeTakeFirstOrThrow();
    expect(promoted.status).toBe("confirmed");

    const lifecycle = await database.db
      .selectFrom("bookingLifecycles")
      .select("lifecycleStatus")
      .where("bookingId", "=", reliable.bookingId)
      .executeTakeFirstOrThrow();
    expect(lifecycle.lifecycleStatus).toBe("promoted");
    expect(
      await database.db
        .selectFrom("bookingAnalyticsEvents")
        .select(["eventType", "fromState", "toState"])
        .where("bookingId", "=", reliable.bookingId)
        .orderBy("occurredAt", "asc")
        .execute(),
    ).toEqual([
      {
        eventType: "booking_created",
        fromState: null,
        toState: "waitlisted",
      },
      {
        eventType: "waitlist_promoted",
        fromState: "waitlisted",
        toState: "promoted",
      },
    ]);
  });

  it("applies a temporary and explainable late-cancellation penalty", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "late-class",
        name: "Late class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 4,
        scheduledAt: Date.now() + 30 * 60_000,
      })
      .execute();
    const created = await booking.bookClass("late-class", "late-member");
    await booking.cancelBooking(created.bookingId, "late-member");
    const summary = await reputation.getBookingReputation("late-member");
    expect(summary).toMatchObject({
      score: 88,
      penaltyActive: true,
      tier: "reduced",
    });
    expect(summary.events[0]).toMatchObject({
      type: "cancelled_late",
      pointsDelta: -12,
    });
  });

  it("keeps cancellations between the configured thresholds neutral", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "neutral-cancellation-class",
        name: "Neutral cancellation",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 2,
        scheduledAt: Date.now() + 120 * 60_000,
      })
      .execute();
    const created = await booking.bookClass(
      "neutral-cancellation-class",
      "neutral-member",
    );
    await booking.cancelBooking(created.bookingId, "neutral-member");
    const summary = await reputation.getBookingReputation("neutral-member");
    expect(summary).toMatchObject({ score: 100, penaltyActive: false });
    expect(summary.events[0]).toMatchObject({
      type: "cancelled_neutral",
      pointsDelta: 0,
    });
  });

  it("rate-limits reminders and reverses an absence after an accepted justification", async () => {
    const reminderBooking = await booking.bookClass(
      "intention-class",
      "reminder-member",
    );
    await expect(
      booking.recordBookingReminder(reminderBooking.bookingId),
    ).resolves.toEqual({ recordedAt: expect.any(Number) });
    await expect(
      booking.recordBookingReminder(reminderBooking.bookingId),
    ).rejects.toThrow("recorded recently");

    const now = Date.now();
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "past-attendance-class",
        name: "Past class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 4,
        scheduledAt: now - 60_000,
      })
      .execute();
    await database.db
      .insertInto("bookings")
      .values({
        id: "past-attendance-booking",
        activitySessionId: "past-attendance-class",
        userId: "attendance-member",
        status: "confirmed",
        createdAt: now - 86_400_000,
        cancelledAt: null,
      })
      .execute();
    await database.db
      .insertInto("bookingLifecycles")
      .values({
        bookingId: "past-attendance-booking",
        lifecycleStatus: "confirmation_pending",
        attendanceIntention: "unanswered",
        intentionUpdatedAt: null,
        confirmedAt: null,
        lastReminderAt: null,
        reminderCount: 0,
        updatedAt: now,
      })
      .execute();

    await booking.markBookingAttendance("past-attendance-booking", "absent");
    expect(
      await reputation.getBookingReputation("attendance-member"),
    ).toMatchObject({ score: 80, penaltyActive: true });
    await booking.markBookingAttendance("past-attendance-booking", "excused");
    expect(
      await reputation.getBookingReputation("attendance-member"),
    ).toMatchObject({ score: 100, penaltyActive: false });
    expect(
      await database.db
        .selectFrom("bookingAnalyticsEvents")
        .select(["eventType", "fromState", "toState"])
        .where("bookingId", "=", "past-attendance-booking")
        .orderBy("occurredAt", "asc")
        .execute(),
    ).toEqual([
      {
        eventType: "attendance_recorded",
        fromState: "confirmation_pending",
        toState: "absent",
      },
      {
        eventType: "attendance_corrected",
        fromState: "absent",
        toState: "excused",
      },
    ]);
  });

  it("rejects intentions and attendance for a member who is still waitlisted", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "waitlist-guard-class",
        name: "Waitlist guard",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 1,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    await booking.bookClass("waitlist-guard-class", "holder");
    const waiting = await booking.bookClass(
      "waitlist-guard-class",
      "expiry-first",
    );
    expect(waiting.status).toBe("waitlist");
    await expect(
      booking.setAttendanceIntention(waiting.bookingId, "expiry-first", "yes"),
    ).rejects.toThrow("requires a confirmed booking");
    await expect(
      booking.markBookingAttendance(waiting.bookingId, "absent"),
    ).rejects.toThrow("Active booking not found");
  });

  it("expires an unconfirmed promotion and immediately offers the place to the next member", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "promotion-expiry-class",
        name: "Promotion expiry",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 1,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    const holder = await booking.bookClass(
      "promotion-expiry-class",
      "expiry-holder",
    );
    const first = await booking.bookClass(
      "promotion-expiry-class",
      "expiry-first",
    );
    const second = await booking.bookClass(
      "promotion-expiry-class",
      "expiry-second",
    );
    await booking.cancelBooking(holder.bookingId, "expiry-holder");
    await database.db
      .updateTable("waitlistEntries")
      .set({ promotionExpiresAt: Date.now() - 1 })
      .where("activitySessionId", "=", "promotion-expiry-class")
      .where("userId", "=", "expiry-first")
      .execute();

    await expect(
      booking.setAttendanceIntention(first.bookingId, "expiry-first", "yes"),
    ).rejects.toThrow("deadline has expired");

    const rows = await database.db
      .selectFrom("bookings")
      .select(["id", "status"])
      .where("activitySessionId", "=", "promotion-expiry-class")
      .execute();
    expect(rows.find((row) => row.id === first.bookingId)?.status).toBe(
      "cancelled",
    );
    expect(rows.find((row) => row.id === second.bookingId)?.status).toBe(
      "confirmed",
    );
    expect(
      await database.db
        .selectFrom("bookingLifecycles")
        .select("lifecycleStatus")
        .where("bookingId", "=", first.bookingId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ lifecycleStatus: "promotion_expired" });
  });

  it("does not let repeated rebooking farm on-time cancellation points", async () => {
    await reputation.adjustBookingReputation({
      userId: "farm-member",
      facilityId: "primary",
      pointsDelta: -10,
      reason: "Test baseline adjustment",
    });
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "anti-farming-class",
        name: "Anti farming",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 2,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    const first = await booking.bookClass("anti-farming-class", "farm-member");
    await booking.cancelBooking(first.bookingId, "farm-member");
    const second = await booking.bookClass("anti-farming-class", "farm-member");
    await booking.cancelBooking(second.bookingId, "farm-member");

    const summary = await reputation.getBookingReputation("farm-member");
    expect(summary.score).toBe(91);
    expect(
      summary.events
        .filter((event) => event.type === "cancelled_on_time")
        .map((event) => event.pointsDelta)
        .sort(),
    ).toEqual([0, 1]);
  });

  it("refills every place released by several expired promotions", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "batch-expiry-class",
        name: "Batch expiry",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 2,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
    const holderA = await booking.bookClass(
      "batch-expiry-class",
      "batch-holder-a",
    );
    const holderB = await booking.bookClass(
      "batch-expiry-class",
      "batch-holder-b",
    );
    for (const userId of [
      "batch-wait-a",
      "batch-wait-b",
      "batch-wait-c",
      "batch-wait-d",
    ]) {
      await booking.bookClass("batch-expiry-class", userId);
    }
    await booking.cancelBooking(holderA.bookingId, "batch-holder-a");
    await booking.cancelBooking(holderB.bookingId, "batch-holder-b");
    await database.db
      .updateTable("waitlistEntries")
      .set({ promotionExpiresAt: Date.now() - 1 })
      .where("activitySessionId", "=", "batch-expiry-class")
      .where("promotedAt", "is not", null)
      .execute();

    const availability =
      await booking.getClassWithAvailability("batch-expiry-class");
    expect(availability).toMatchObject({
      bookedCount: 2,
      availablePlaces: 0,
      waitlistCount: 0,
    });
    const confirmed = await database.db
      .selectFrom("bookings")
      .select("userId")
      .where("activitySessionId", "=", "batch-expiry-class")
      .where("status", "=", "confirmed")
      .orderBy("userId")
      .execute();
    expect(confirmed.map((row) => row.userId)).toEqual([
      "batch-wait-c",
      "batch-wait-d",
    ]);
  });

  it("keeps unrelated penalties when a different absence is excused", async () => {
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "independent-late-class",
        name: "Independent late class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 2,
        scheduledAt: Date.now() + 30 * 60_000,
      })
      .execute();
    const late = await booking.bookClass(
      "independent-late-class",
      "penalty-member",
    );
    await booking.cancelBooking(late.bookingId, "penalty-member");

    const now = Date.now();
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "independent-absence-class",
        name: "Independent absence class",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 2,
        scheduledAt: now - 60_000,
      })
      .execute();
    await database.db
      .insertInto("bookings")
      .values({
        id: "independent-absence-booking",
        activitySessionId: "independent-absence-class",
        userId: "penalty-member",
        status: "confirmed",
        createdAt: now - 86_400_000,
        cancelledAt: null,
      })
      .execute();
    await database.db
      .insertInto("bookingLifecycles")
      .values({
        bookingId: "independent-absence-booking",
        lifecycleStatus: "confirmation_pending",
        attendanceIntention: "unanswered",
        intentionUpdatedAt: null,
        confirmedAt: null,
        lastReminderAt: null,
        reminderCount: 0,
        updatedAt: now,
      })
      .execute();
    await booking.markBookingAttendance(
      "independent-absence-booking",
      "absent",
    );
    await booking.markBookingAttendance(
      "independent-absence-booking",
      "excused",
    );

    expect(
      await reputation.getBookingReputation("penalty-member"),
    ).toMatchObject({ score: 88, penaltyActive: true });
  });
});

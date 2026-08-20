import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("analytics tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let trainerCookie: string;
  let now: number;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-analytics-tenant-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "analytics-secondary",
        slug: "analytics-secondary",
        name: "Analytics Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "analytics-admin",
          email: "analytics-admin@example.com",
          phone: null,
          name: "Analytics Admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("AnalyticsAdminPassword123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "analytics-facility_alpha-member",
          email: "analytics-facility_alpha@example.com",
          phone: null,
          name: "Primary Member",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("PrimaryMemberPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "analytics-secondary-member",
          email: "analytics-secondary@example.com",
          phone: null,
          name: "Secondary Member",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("SecondaryMemberPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "analytics-inactive-member",
          email: "analytics-inactive@example.com",
          phone: null,
          name: "Inactive Member",
          accountStatus: "pending_verification",
          avatarDataUrl: "",
          password: await auth.hashPassword("InactiveMemberPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "analytics-trainer",
          email: "analytics-trainer@example.com",
          phone: null,
          name: "Analytics Trainer",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("AnalyticsTrainerPassword123"),
          role: "trainer",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:analytics-admin",
          facilityId: "facility-alpha",
          userId: "analytics-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "analytics-secondary:analytics-admin",
          facilityId: "analytics-secondary",
          userId: "analytics-admin",
          role: "owner",
          status: "active",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: "facility-alpha:analytics-facility_alpha-member",
          facilityId: "facility-alpha",
          userId: "analytics-facility_alpha-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "analytics-secondary:analytics-secondary-member",
          facilityId: "analytics-secondary",
          userId: "analytics-secondary-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "analytics-secondary:analytics-inactive-member",
          facilityId: "analytics-secondary",
          userId: "analytics-inactive-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "analytics-secondary:analytics-trainer",
          facilityId: "analytics-secondary",
          userId: "analytics-trainer",
          role: "trainer",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("activitySessions")
      .values([
        {
          id: "analytics-facility_alpha-class",
          facilityId: "facility-alpha",
          name: "Primary analytics class",
          description: "",
          trainerId: "analytics-admin",
          trainerName: "Analytics Admin",
          maxCapacity: 10,
          scheduledAt: now + 3_600_000,
        },
        {
          id: "analytics-secondary-class",
          facilityId: "analytics-secondary",
          name: "Secondary analytics class",
          description: "",
          trainerId: "analytics-admin",
          trainerName: "Analytics Admin",
          maxCapacity: 5,
          scheduledAt: now + 7_200_000,
        },
        {
          id: "analytics-trainer-class",
          facilityId: "analytics-secondary",
          name: "Trainer analytics class",
          description: "",
          trainerId: "analytics-trainer",
          trainerName: "Analytics Trainer",
          maxCapacity: 4,
          scheduledAt: now + 10_800_000,
        },
        {
          id: "analytics-trainer-past-class",
          facilityId: "analytics-secondary",
          name: "Trainer analytics class",
          description: "",
          trainerId: "analytics-trainer",
          trainerName: "Analytics Trainer",
          maxCapacity: 4,
          scheduledAt: now - 3_600_000,
        },
      ])
      .execute();
    await database.db
      .insertInto("bookings")
      .values([
        {
          id: "analytics-facility_alpha-booking",
          activitySessionId: "analytics-facility_alpha-class",
          userId: "analytics-facility_alpha-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
        {
          id: "analytics-secondary-booking",
          activitySessionId: "analytics-secondary-class",
          userId: "analytics-secondary-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
        {
          id: "analytics-trainer-booking",
          activitySessionId: "analytics-trainer-class",
          userId: "analytics-secondary-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
        {
          id: "analytics-trainer-past-booking",
          activitySessionId: "analytics-trainer-past-class",
          userId: "analytics-secondary-member",
          status: "confirmed",
          createdAt: now - 7_200_000,
          cancelledAt: null,
        },
      ])
      .execute();
    await database.db
      .insertInto("bookingLifecycles")
      .values({
        bookingId: "analytics-trainer-past-booking",
        lifecycleStatus: "attended",
        attendanceIntention: "yes",
        intentionUpdatedAt: now - 7_200_000,
        confirmedAt: now - 7_200_000,
        lastReminderAt: null,
        reminderCount: 0,
        updatedAt: now - 3_600_000,
      })
      .execute();
    await database.db
      .insertInto("bookingAnalyticsEvents")
      .values([
        {
          id: "analytics-facility_alpha-event",
          deduplicationKey: "test:analytics-facility_alpha-event",
          facilityId: "facility-alpha",
          bookingId: "analytics-facility_alpha-booking",
          activitySessionId: "analytics-facility_alpha-class",
          memberUserId: "analytics-facility_alpha-member",
          trainerUserId: "analytics-admin",
          eventType: "baseline_import",
          source: "baseline",
          fromState: null,
          toState: "confirmation_pending",
          activityName: "Primary analytics class",
          scheduledAt: now + 3_600_000,
          capacitySnapshot: 10,
          occurredAt: now,
          recordedAt: now,
        },
        ...[
          [
            "analytics-secondary-event",
            "analytics-secondary-booking",
            "analytics-secondary-class",
            "analytics-secondary-member",
            "analytics-admin",
            "Secondary analytics class",
            now + 7_200_000,
            5,
          ],
          [
            "analytics-trainer-event",
            "analytics-trainer-booking",
            "analytics-trainer-class",
            "analytics-secondary-member",
            "analytics-trainer",
            "Trainer analytics class",
            now + 10_800_000,
            4,
          ],
          [
            "analytics-trainer-past-event",
            "analytics-trainer-past-booking",
            "analytics-trainer-past-class",
            "analytics-secondary-member",
            "analytics-trainer",
            "Trainer analytics class",
            now - 3_600_000,
            4,
          ],
        ].map(
          ([
            id,
            bookingId,
            activitySessionId,
            memberUserId,
            trainerUserId,
            activityName,
            scheduledAt,
            capacitySnapshot,
          ]) => ({
            id: id as string,
            deduplicationKey: `test:${id}`,
            facilityId: "analytics-secondary",
            bookingId: bookingId as string,
            activitySessionId: activitySessionId as string,
            memberUserId: memberUserId as string,
            trainerUserId: trainerUserId as string,
            eventType: "baseline_import" as const,
            source: "baseline" as const,
            fromState: null,
            toState:
              id === "analytics-trainer-past-event"
                ? "attended"
                : "confirmation_pending",
            activityName: activityName as string,
            scheduledAt: scheduledAt as number,
            capacitySnapshot: capacitySnapshot as number,
            occurredAt: now,
            recordedAt: now,
          }),
        ),
      ])
      .execute();

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "analytics-admin@example.com",
        password: "AnalyticsAdminPassword123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    trainerCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "analytics-trainer@example.com",
        password: "AnalyticsTrainerPassword123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  function secondary(requestBuilder: request.Test) {
    return requestBuilder
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "analytics-secondary");
  }

  function secondaryTrainer(requestBuilder: request.Test) {
    return requestBuilder
      .set("Cookie", trainerCookie)
      .set("X-Facility-Id", "analytics-secondary");
  }

  it("reports classes and bookings only for the selected facility", async () => {
    const popularity = await secondary(
      request(app).get("/api/analytics/class-popularity"),
    ).expect(200);
    expect(popularity.body).toHaveLength(3);
    expect(popularity.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activitySessionId: "analytics-secondary-class",
          totalBookings: 1,
        }),
        expect.objectContaining({
          activitySessionId: "analytics-trainer-class",
          totalBookings: 1,
        }),
      ]),
    );

    const date = new Date(now);
    const monthly = await secondary(
      request(app)
        .get("/api/analytics/monthly")
        .query({
          year: date.getFullYear(),
          month: date.getMonth() + 1,
        }),
    ).expect(200);
    expect(monthly.body).toEqual(
      expect.objectContaining({ totalBookings: 3, totalClasses: 3 }),
    );
  });

  it("does not expose a member activity from another facility", async () => {
    await secondary(
      request(app).get("/api/analytics/user/analytics-facility_alpha-member"),
    ).expect(404);
  });

  it("counts only active real members in the selected facility", async () => {
    const response = await secondary(
      request(app).get("/api/analytics/members"),
    ).expect(200);
    expect(response.body).toEqual({
      totalMembers: 1,
      activeMembers: 1,
      memberJoinedThisWeek: 1,
      memberJoinedThisMonth: 1,
    });
  });

  it("limits trainer schedules to the selected facility", async () => {
    const response = await secondary(
      request(app).get(
        "/api/analytics/trainer/analytics-admin/upcoming-classes",
      ),
    ).expect(200);
    expect(
      response.body.map(
        (activitySession: { id: string }) => activitySession.id,
      ),
    ).toEqual(["analytics-secondary-class"]);
  });

  it("builds an administration overview without leaking contact data", async () => {
    const response = await secondary(
      request(app)
        .get("/api/analytics/overview")
        .query({
          from: now - 2 * 60 * 60 * 1_000,
          to: now + 24 * 60 * 60 * 1_000,
          utcOffsetMinutes: 120,
        }),
    ).expect(200);

    expect(response.body).toMatchObject({
      consumer: "administration",
      summary: {
        sessions: 3,
        availablePlaces: 13,
        confirmedBookings: 3,
        uniqueMembers: 1,
        occupancyRate: 23,
        attendanceRate: 100,
      },
      dataQuality: {
        attendanceCoverageRate: 100,
        causalExplanation: "survey_required",
        currentWaitlistOnly: true,
      },
      centreBaseline: {
        activeMembers: 1,
        newMembers: 1,
        engagedMembers: 1,
        participationRate: 100,
        cancellationRate: 0,
      },
      history: {
        current: {
          observedBookings: 3,
          attended: 1,
        },
        baselineEvents: 3,
        liveEvents: 0,
      },
    });
    expect(response.body.members).toEqual([
      expect.objectContaining({
        userId: "analytics-secondary-member",
        bookedSessions: 3,
        attendedSessions: 1,
      }),
    ]);
    expect(JSON.stringify(response.body.members)).not.toContain(
      "analytics-secondary@example.com",
    );
    expect(
      response.body.timeSlots.reduce(
        (total: number, timeSlot: { sessions: number }) =>
          total + timeSlot.sessions,
        0,
      ),
    ).toBe(3);
    expect(response.body.timeSlots).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ activityName: "Primary analytics class" }),
      ]),
    );
  });

  it("limits trainer analytics to that trainer's sessions and participants", async () => {
    const response = await secondaryTrainer(
      request(app)
        .get("/api/analytics/overview")
        .query({
          from: now - 2 * 60 * 60 * 1_000,
          to: now + 24 * 60 * 60 * 1_000,
          utcOffsetMinutes: 120,
        }),
    ).expect(200);

    expect(response.body).toMatchObject({
      consumer: "trainer",
      summary: {
        sessions: 2,
        availablePlaces: 8,
        confirmedBookings: 2,
        uniqueMembers: 1,
        occupancyRate: 25,
        attendanceRate: 100,
      },
      history: {
        current: {
          observedBookings: 2,
          attended: 1,
        },
        baselineEvents: 2,
        liveEvents: 0,
      },
      centreBaseline: null,
    });
    expect(response.body.activities).toEqual([
      expect.objectContaining({ activityName: "Trainer analytics class" }),
    ]);
    expect(
      response.body.timeSlots.reduce(
        (total: number, timeSlot: { sessions: number }) =>
          total + timeSlot.sessions,
        0,
      ),
    ).toBe(2);
    expect(response.body.timeSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityName: "Trainer analytics class",
          weekday: expect.any(Number),
          hour: expect.any(Number),
        }),
      ]),
    );
  });

  it("rejects invalid or excessively broad analytics periods", async () => {
    const response = await secondary(
      request(app)
        .get("/api/analytics/overview")
        .query({
          from: now,
          to: now + 94 * 24 * 60 * 60 * 1_000,
          utcOffsetMinutes: 0,
        }),
    ).expect(400);
    expect(response.body.code).toBe("ANALYTICS_PERIOD_INVALID");
  });
});

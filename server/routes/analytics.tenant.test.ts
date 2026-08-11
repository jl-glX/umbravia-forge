import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("analytics tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
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
          id: "analytics-primary-member",
          email: "analytics-primary@example.com",
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
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "primary:analytics-admin",
          facilityId: "primary",
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
          id: "primary:analytics-primary-member",
          facilityId: "primary",
          userId: "analytics-primary-member",
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
      ])
      .execute();
    await database.db
      .insertInto("gymClasses")
      .values([
        {
          id: "analytics-primary-class",
          facilityId: "primary",
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
      ])
      .execute();
    await database.db
      .insertInto("bookings")
      .values([
        {
          id: "analytics-primary-booking",
          classId: "analytics-primary-class",
          userId: "analytics-primary-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
        {
          id: "analytics-secondary-booking",
          classId: "analytics-secondary-class",
          userId: "analytics-secondary-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
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

  it("reports classes and bookings only for the selected facility", async () => {
    const popularity = await secondary(
      request(app).get("/api/analytics/class-popularity"),
    ).expect(200);
    expect(popularity.body).toEqual([
      expect.objectContaining({
        classId: "analytics-secondary-class",
        totalBookings: 1,
      }),
    ]);

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
      expect.objectContaining({ totalBookings: 1, totalClasses: 1 }),
    );
  });

  it("does not expose a member activity from another facility", async () => {
    await secondary(
      request(app).get("/api/analytics/user/analytics-primary-member"),
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
      response.body.map((gymClass: { id: string }) => gymClass.id),
    ).toEqual(["analytics-secondary-class"]);
  });
});

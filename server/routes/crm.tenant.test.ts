import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("CRM route authorization and tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let trainerCookie: string;
  const now = Date.UTC(2026, 7, 16, 12);

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-crm-route-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });

    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "crm-route-secondary",
        slug: "crm-route-secondary",
        name: "CRM Route Secondary",
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
          id: "crm-route-admin",
          email: "crm-route-admin@example.com",
          phone: null,
          name: "CRM Route Admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("CrmRouteAdminPassword123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "crm-route-trainer",
          email: "crm-route-trainer@example.com",
          phone: null,
          name: "CRM Route Trainer",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("CrmRouteTrainerPassword123"),
          role: "trainer",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "crm-route-facility_alpha-member",
          email: "crm-route-facility_alpha-member@example.com",
          phone: null,
          name: "Primary Member",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("CrmRoutePrimaryPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "crm-route-secondary-member",
          email: "crm-route-secondary-member@example.com",
          phone: null,
          name: "Secondary Member",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("CrmRouteSecondaryPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:crm-route-admin",
          facilityId: "facility-alpha",
          userId: "crm-route-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "crm-route-secondary:crm-route-admin",
          facilityId: "crm-route-secondary",
          userId: "crm-route-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "crm-route-secondary:crm-route-trainer",
          facilityId: "crm-route-secondary",
          userId: "crm-route-trainer",
          role: "trainer",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:crm-route-facility_alpha-member",
          facilityId: "facility-alpha",
          userId: "crm-route-facility_alpha-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "crm-route-secondary:crm-route-secondary-member",
          facilityId: "crm-route-secondary",
          userId: "crm-route-secondary-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "crm-route-admin@example.com",
        password: "CrmRouteAdminPassword123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    trainerCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "crm-route-trainer@example.com",
        password: "CrmRouteTrainerPassword123",
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

  it("requires authentication and an administrative facility role", async () => {
    await request(app).get("/api/crm/workspace").expect(401);
    await request(app)
      .get("/api/crm/workspace")
      .set("Cookie", trainerCookie)
      .set("X-Facility-Id", "crm-route-secondary")
      .expect(403);
  });

  it("returns only the selected facility workspace", async () => {
    const response = await request(app)
      .get("/api/crm/workspace")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "crm-route-secondary")
      .expect(200);

    expect(response.body.members).toEqual([
      expect.objectContaining({ userId: "crm-route-secondary-member" }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain(
      "crm-route-facility_alpha-member",
    );
  });

  it("does not update a member from another facility", async () => {
    const response = await request(app)
      .patch("/api/crm/members/crm-route-facility_alpha-member")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "crm-route-secondary")
      .send({ manualSegment: "attention" })
      .expect(404);

    expect(response.body.code).toBe("CRM_MEMBER_NOT_FOUND");
  });
});

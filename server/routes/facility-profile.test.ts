import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("facility profile API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-facility-profile-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    await database.db
      .insertInto("users")
      .values([
        {
          id: "facility-admin",
          email: "facility-admin@example.com",
          phone: null,
          name: "Facility Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("FacilityAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "facility-member",
          email: "facility-member@example.com",
          phone: null,
          name: "Facility Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("FacilityMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();

    const membershipCreatedAt = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: membershipCreatedAt,
    });
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Centro Secundario",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: membershipCreatedAt,
        updatedAt: membershipCreatedAt,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:facility-admin",
          facilityId: "facility-alpha",
          userId: "facility-admin",
          role: "owner",
          status: "active",
          createdAt: membershipCreatedAt,
          updatedAt: membershipCreatedAt,
        },
        {
          id: "facility-alpha:facility-member",
          facilityId: "facility-alpha",
          userId: "facility-member",
          role: "member",
          status: "active",
          createdAt: membershipCreatedAt,
          updatedAt: membershipCreatedAt,
        },
        {
          id: "secondary:facility-member",
          facilityId: "secondary",
          userId: "facility-member",
          role: "member",
          status: "active",
          createdAt: membershipCreatedAt + 1,
          updatedAt: membershipCreatedAt + 1,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "facility-admin@example.com",
        password: "FacilityAdmin123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    memberCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "facility-member@example.com",
        password: "FacilityMember123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("lets an administrator configure the facility panel identity", async () => {
    const updated = await request(app)
      .patch("/api/facility-profile")
      .set("Cookie", adminCookie)
      .send({
        name: "Gimnasio Horizonte",
        accentColor: "#0f766e",
        logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: "facility-alpha",
      name: "Gimnasio Horizonte",
      accentColor: "#0f766e",
    });

    const visibleToMember = await request(app)
      .get("/api/facility-profile")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(visibleToMember.body.name).toBe("Gimnasio Horizonte");
  });

  it("prevents members and unsafe image formats from changing branding", async () => {
    await request(app)
      .patch("/api/facility-profile")
      .set("Cookie", memberCookie)
      .send({ name: "Unauthorized" })
      .expect(403);

    await request(app)
      .patch("/api/facility-profile")
      .set("Cookie", adminCookie)
      .send({ logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" })
      .expect(400);
  });

  it("selects only facilities with an active membership", async () => {
    const selected = await request(app)
      .get("/api/facility-profile")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(selected.body).toMatchObject({
      id: "secondary",
      name: "Centro Secundario",
    });

    const denied = await request(app)
      .patch("/api/facility-profile")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({ name: "Cross-tenant write" })
      .expect(403);
    expect(denied.body.code).toBe("FORBIDDEN");

    const unchanged = await database.db
      .selectFrom("facilityProfiles")
      .select("name")
      .where("id", "=", "secondary")
      .executeTakeFirstOrThrow();
    expect(unchanged.name).toBe("Centro Secundario");
  });

  it("lists memberships without letting an invalid centre block account logout", async () => {
    const memberships = await request(app)
      .get("/api/auth/facilities")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(memberships.body.facilities).toEqual([
      expect.objectContaining({ id: "facility-alpha", role: "member" }),
      expect.objectContaining({ id: "secondary", role: "member" }),
    ]);

    const freshCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "facility-admin@example.com",
        password: "FacilityAdmin123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];

    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", freshCookie)
      .set("X-Facility-Id", "not-a-membership")
      .expect(200);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("account profile API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let memberCookie: string;
  let ownerCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-account-profile-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "profile-member",
          email: "profile-member@example.com",
          identityRealm: "commercial",
          phone: "+34910000001",
          name: "Profile Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("ProfileMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "profile-owner",
          email: "profile-owner@example.com",
          identityRealm: "commercial",
          phone: null,
          name: "Profile Owner",
          avatarDataUrl: "",
          password: await auth.hashPassword("ProfileOwner123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
      ])
      .execute();
    await createActiveTestFacility(database.db, "profile-facility", {
      createdAt: now,
      name: "Profile Centre",
    });
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "profile-facility:profile-owner",
        facilityId: "profile-facility",
        userId: "profile-owner",
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    app = (await import("../index.js")).app;
    memberCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "profile-member@example.com",
        password: "ProfileMember123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    ownerCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "profile-owner@example.com",
        password: "ProfileOwner123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", ownerCookie)
      .send({
        facilityName: "Profile Centre",
        facilityType: "traditional_gym",
        subdomain: "profile-centre",
        publicPageEnabled: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("lets a member update their own safe profile photo", async () => {
    const avatarDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const response = await request(app)
      .patch("/api/account/profile")
      .set("Cookie", memberCookie)
      .send({ avatarDataUrl })
      .expect(200);
    expect(response.body.user).toMatchObject({
      id: "profile-member",
      avatarDataUrl,
    });

    const session = await request(app)
      .get("/api/auth/session")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(session.body.user.avatarDataUrl).toBe(avatarDataUrl);
  });

  it("rejects unauthenticated and unsafe avatar updates", async () => {
    await request(app)
      .patch("/api/account/profile")
      .send({ avatarDataUrl: "" })
      .expect(401);
    await request(app)
      .patch("/api/account/profile")
      .set("Cookie", memberCookie)
      .send({ avatarDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" })
      .expect(400);
  });

  it("lets only the verified facility owner change the sign-in phone", async () => {
    await request(app)
      .put("/api/account/profile/phone")
      .set("Cookie", memberCookie)
      .send({ phone: "+34910000002", password: "ProfileMember123" })
      .expect(403);

    await request(app)
      .put("/api/account/profile/phone")
      .set("Cookie", ownerCookie)
      .send({ phone: "+34910000002", password: "WrongPassword123" })
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe("SECURITY_CONFIRMATION_FAILED");
      });

    await request(app)
      .put("/api/account/profile/phone")
      .set("Cookie", ownerCookie)
      .send({ phone: "+34910000001", password: "ProfileOwner123" })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("ACCOUNT_PHONE_ALREADY_IN_USE");
      });

    await request(app)
      .put("/api/account/profile/phone")
      .set("Cookie", ownerCookie)
      .send({ phone: "+34910000002", password: "ProfileOwner123" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("+34910000002");
      });

    await request(app)
      .post("/api/auth/login")
      .send({
        identifier: "+34910000002",
        password: "ProfileOwner123",
        accessPortal: "staff",
        rememberDevice: false,
      })
      .expect(200);
  });

  it("keeps the phone private by default and lets the owner publish or hide it", async () => {
    await request(app)
      .get("/api/commercial/public-centres/profile-centre")
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("");
      });

    await request(app)
      .put("/api/commercial/trial/public-phone")
      .set("Cookie", ownerCookie)
      .send({ showPhonePublicly: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.showPhonePublicly).toBe(true);
      });
    await request(app)
      .get("/api/commercial/public-centres/profile-centre")
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("+34910000002");
      });

    await request(app)
      .put("/api/account/profile/phone")
      .set("Cookie", ownerCookie)
      .send({ phone: "", password: "ProfileOwner123" })
      .expect(200);
    await request(app)
      .get("/api/commercial/trial")
      .set("Cookie", ownerCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.showPhonePublicly).toBe(false);
      });
    await request(app)
      .get("/api/commercial/public-centres/profile-centre")
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBe("");
      });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("administrator account safety", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-admin-safety-"));
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
          id: "protected-admin",
          email: "protected-admin@example.com",
          phone: null,
          name: "Protected Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("ProtectedAdmin123"),
          role: "admin",
          accountStatus: "active",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        },
        {
          id: "synthetic-member",
          email: "synthetic-member@example.com",
          phone: null,
          name: "Synthetic Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("SyntheticMember123"),
          role: "member",
          accountStatus: "active",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now() + 1,
        },
        {
          id: "retained-member",
          email: "retained-member@example.com",
          phone: null,
          name: "Retained Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("RetainedMember123"),
          role: "member",
          accountStatus: "active",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now() + 2,
        },
        {
          id: "deletable-member",
          email: "deletable-member@example.com",
          phone: null,
          name: "Deletable Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("DeletableMember123"),
          role: "member",
          accountStatus: "active",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now() + 3,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "primary:protected-admin",
          facilityId: "primary",
          userId: "protected-admin",
          role: "owner",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "primary:synthetic-member",
          facilityId: "primary",
          userId: "synthetic-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "primary:retained-member",
          facilityId: "primary",
          userId: "retained-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "primary:deletable-member",
          facilityId: "primary",
          userId: "deletable-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
      .execute();
    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "protected-admin@example.com",
        password: "ProtectedAdmin123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    memberCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "synthetic-member@example.com",
        password: "SyntheticMember123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  }, 20_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("prevents an administrator from deleting or demoting the active account", async () => {
    const deleted = await request(app)
      .delete("/api/users/protected-admin")
      .set("Cookie", adminCookie)
      .expect(400);
    const demoted = await request(app)
      .patch("/api/users/protected-admin/role")
      .set("Cookie", adminCookie)
      .send({ role: "member" })
      .expect(400);
    const bulkDeleted = await request(app)
      .post("/api/users/bulk/delete")
      .set("Cookie", adminCookie)
      .send({ userIds: ["protected-admin"] })
      .expect(400);

    expect(deleted.body.code).toBe("ADMIN_SELF_DELETE");
    expect(demoted.body.code).toBe("ADMIN_SELF_ROLE_CHANGE");
    expect(bulkDeleted.body.code).toBe("ADMIN_SELF_DELETE");
  });

  it("keeps member sessions outside administrator routes", async () => {
    await request(app)
      .get("/api/users")
      .set("Cookie", memberCookie)
      .expect(403, {
        error: "An active facility membership is required",
        code: "FORBIDDEN",
      });

    const users = await request(app)
      .get("/api/users")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(users.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synthetic-member",
          role: "member",
        }),
      ]),
    );
  });

  it("revokes active sessions whenever an administrator changes a role", async () => {
    await request(app)
      .patch("/api/users/synthetic-member/role")
      .set("Cookie", adminCookie)
      .send({ role: "admin" })
      .expect(200);

    await request(app)
      .get("/api/users")
      .set("Cookie", memberCookie)
      .expect(401);

    const promotedCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "synthetic-member@example.com",
        password: "SyntheticMember123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    await request(app)
      .get("/api/users")
      .set("Cookie", promotedCookie)
      .expect(200);

    await request(app)
      .patch("/api/users/synthetic-member/role")
      .set("Cookie", adminCookie)
      .send({ role: "member" })
      .expect(200);
    await request(app)
      .get("/api/users")
      .set("Cookie", promotedCookie)
      .expect(401);
  });

  it("blocks destructive deletion when retained records need review", async () => {
    const now = Date.now();
    await database.db
      .insertInto("supportTickets")
      .values({
        id: "retained-ticket",
        publicId: "UFS-RETAINED01",
        facilityId: "primary",
        requesterUserId: "retained-member",
        assigneeUserId: null,
        subject: "Synthetic retention check",
        category: "account",
        priority: "normal",
        status: "open",
        source: "system",
        relatedType: null,
        relatedId: null,
        context: "{}",
        firstResponseDueAt: now + 60_000,
        resolutionDueAt: now + 120_000,
        firstRespondedAt: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const blocked = await request(app)
      .delete("/api/users/retained-member")
      .set("Cookie", adminCookie)
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: "USER_DELETION_REQUIRES_REVIEW",
      blockers: [{ code: "support_tickets", count: 1 }],
    });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", "retained-member")
        .executeTakeFirst(),
    ).resolves.toEqual({ id: "retained-member" });
  });

  it("still allows deletion of a synthetic account without retained records", async () => {
    await request(app)
      .delete("/api/users/deletable-member")
      .set("Cookie", adminCookie)
      .expect(200);
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", "deletable-member")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });
});

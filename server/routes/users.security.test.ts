import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("administrator account safety", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;
  let trainerCookie: string;

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
          emailVerifiedAt: Date.now(),
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
          emailVerifiedAt: Date.now(),
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
          emailVerifiedAt: Date.now(),
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
          emailVerifiedAt: Date.now(),
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now() + 3,
        },
        {
          id: "delegated-trainer",
          email: "delegated-trainer@example.com",
          phone: null,
          name: "Delegated Trainer",
          avatarDataUrl: "",
          password: await auth.hashPassword("DelegatedTrainer123"),
          role: "trainer",
          accountStatus: "active",
          emailVerifiedAt: Date.now(),
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now() + 4,
        },
      ])
      .execute();
    await createActiveTestFacility(database.db, "facility-alpha");
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:protected-admin",
          facilityId: "facility-alpha",
          userId: "protected-admin",
          role: "owner",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "facility-alpha:synthetic-member",
          facilityId: "facility-alpha",
          userId: "synthetic-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "facility-alpha:retained-member",
          facilityId: "facility-alpha",
          userId: "retained-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "facility-alpha:deletable-member",
          facilityId: "facility-alpha",
          userId: "deletable-member",
          role: "member",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "facility-alpha:delegated-trainer",
          facilityId: "facility-alpha",
          userId: "delegated-trainer",
          role: "trainer",
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
    trainerCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "delegated-trainer@example.com",
        password: "DelegatedTrainer123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  }, 20_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("protects ownership while allowing independent workforce labels", async () => {
    const deleted = await request(app)
      .delete("/api/users/protected-admin")
      .set("Cookie", adminCookie)
      .expect(400);
    const labels = await request(app)
      .put("/api/users/protected-admin/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer", "admin"] })
      .expect(200);
    const bulkDeleted = await request(app)
      .post("/api/users/bulk/delete")
      .set("Cookie", adminCookie)
      .send({ userIds: ["protected-admin"] })
      .expect(400);

    expect(deleted.body.code).toBe("ADMIN_SELF_DELETE");
    expect(labels.body).toMatchObject({
      facilityRole: "owner",
      roles: ["trainer", "admin"],
    });
    expect(bulkDeleted.body.code).toBe("ADMIN_SELF_DELETE");
  });

  it("keeps member sessions outside administrator routes", async () => {
    await request(app)
      .get("/api/users")
      .set("Cookie", memberCookie)
      .expect(403, {
        error: "You do not have permission to perform this action",
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

  it("does not let a facility administrator replace another account email", async () => {
    const response = await request(app)
      .put("/api/users/retained-member")
      .set("Cookie", adminCookie)
      .send({
        email: "replacement@example.com",
        name: "Retained Member",
      })
      .expect(400);
    expect(response.body.error).toBe(
      "ACCOUNT_EMAIL_CHANGE_REQUIRES_VERIFICATION",
    );
    await expect(
      database.db
        .selectFrom("users")
        .select("email")
        .where("id", "=", "retained-member")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ email: "retained-member@example.com" });
  });

  it("does not turn a member affiliation into employment", async () => {
    const response = await request(app)
      .put("/api/users/synthetic-member/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer"] })
      .expect(400);
    expect(response.body.code).toBe("WORKER_VERIFICATION_REQUIRED");
  });

  it("revokes sessions when the owner grants or removes administration", async () => {
    await request(app)
      .put("/api/users/delegated-trainer/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer", "admin"] })
      .expect(200);

    await request(app)
      .get("/api/users")
      .set("Cookie", trainerCookie)
      .expect(401);

    const delegatedAdminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "delegated-trainer@example.com",
        password: "DelegatedTrainer123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    await request(app)
      .get("/api/users")
      .set("Cookie", delegatedAdminCookie)
      .expect(200);
    await request(app)
      .post("/api/users/invitations")
      .set("Cookie", delegatedAdminCookie)
      .send({
        email: "another-admin@example.com",
        name: "Another Admin",
        role: "admin",
        locale: "es",
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("FACILITY_OWNER_REQUIRED");
      });

    await request(app)
      .put("/api/users/delegated-trainer/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer"] })
      .expect(200);
    await request(app)
      .get("/api/users")
      .set("Cookie", delegatedAdminCookie)
      .expect(401);
  });

  it("enforces granular class delegation in the server", async () => {
    await request(app)
      .put("/api/users/delegated-trainer/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer", "admin"] })
      .expect(200);
    const delegatedAdminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "delegated-trainer@example.com",
        password: "DelegatedTrainer123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];

    await request(app)
      .put("/api/users/delegated-trainer/class-permissions")
      .set("Cookie", adminCookie)
      .send({ classPermissions: { "classes.create": "deny" } })
      .expect(200);
    const denied = await request(app)
      .post("/api/admin/activity-sessions")
      .set("Cookie", delegatedAdminCookie)
      .send({
        name: "Denied class",
        description: "",
        trainerId: "delegated-trainer",
        trainerName: "Delegated Trainer",
        maxCapacity: 10,
        scheduledAt: Date.now() + 86_400_000,
      })
      .expect(403);
    expect(denied.body.code).toBe("CLASS_PERMISSION_REQUIRED");

    await request(app)
      .put("/api/users/delegated-trainer/class-permissions")
      .set("Cookie", adminCookie)
      .send({ classPermissions: { "classes.create": "allow" } })
      .expect(200);
    await request(app)
      .post("/api/admin/activity-sessions")
      .set("Cookie", delegatedAdminCookie)
      .send({
        name: "Delegated class",
        description: "",
        trainerId: "delegated-trainer",
        trainerName: "Delegated Trainer",
        maxCapacity: 10,
        scheduledAt: Date.now() + 86_400_000,
      })
      .expect(201);
  });

  it("reserves staff member-affiliation policy changes for the facility owner", async () => {
    await request(app)
      .put("/api/users/delegated-trainer/workforce-roles")
      .set("Cookie", adminCookie)
      .send({ roles: ["trainer", "admin"] })
      .expect(200);
    const delegatedAdminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "delegated-trainer@example.com",
        password: "DelegatedTrainer123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];

    await request(app)
      .put("/api/users/member-affiliation-policy")
      .set("Cookie", delegatedAdminCookie)
      .send({ allowAllStaff: true, specificallyAllowedUserIds: [] })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("FACILITY_OWNER_REQUIRED");
      });
    await request(app)
      .put("/api/users/member-affiliation-policy")
      .set("Cookie", adminCookie)
      .send({
        allowAllStaff: false,
        specificallyAllowedUserIds: ["delegated-trainer"],
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.allowAllStaff).toBe(false);
        expect(body.staff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              userId: "delegated-trainer",
              specificallyAllowed: true,
            }),
          ]),
        );
      });
  });

  it("blocks destructive deletion when retained records need review", async () => {
    const now = Date.now();
    await database.db
      .insertInto("supportTickets")
      .values({
        id: "retained-ticket",
        publicId: "UFS-RETAINED01",
        facilityId: "facility-alpha",
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

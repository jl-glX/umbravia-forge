import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("verified facility invitations", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let existingCookie: string;
  let dualTrainerCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-invitations-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "http://localhost:3000");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "facility-beta",
        slug: "facility-beta",
        name: "Facility Beta",
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
          id: "invitation-admin",
          email: "invitation-admin@example.com",
          phone: null,
          name: "Invitation Admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("InvitationAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
        {
          id: "existing-invitee",
          email: "existing-invitee@example.com",
          phone: null,
          name: "Existing Invitee",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("ExistingInvitee123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
        {
          id: "dual-trainer",
          email: "dual-trainer@example.com",
          phone: null,
          name: "Dual Trainer",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("DualTrainer123"),
          role: "trainer",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now + 1,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:invitation-admin",
          facilityId: "facility-alpha",
          userId: "invitation-admin",
          role: "owner",
          workforceRoles: "[]",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-beta:existing-invitee",
          facilityId: "facility-beta",
          userId: "existing-invitee",
          role: "member",
          workforceRoles: "[]",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:dual-trainer",
          facilityId: "facility-alpha",
          userId: "dual-trainer",
          role: "trainer",
          workforceRoles: '["trainer","admin"]',
          status: "active",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ])
      .execute();
    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "invitation-admin@example.com",
        password: "InvitationAdmin123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    existingCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "existing-invitee@example.com",
        password: "ExistingInvitee123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    dualTrainerCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "dual-trainer@example.com",
        password: "DualTrainer123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  }, 20_000);

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function createInvitation(input: {
    email: string;
    name: string;
    role: "member" | "trainer" | "admin";
    locale?: string;
  }) {
    return request(app)
      .post("/api/users/invitations")
      .set("Cookie", adminCookie)
      .send({ ...input, locale: input.locale ?? "es" })
      .expect(201);
  }

  it("does not create an account or membership before a new invitee accepts", async () => {
    const created = await createInvitation({
      email: "new-invitee@example.com",
      name: "New Invitee",
      role: "trainer",
    });
    expect(created.body).toMatchObject({
      invitedEmail: "new-invitee@example.com",
      role: "trainer",
      status: "pending",
      existingAccount: false,
    });
    expect(created.body.testToken).toEqual(expect.any(String));

    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("email", "=", "new-invitee@example.com")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();

    const inspected = await request(app)
      .get(`/api/facility-invitations/${created.body.testToken}`)
      .expect(200);
    expect(inspected.body).toMatchObject({
      facilityName: "facility-alpha",
      existingAccount: false,
      status: "pending",
    });

    await request(app)
      .post(`/api/facility-invitations/${created.body.testToken}/accept-new`)
      .send({
        password: "InviteeChosenPassword123",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);

    const user = await database.db
      .selectFrom("users")
      .select(["id", "accountStatus", "emailVerifiedAt", "termsAcceptedAt"])
      .where("email", "=", "new-invitee@example.com")
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({ accountStatus: "active" });
    expect(user.emailVerifiedAt).toEqual(expect.any(Number));
    expect(user.termsAcceptedAt).toEqual(expect.any(Number));
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["facilityId", "role", "status"])
        .where("userId", "=", user.id)
        .execute(),
    ).resolves.toEqual([
      { facilityId: "facility-alpha", role: "trainer", status: "active" },
    ]);
    await request(app)
      .post(`/api/facility-invitations/${created.body.testToken}/accept-new`)
      .send({
        password: "InviteeChosenPassword123",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(409);
  });

  it("retries a worker invitation with one new pending token in the same tenant", async () => {
    const input = {
      email: "retry-worker@example.com",
      name: "Retry Worker",
      role: "trainer" as const,
      locale: "fr-FR",
    };
    const emailDelivery = await import("../services/email-delivery.js");
    const queueSpy = vi
      .spyOn(emailDelivery, "queueFacilityInvitationEmail")
      .mockRejectedValueOnce(new Error("Controlled queue failure"));
    let first!: request.Response;
    let second!: request.Response;
    try {
      first = await createInvitation(input);
      expect(first.body).toMatchObject({
        status: "pending",
        deliveryQueued: false,
      });
      second = await createInvitation(input);
      expect(second.body).toMatchObject({
        status: "pending",
        deliveryQueued: true,
      });
    } finally {
      queueSpy.mockRestore();
    }

    expect(second.body.testToken).not.toBe(first.body.testToken);
    const invitations = await database.db
      .selectFrom("facilityInvitations")
      .select(["id", "facilityId", "invitedEmail", "status"])
      .where("facilityId", "=", "facility-alpha")
      .where("invitedEmail", "=", input.email)
      .orderBy("createdAt", "asc")
      .execute();
    expect(invitations).toHaveLength(2);
    expect(invitations.filter((item) => item.status === "pending")).toEqual([
      expect.objectContaining({
        id: second.body.id,
        facilityId: "facility-alpha",
        invitedEmail: input.email,
      }),
    ]);
    expect(invitations.filter((item) => item.status === "revoked")).toEqual([
      expect.objectContaining({
        id: first.body.id,
        facilityId: "facility-alpha",
        invitedEmail: input.email,
      }),
    ]);
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["recipient", "locale"])
        .where("recipient", "=", input.email)
        .execute(),
    ).resolves.toEqual([{ recipient: input.email, locale: "fr" }]);
  });

  it("lets the facility owner offer administrator access", async () => {
    const ownerInvitation = await createInvitation({
      email: "owner-created-admin@example.com",
      name: "Owner Created Admin",
      role: "admin",
      locale: "it_IT",
    });
    expect(ownerInvitation.body).toMatchObject({
      role: "admin",
      status: "pending",
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select("locale")
        .where("recipient", "=", "owner-created-admin@example.com")
        .orderBy("createdAt", "desc")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ locale: "it" });
  });

  it("canonicalizes invitation locales before queueing and persistence", async () => {
    const acceptance = {
      password: "CanonicalLocalePassword123",
      acceptedTerms: true,
      acceptedPrivacy: true,
    };
    for (const [index, locale, canonical] of [
      [1, "FR-fr", "fr"],
      [2, "it_IT", "it"],
      [3, "ca-ES-valencia", "ca-valencia"],
      [4, "oc-ES-aranes", "oc-aranes"],
    ] as const) {
      const email = `canonical-locale-invitee-${index}@example.com`;
      const created = await createInvitation({
        email,
        name: `Canonical Locale Invitee ${index}`,
        role: index % 2 === 0 ? "member" : "trainer",
        locale,
      });
      await expect(
        database.db
          .selectFrom("emailDeliveries")
          .select("locale")
          .where("recipient", "=", email)
          .orderBy("createdAt", "desc")
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ locale: canonical });

      const acceptanceUrl = `/api/facility-invitations/${created.body.testToken}/accept-new`;
      if (index === 1) {
        for (const invalidLocale of [
          "xx",
          "oc",
          "oc-ES",
          "oc-FR",
          "oc-Latn-ES",
          "ca-FR-valencia",
          "ca-US-valencia",
          "oc-FR-aranes",
        ]) {
          await request(app)
            .post(acceptanceUrl)
            .send({ ...acceptance, locale: invalidLocale })
            .expect(400);
        }
        await request(app).post(acceptanceUrl).send(acceptance).expect(400);
      }
      await request(app)
        .post(acceptanceUrl)
        .send({ ...acceptance, locale })
        .expect(201);
      await expect(
        database.db
          .selectFrom("users")
          .select("locale")
          .where("email", "=", email)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ locale: canonical });
    }

    const invalidCreate = {
      email: "invalid-locale-invitee@example.com",
      name: "Invalid Locale Invitee",
      role: "member",
    };
    for (const locale of [
      "xx",
      "oc",
      "oc-ES",
      "oc-FR",
      "oc-Latn-ES",
      "ca-FR-valencia",
      "ca-US-valencia",
      "oc-FR-aranes",
    ]) {
      await request(app)
        .post("/api/users/invitations")
        .set("Cookie", adminCookie)
        .send({ ...invalidCreate, locale })
        .expect(400);
    }
    await request(app)
      .post("/api/users/invitations")
      .set("Cookie", adminCookie)
      .send(invalidCreate)
      .expect(400);
  });

  it("keeps an existing affiliation invited until the matching account accepts", async () => {
    const created = await createInvitation({
      email: "existing-invitee@example.com",
      name: "Existing Invitee",
      role: "trainer",
    });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["role", "status"])
        .where("facilityId", "=", "facility-alpha")
        .where("userId", "=", "existing-invitee")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ role: "trainer", status: "invited" });

    await request(app)
      .get("/api/activity-sessions")
      .set("Cookie", existingCookie)
      .set("X-Facility-Id", "facility-alpha")
      .expect(200);
    await request(app)
      .post("/api/bookings")
      .set("Cookie", existingCookie)
      .set("X-Facility-Id", "facility-alpha")
      .send({})
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("FACILITY_WORKER_VERIFICATION_REQUIRED");
      });
    await request(app)
      .post(
        `/api/facility-invitations/${created.body.testToken}/accept-existing`,
      )
      .set("Cookie", adminCookie)
      .expect(403);
    await request(app)
      .post(
        `/api/facility-invitations/${created.body.testToken}/accept-existing`,
      )
      .set("Cookie", existingCookie)
      .expect(204);

    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["role", "status"])
        .where("facilityId", "=", "facility-alpha")
        .where("userId", "=", "existing-invitee")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ role: "trainer", status: "active" });
  });

  it("revokes a pending existing-account invitation and removes its inert membership", async () => {
    await database.db
      .updateTable("facilityMemberships")
      .set({ status: "left", updatedAt: Date.now() })
      .where("facilityId", "=", "facility-alpha")
      .where("userId", "=", "existing-invitee")
      .execute();
    const created = await createInvitation({
      email: "existing-invitee@example.com",
      name: "Existing Invitee",
      role: "trainer",
    });
    await request(app)
      .post(`/api/users/invitations/${created.body.id}/revoke`)
      .set("Cookie", adminCookie)
      .expect(204);
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("id")
        .where("facilityId", "=", "facility-alpha")
        .where("userId", "=", "existing-invitee")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await request(app)
      .get(`/api/facility-invitations/${created.body.testToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe("revoked");
      });
  });

  it("keeps member affiliation separate from worker verification", async () => {
    const created = await createInvitation({
      email: "new-member-affiliation@example.com",
      name: "New Member",
      role: "member",
    });
    expect(created.body).toMatchObject({
      role: "member",
      status: "pending",
      existingAccount: false,
    });
    await request(app)
      .get(`/api/facility-invitations/${created.body.testToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe("member");
      });

    await request(app)
      .post(`/api/facility-invitations/${created.body.testToken}/accept-new`)
      .send({
        password: "NewMemberChosenPassword123",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    const user = await database.db
      .selectFrom("users")
      .select("id")
      .where("email", "=", "new-member-affiliation@example.com")
      .executeTakeFirstOrThrow();
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["role", "status"])
        .where("facilityId", "=", "facility-alpha")
        .where("userId", "=", user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ role: "member", status: "active" });
  });

  it("lets specifically authorised staff add a member affiliation without losing workforce labels", async () => {
    await request(app)
      .post("/api/users/invitations")
      .set("Cookie", adminCookie)
      .send({
        email: "dual-trainer@example.com",
        name: "Dual Trainer",
        role: "member",
        locale: "es",
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("STAFF_MEMBER_AFFILIATION_NOT_ALLOWED");
      });

    await request(app)
      .put("/api/users/member-affiliation-policy")
      .set("Cookie", adminCookie)
      .send({
        allowAllStaff: false,
        specificallyAllowedUserIds: ["dual-trainer"],
      })
      .expect(200);

    const invitation = await createInvitation({
      email: "dual-trainer@example.com",
      name: "Dual Trainer",
      role: "member",
    });
    await request(app)
      .post(
        `/api/facility-invitations/${invitation.body.testToken}/accept-existing`,
      )
      .set("Cookie", dualTrainerCookie)
      .expect(204);

    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select(["role", "workforceRoles", "memberAffiliation", "status"])
        .where("facilityId", "=", "facility-alpha")
        .where("userId", "=", "dual-trainer")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      role: "trainer",
      workforceRoles: '["trainer","admin"]',
      memberAffiliation: 1,
      status: "active",
    });

    const users = await request(app)
      .get("/api/users")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(users.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dual-trainer",
          facilityRole: "trainer",
          roles: ["trainer", "admin", "member"],
          memberAffiliation: true,
        }),
      ]),
    );

    await request(app)
      .post("/api/auth/login")
      .send({
        identifier: "dual-trainer@example.com",
        password: "DualTrainer123",
        accessPortal: "member",
        rememberDevice: false,
      })
      .expect(200);
  });

  it("never treats the facility owner as a staff member eligible for member affiliation", async () => {
    await request(app)
      .put("/api/users/member-affiliation-policy")
      .set("Cookie", adminCookie)
      .send({ allowAllStaff: true, specificallyAllowedUserIds: [] })
      .expect(200);
    await request(app)
      .post("/api/users/invitations")
      .set("Cookie", adminCookie)
      .send({
        email: "invitation-admin@example.com",
        name: "Invitation Admin",
        role: "member",
        locale: "es",
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("FACILITY_MEMBER_ALREADY_ACTIVE");
      });
  });

  it("does not expose the administrator-selected password shortcut without the explicit test bypass", async () => {
    await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({
        email: "legacy-direct@example.com",
        name: "Legacy Direct",
        password: "LegacyDirectPassword123",
        role: "member",
      })
      .expect(400);
  });
});

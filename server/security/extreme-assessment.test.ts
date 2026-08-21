import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FACILITY_ID = "facility-extreme-assessment";

describe("extreme local security assessment", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let memberCookie: string;
  let otherMemberCookie: string;
  let trainerCookie: string;
  let adminCookie: string;

  const users = {
    member: {
      id: "assessment-member",
      email: "assessment-member@example.test",
      role: "member" as const,
    },
    otherMember: {
      id: "assessment-other-member",
      email: "assessment-other-member@example.test",
      role: "member" as const,
    },
    trainer: {
      id: "assessment-trainer",
      email: "assessment-trainer@example.test",
      role: "trainer" as const,
    },
    otherTrainer: {
      id: "assessment-other-trainer",
      email: "assessment-other-trainer@example.test",
      role: "trainer" as const,
    },
    admin: {
      id: "assessment-admin",
      email: "assessment-admin@example.test",
      role: "admin" as const,
    },
  };

  const password = "AssessmentPassword123";

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-extreme-security-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_RATE_LIMIT_MAX_REQUESTS", "16");
    vi.resetModules();

    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    for (const user of Object.values(users)) {
      await database.db
        .insertInto("users")
        .values({
          ...user,
          phone: null,
          name: user.id,
          avatarDataUrl: "",
          password: await auth.hashPassword(password),
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        })
        .execute();
    }

    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: FACILITY_ID,
        slug: "extreme-assessment",
        name: "Extreme assessment",
        logoDataUrl: "",
        accentColor: "#f97316",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values(
        Object.values(users).map((user) => ({
          id: `${FACILITY_ID}:${user.id}`,
          facilityId: FACILITY_ID,
          userId: user.id,
          role:
            user.role === "admin"
              ? ("admin" as const)
              : user.role === "trainer"
                ? ("trainer" as const)
                : ("member" as const),
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .execute();
    await database.db
      .insertInto("platformOperators")
      .values({
        userId: users.admin.id,
        source: "controlled_provisioning",
        status: "active",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();

    await database.db
      .insertInto("activitySessions")
      .values([
        {
          facilityId: FACILITY_ID,
          id: "assessment-owned-class",
          name: "Owned class",
          description: "",
          trainerId: users.trainer.id,
          trainerName: users.trainer.id,
          maxCapacity: 10,
          scheduledAt: Date.now() + 86_400_000,
        },
        {
          facilityId: FACILITY_ID,
          id: "assessment-other-class",
          name: "Other class",
          description: "",
          trainerId: users.otherTrainer.id,
          trainerName: users.otherTrainer.id,
          maxCapacity: 10,
          scheduledAt: Date.now() + 172_800_000,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;

    const login = async (
      identifier: string,
      accessPortal: "member" | "staff",
    ) =>
      (
        await request(app).post("/api/auth/login").send({
          identifier,
          password,
          accessPortal,
          rememberDevice: false,
        })
      ).headers["set-cookie"][0];

    memberCookie = await login(users.member.email, "member");
    otherMemberCookie = await login(users.otherMember.email, "member");
    trainerCookie = await login(users.trainer.email, "staff");
    adminCookie = await login(users.admin.email, "staff");
  }, 60_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("enforces role boundaries even when protected URLs are requested directly", async () => {
    await request(app)
      .get("/api/users")
      .set("Cookie", memberCookie)
      .expect(403);
    for (const path of [
      "/api/admin/data-retention",
      "/api/umf-corporate/data-retention",
      "/api/umf-corporate/resource-manager",
    ]) {
      await request(app).get(path).set("Cookie", memberCookie).expect(404);
    }

    await request(app)
      .get("/api/users")
      .set("Cookie", trainerCookie)
      .expect(403);
    await request(app).get("/api/users").set("Cookie", adminCookie).expect(200);
  });

  it("blocks horizontal access to another member's bookings", async () => {
    await request(app)
      .get(`/api/bookings/user/${users.otherMember.id}`)
      .set("Cookie", memberCookie)
      .expect(403);

    await request(app)
      .get(`/api/bookings/user/${users.otherMember.id}`)
      .set("Cookie", otherMemberCookie)
      .expect(200);
  });

  it("limits trainers to their own class rosters while allowing administrators", async () => {
    await request(app)
      .get("/api/bookings/class/assessment-owned-class")
      .set("Cookie", trainerCookie)
      .expect(200);
    await request(app)
      .get("/api/bookings/class/assessment-other-class")
      .set("Cookie", trainerCookie)
      .expect(403);
    await request(app)
      .get("/api/bookings/class/assessment-other-class")
      .set("Cookie", adminCookie)
      .expect(200);
  });

  it("rejects forged session cookies and rejects replay after logout", async () => {
    const forgedCookie = memberCookie.replace(/[a-f0-9](?=[^a-f0-9]*;)/i, "z");
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", forgedCookie)
      .expect(401);

    const replayLogin = await request(app).post("/api/auth/login").send({
      identifier: users.member.email,
      password,
      accessPortal: "member",
      rememberDevice: false,
    });
    const replayCookie = replayLogin.headers["set-cookie"][0];
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", replayCookie)
      .send({})
      .expect(200);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", replayCookie)
      .expect(401);
  });

  it("rejects passwords that exceed the Argon2id input policy", async () => {
    const oversizedPassword = `Aa1${"x".repeat(1_022)}`;

    const signupResponse = await request(app).post("/api/auth/signup").send({
      email: "oversized-password@example.test",
      name: "Oversized Password",
      password: oversizedPassword,
    });
    expect(signupResponse.status).toBe(400);
    expect(signupResponse.body.code).toBe("VALIDATION_ERROR");

    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: users.member.email,
      password: oversizedPassword,
      accessPortal: "member",
      rememberDevice: false,
    });
    expect(loginResponse.status).toBe(400);
    expect(loginResponse.body.code).toBe("VALIDATION_ERROR");
  });

  it("blocks an authenticated cross-site request before it can schedule deletion", async () => {
    await request(app)
      .post("/api/account/lifecycle/deletion")
      .set("Cookie", memberCookie)
      .set("Origin", "https://attacker.invalid")
      .set("Sec-Fetch-Site", "cross-site")
      .send({})
      .expect(403);

    expect(
      await database.db
        .selectFrom("accountDeletionRequests")
        .select("id")
        .where("userId", "=", users.member.id)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it("does not trust rotating forwarded IP headers to evade authentication limits", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${attempt + 1}`)
        .send({
          identifier: "absent-user@example.test",
          password: "WrongPassword123",
          accessPortal: "member",
          rememberDevice: false,
        });
      statuses.push(response.status);
      if (response.status === 429) break;
    }

    expect(statuses).toContain(429);
  }, 60_000);
});

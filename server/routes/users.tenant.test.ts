import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("user management tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-users-tenant-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();

    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "users-secondary",
        slug: "users-secondary",
        name: "Users Secondary",
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
          id: "users-admin",
          email: "users-admin@example.com",
          phone: null,
          name: "Users Admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("UsersAdminPassword123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
        {
          id: "users-primary-only",
          email: "users-primary@example.com",
          phone: null,
          name: "Primary Only",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("PrimaryOnlyPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
        {
          id: "users-secondary-only",
          email: "users-secondary@example.com",
          phone: null,
          name: "Secondary Only",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("SecondaryOnlyPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
        {
          id: "users-shared",
          email: "users-shared@example.com",
          phone: null,
          name: "Shared User",
          accountStatus: "active",
          emailVerifiedAt: now,
          avatarDataUrl: "",
          password: await auth.hashPassword("SharedUserPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "primary:users-admin",
          facilityId: "primary",
          userId: "users-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "users-secondary:users-admin",
          facilityId: "users-secondary",
          userId: "users-admin",
          role: "owner",
          status: "active",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: "primary:users-primary-only",
          facilityId: "primary",
          userId: "users-primary-only",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "users-secondary:users-secondary-only",
          facilityId: "users-secondary",
          userId: "users-secondary-only",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "primary:users-shared",
          facilityId: "primary",
          userId: "users-shared",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "users-secondary:users-shared",
          facilityId: "users-secondary",
          userId: "users-shared",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "users-secondary-history-class",
        facilityId: "users-secondary",
        name: "Historical class",
        description: "",
        trainerId: "users-admin",
        trainerName: "Users Admin",
        maxCapacity: 10,
        scheduledAt: now,
      })
      .execute();
    await database.db
      .insertInto("bookingAnalyticsEvents")
      .values({
        id: "users-shared-history",
        deduplicationKey: "test:users-shared-history",
        facilityId: "users-secondary",
        bookingId: null,
        activitySessionId: "users-secondary-history-class",
        memberUserId: "users-shared",
        trainerUserId: "users-admin",
        eventType: "baseline_import",
        source: "baseline",
        fromState: null,
        toState: "attended",
        activityName: "Historical class",
        scheduledAt: now,
        capacitySnapshot: 10,
        occurredAt: now,
        recordedAt: now,
      })
      .execute();

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "users-admin@example.com",
        password: "UsersAdminPassword123",
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

  function ids(response: request.Response) {
    return response.body.map((user: { id: string }) => user.id);
  }

  it("lists and reads users only from the selected facility", async () => {
    const primary = await request(app)
      .get("/api/users")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(ids(primary)).toContain("users-primary-only");
    expect(ids(primary)).not.toContain("users-secondary-only");

    const secondary = await request(app)
      .get("/api/users")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "users-secondary")
      .expect(200);
    expect(ids(secondary)).toContain("users-secondary-only");
    expect(ids(secondary)).not.toContain("users-primary-only");

    await request(app)
      .get("/api/users/users-primary-only")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "users-secondary")
      .expect(404);
  });

  it("creates a managed account only in the selected facility", async () => {
    const created = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "users-secondary")
      .send({
        email: "created-secondary@example.com",
        name: "Created Secondary",
        password: "CreatedSecondaryPassword123",
        role: "member",
      })
      .expect(201);

    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("facilityId")
        .where("userId", "=", created.body.id)
        .execute(),
    ).resolves.toEqual([{ facilityId: "users-secondary" }]);
  });

  it("removes a shared user from one facility without deleting the account", async () => {
    await request(app)
      .delete("/api/users/users-shared")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "users-secondary")
      .expect(200);

    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", "users-shared")
        .executeTakeFirst(),
    ).resolves.toEqual({ id: "users-shared" });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("facilityId")
        .where("userId", "=", "users-shared")
        .execute(),
    ).resolves.toEqual([{ facilityId: "primary" }]);
    await expect(
      database.db
        .selectFrom("bookingAnalyticsEvents")
        .select(["memberUserId", "trainerUserId", "activityName"])
        .where("id", "=", "users-shared-history")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      memberUserId: null,
      trainerUserId: "users-admin",
      activityName: "Historical class",
    });
  });

  it("rolls back a bulk removal when one account requires retention review", async () => {
    const createManagedUser = async (suffix: string) =>
      request(app)
        .post("/api/users")
        .set("Cookie", adminCookie)
        .set("X-Facility-Id", "users-secondary")
        .send({
          email: `bulk-${suffix}@example.com`,
          name: `Bulk ${suffix}`,
          password: `Bulk${suffix}Password123`,
          role: "member",
        })
        .expect(201);
    const removable = await createManagedUser("removable");
    const retained = await createManagedUser("retained");
    const now = Date.now();
    await database.db
      .insertInto("supportTickets")
      .values({
        id: "users-bulk-retained-ticket",
        publicId: "UFS-BULKRET001",
        facilityId: "users-secondary",
        requesterUserId: retained.body.id,
        assigneeUserId: null,
        subject: "Retention review",
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

    await request(app)
      .post("/api/users/bulk/delete")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "users-secondary")
      .send({ userIds: [removable.body.id, retained.body.id] })
      .expect(409);

    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "in", [removable.body.id, retained.body.id])
        .execute(),
    ).resolves.toHaveLength(2);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("class tenant isolation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-class-tenant-"));
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
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
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
          id: "tenant-admin",
          email: "tenant-admin@example.com",
          phone: null,
          name: "Tenant Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("TenantAdminPassword123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: now,
        },
        {
          id: "tenant-member",
          email: "tenant-member@example.com",
          phone: null,
          name: "Tenant Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("TenantMemberPassword123"),
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
          id: "primary:tenant-admin",
          facilityId: "primary",
          userId: "tenant-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:tenant-admin",
          facilityId: "secondary",
          userId: "tenant-admin",
          role: "owner",
          status: "active",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: "primary:tenant-member",
          facilityId: "primary",
          userId: "tenant-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:tenant-member",
          facilityId: "secondary",
          userId: "tenant-member",
          role: "member",
          status: "active",
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ])
      .execute();
    await database.db
      .insertInto("gymClasses")
      .values([
        {
          id: "primary-class",
          facilityId: "primary",
          name: "Primary class",
          description: "",
          trainerId: "tenant-admin",
          trainerName: "Tenant Admin",
          maxCapacity: 10,
          scheduledAt: now + 86_400_000,
        },
        {
          id: "secondary-class",
          facilityId: "secondary",
          name: "Secondary class",
          description: "",
          trainerId: "tenant-admin",
          trainerName: "Tenant Admin",
          maxCapacity: 10,
          scheduledAt: now + 86_400_000,
        },
      ])
      .execute();
    await database.db
      .insertInto("bookings")
      .values([
        {
          id: "primary-booking",
          classId: "primary-class",
          userId: "tenant-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
        {
          id: "secondary-booking",
          classId: "secondary-class",
          userId: "tenant-member",
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "tenant-admin@example.com",
        password: "TenantAdminPassword123",
        accessPortal: "staff",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    memberCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "tenant-member@example.com",
        password: "TenantMemberPassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("lists only classes owned by the selected facility", async () => {
    const primary = await request(app)
      .get("/api/classes")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(primary.body.map((item: { id: string }) => item.id)).toEqual([
      "primary-class",
    ]);

    const secondary = await request(app)
      .get("/api/classes")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(secondary.body.map((item: { id: string }) => item.id)).toEqual([
      "secondary-class",
    ]);
  });

  it("rejects cross-facility class reads and writes", async () => {
    await request(app)
      .get("/api/classes/primary-class")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(403);

    await request(app)
      .get("/api/admin/classes/primary-class")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(404);

    const created = await request(app)
      .post("/api/admin/classes")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        name: "Created in secondary",
        description: "",
        trainerId: "tenant-admin",
        trainerName: "Tenant Admin",
        maxCapacity: 12,
        scheduledAt: Date.now() + 172_800_000,
      })
      .expect(201);
    expect(created.body.facilityId).toBe("secondary");

    const stored = await database.db
      .selectFrom("gymClasses")
      .select("facilityId")
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.facilityId).toBe("secondary");
  });

  it("protects class history and reports partial batch deletion", async () => {
    const now = Date.now();
    await database.db
      .insertInto("gymClasses")
      .values({
        id: "empty-primary-class",
        facilityId: "primary",
        name: "Empty primary class",
        description: "",
        trainerId: "tenant-admin",
        trainerName: "Tenant Admin",
        maxCapacity: 8,
        scheduledAt: now + 172_800_000,
      })
      .execute();

    const protectedResponse = await request(app)
      .delete("/api/admin/classes/primary-class")
      .set("Cookie", adminCookie)
      .expect(409);
    expect(protectedResponse.body).toMatchObject({
      code: "CLASS_DELETION_REQUIRES_REVIEW",
      blockers: { bookings: 1 },
    });

    const batch = await request(app)
      .post("/api/admin/classes/batch-delete")
      .set("Cookie", adminCookie)
      .send({ classIds: ["primary-class", "empty-primary-class"] })
      .expect(200);
    expect(batch.body.deletedIds).toEqual(["empty-primary-class"]);
    expect(batch.body.failed).toEqual([
      expect.objectContaining({
        id: "primary-class",
        code: "CLASS_DELETION_REQUIRES_REVIEW",
      }),
    ]);

    expect(
      await database.db
        .selectFrom("bookings")
        .select("id")
        .where("id", "=", "primary-booking")
        .executeTakeFirst(),
    ).toBeTruthy();
  });

  it("rejects insecure session media links before storing content", async () => {
    const response = await request(app)
      .put("/api/classes/primary-class/session-content")
      .set("Cookie", adminCookie)
      .send({
        terminology: "Training plan",
        commentsEnabled: true,
        blocks: [
          {
            id: "unsafe-media",
            type: "custom",
            title: "Unsafe media",
            instructions: "",
            exercises: [],
            sets: "",
            repetitions: "",
            duration: "",
            rest: "",
            percentage: "",
            load: "",
            material: [],
            adaptations: "",
            mediaUrls: ["http://example.com/session"],
            notes: "",
          },
        ],
      })
      .expect(400);

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "blocks[0].mediaUrls[0]" }),
      ]),
    );
  });

  it("derives booking isolation from the owning class", async () => {
    const primary = await request(app)
      .get("/api/bookings/user/tenant-member")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(primary.body.map((item: { id: string }) => item.id)).toEqual([
      "primary-booking",
    ]);

    const secondary = await request(app)
      .get("/api/bookings/user/tenant-member")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(secondary.body.map((item: { id: string }) => item.id)).toEqual([
      "secondary-booking",
    ]);

    await request(app)
      .delete("/api/bookings/secondary-booking")
      .set("Cookie", memberCookie)
      .send({ userId: "tenant-member" })
      .expect(403);

    const unchanged = await database.db
      .selectFrom("bookings")
      .select("status")
      .where("id", "=", "secondary-booking")
      .executeTakeFirstOrThrow();
    expect(unchanged.status).toBe("confirmed");
  });

  it("returns only the reputation owned by the selected facility", async () => {
    const reputation = await import("../services/booking-reputation.js");
    await reputation.adjustBookingReputation({
      userId: "tenant-member",
      facilityId: "primary",
      pointsDelta: -5,
      reason: "Primary tenant check",
    });
    await reputation.adjustBookingReputation({
      userId: "tenant-member",
      facilityId: "secondary",
      pointsDelta: -20,
      reason: "Secondary tenant check",
    });

    const primary = await request(app)
      .get("/api/bookings/reputation/tenant-member")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(primary.body).toMatchObject({ score: 95 });

    const secondary = await request(app)
      .get("/api/bookings/reputation/tenant-member")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(secondary.body).toMatchObject({ score: 80 });
  });
});

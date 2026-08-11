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
      .values({
        id: "tenant-admin",
        email: "tenant-admin@example.com",
        phone: null,
        name: "Tenant Admin",
        avatarDataUrl: "",
        password: await auth.hashPassword("TenantAdminPassword123"),
        role: "admin",
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt: now,
      })
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

    app = (await import("../index.js")).app;
    adminCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "tenant-admin@example.com",
        password: "TenantAdminPassword123",
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
});

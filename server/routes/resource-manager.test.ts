import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("resource manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let resources: typeof import("../services/resource-manager.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-resources-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    database = await import("../db/client.js");
    resources = await import("../services/resource-manager.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await resources.startResourceManager();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "resources-admin",
          email: "resources-admin@example.com",
          phone: null,
          name: "Resources Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("ResourcesPassword123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "resources-member",
          email: "resources-member@example.com",
          phone: null,
          name: "Resources Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("ResourcesPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "primary:resources-admin",
        facilityId: "primary",
        userId: "resources-admin",
        role: "owner",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();

    app = (await import("../index.js")).app;
    const adminLogin = await request(app).post("/api/auth/login").send({
      identifier: "resources-admin@example.com",
      password: "ResourcesPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    const memberLogin = await request(app).post("/api/auth/login").send({
      identifier: "resources-member@example.com",
      password: "ResourcesPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    adminCookie = adminLogin.headers["set-cookie"][0];
    memberCookie = memberLogin.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await resources.stopResourceManager();
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("exposes only registered tasks to administrators", async () => {
    const response = await request(app)
      .get("/api/admin/resource-manager")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "expired-auth-cleanup" }),
        expect.objectContaining({
          id: "expired-e2ee-attachment-cleanup",
          enabled: true,
        }),
        expect.objectContaining({ id: "sqlite-query-planner" }),
        expect.objectContaining({ id: "booking-integrity-cleanup" }),
        expect.objectContaining({ id: "project-runtime-cleanup" }),
        expect.objectContaining({
          id: "deleted-account-residual-cleanup",
          enabled: true,
        }),
        expect.objectContaining({
          id: "source-hygiene-audit",
          enabled: false,
        }),
        expect.objectContaining({
          id: "environment-readiness-audit",
          enabled: true,
        }),
        expect.objectContaining({
          id: "encryption-readiness-audit",
          enabled: true,
        }),
      ]),
    );
    expect(
      response.body.tasks.find(
        (task: { id: string }) => task.id === "project-runtime-cleanup",
      ),
    ).toMatchObject({ intervalMs: 300_000, enabled: true });
    expect(response.body.process).toMatchObject({
      uptimeSeconds: expect.any(Number),
      memory: {
        rssBytes: expect.any(Number),
        heapUsedBytes: expect.any(Number),
      },
    });
    expect(response.body.residualProcessChecks).toMatchObject({
      totalChecks: expect.any(Number),
      staleRecordsRemoved: expect.any(Number),
      lastCheck: expect.anything(),
    });
  });

  it("runs the source audit without deleting project files", async () => {
    const checksBefore = (
      await request(app)
        .get("/api/admin/resource-manager")
        .set("Cookie", adminCookie)
        .expect(200)
    ).body.residualProcessChecks.totalChecks;
    const response = await request(app)
      .post("/api/admin/resource-manager/tasks/source-hygiene-audit/run")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "source-hygiene-audit",
      lastResultCount: expect.any(Number),
      lastSummary: expect.any(String),
      lastFindings: expect.any(Array),
    });

    const status = await request(app)
      .get("/api/admin/resource-manager")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(status.body.residualProcessChecks.totalChecks).toBe(
      checksBefore + 2,
    );
    expect(status.body.residualProcessChecks.lastCheck).toMatchObject({
      phase: "task-finish",
      taskId: "source-hygiene-audit",
    });
  });

  it("keeps account lifecycle decisions outside resource cleanup", async () => {
    const response = await request(app)
      .post(
        "/api/admin/resource-manager/tasks/deleted-account-residual-cleanup/run",
      )
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "deleted-account-residual-cleanup",
      lastResultCount: 0,
    });
    expect(response.body.lastSummary.includes("orphaned deleted-account")).toBe(
      true,
    );
  });

  it("rejects resource controls for members", async () => {
    await request(app)
      .get("/api/admin/resource-manager")
      .set("Cookie", memberCookie)
      .expect(403);
  });

  it("pauses and resumes a registered task", async () => {
    const paused = await request(app)
      .patch("/api/admin/resource-manager/tasks/expired-auth-cleanup")
      .set("Cookie", adminCookie)
      .send({ enabled: false })
      .expect(200);
    expect(paused.body).toMatchObject({
      id: "expired-auth-cleanup",
      enabled: false,
      state: "paused",
    });

    const resumed = await request(app)
      .patch("/api/admin/resource-manager/tasks/expired-auth-cleanup")
      .set("Cookie", adminCookie)
      .send({ enabled: true })
      .expect(200);
    expect(resumed.body).toMatchObject({
      id: "expired-auth-cleanup",
      enabled: true,
      state: "idle",
    });
  });

  it("protects critical tasks and reports unknown tasks clearly", async () => {
    const critical = await request(app)
      .patch("/api/admin/resource-manager/tasks/booking-integrity-cleanup")
      .set("Cookie", adminCookie)
      .send({ enabled: false })
      .expect(409);
    expect(critical.body.code).toBe("CRITICAL_TASK_REQUIRED");

    const missing = await request(app)
      .post("/api/admin/resource-manager/tasks/not-registered/run")
      .set("Cookie", adminCookie)
      .expect(404);
    expect(missing.body.code).toBe("RESOURCE_TASK_NOT_FOUND");
  });

  it("stops and restarts once without leaving duplicate schedules", async () => {
    await resources.stopResourceManager();
    expect(resources.getResourceManagerStatus().started).toBe(false);

    await Promise.all([
      resources.startResourceManager(),
      resources.startResourceManager(),
    ]);
    const status = resources.getResourceManagerStatus();
    expect(status.started).toBe(true);
    expect(
      status.tasks.every((task) => !task.enabled || task.nextRunAt !== null),
    ).toBe(true);
  });
});

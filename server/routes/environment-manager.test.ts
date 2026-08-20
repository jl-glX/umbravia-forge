import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createActivePlatformOperator,
  createActiveTestFacility,
} from "../testing/facility-fixtures.js";

describe("environment manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;
  let environmentId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-environments-"));
    vi.stubEnv("DATA_DIRECTORY", join(directory, "active"));
    vi.stubEnv("ENVIRONMENT_DATA_ROOT", join(directory, "environments"));
    vi.stubEnv("ENVIRONMENT_MANAGER_MUTATIONS_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const password = await auth.hashPassword("EnvironmentPassword123");
    await database.db
      .insertInto("users")
      .values([
        {
          id: "environment-admin",
          email: "environment-admin@example.com",
          phone: null,
          name: "Environment Admin",
          avatarDataUrl: "",
          password,
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "environment-member",
          email: "environment-member@example.com",
          phone: null,
          name: "Environment Member",
          avatarDataUrl: "",
          password,
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await createActiveTestFacility(database.db, "facility-alpha");
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "facility-alpha:environment-admin",
        facilityId: "facility-alpha",
        userId: "environment-admin",
        role: "owner",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();
    await createActivePlatformOperator(database.db, "environment-admin");

    app = (await import("../index.js")).app;
    const adminLogin = await request(app).post("/api/auth/login").send({
      identifier: "environment-admin@example.com",
      password: "EnvironmentPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    const memberLogin = await request(app).post("/api/auth/login").send({
      identifier: "environment-member@example.com",
      password: "EnvironmentPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    adminCookie = adminLogin.headers["set-cookie"][0];
    memberCookie = memberLogin.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("restricts environment operations to administrators", async () => {
    await request(app)
      .get("/api/admin/environment-manager")
      .set("Cookie", memberCookie)
      .expect(403);

    await request(app)
      .get("/api/admin/capability-roadmap")
      .set("Cookie", memberCookie)
      .expect(403);
  });

  it("exposes the capability roadmap to administrators", async () => {
    const response = await request(app)
      .get("/api/admin/capability-roadmap")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.capabilities.length).toBeGreaterThan(0);
    expect(response.body.summary).toMatchObject({
      implemented: expect.any(Number),
      partial: expect.any(Number),
      prepared: expect.any(Number),
      missing: expect.any(Number),
    });
  });

  it("includes coordinator-approved email readiness without secret values", async () => {
    const response = await request(app)
      .get("/api/admin/environment-manager")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.communication).toMatchObject({
      productionLike: false,
      inbound: { state: "disabled", provider: "unconfigured" },
      queueProtection: { state: "development_fallback" },
    });
    expect(JSON.stringify(response.body.communication)).not.toMatch(
      /password|secret|token|private[-_ ]?key/i,
    );
  });

  it("creates an isolated SQLite environment", async () => {
    const response = await request(app)
      .post("/api/admin/environment-manager/environments")
      .set("Cookie", adminCookie)
      .send({
        name: "Centro Sandbox",
        slug: "centro-sandbox",
        kind: "customer_sandbox",
        locale: "es",
      })
      .expect(201);

    expect(response.body).toMatchObject({
      name: "Centro Sandbox",
      slug: "centro-sandbox",
      kind: "customer_sandbox",
      status: "ready",
    });
    environmentId = response.body.id;
  });

  it("prepares a non-destructive PostgreSQL migration review", async () => {
    const response = await request(app)
      .post(
        `/api/admin/environment-manager/environments/${environmentId}/migration-plan`,
      )
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.environment.status).toBe("migration_ready");
    expect(response.body.plan).toMatchObject({
      ready: true,
      targetProvider: "postgresql",
      executionEnabled: false,
    });
  });

  it("rejects paths disguised as environment slugs", async () => {
    await request(app)
      .post("/api/admin/environment-manager/environments")
      .set("Cookie", adminCookie)
      .send({
        name: "Escapes Root",
        slug: "../outside",
        kind: "commercial_mvp",
      })
      .expect(400);
  });
});

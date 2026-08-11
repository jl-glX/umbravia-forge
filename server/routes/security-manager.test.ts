import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("security manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;
  let tenantAdminCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-security-manager-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const password = await auth.hashPassword("SecurityManagerPassword123");
    await database.db
      .insertInto("users")
      .values([
        {
          id: "security-manager-admin",
          email: "security-manager-admin@example.com",
          phone: null,
          name: "Security Manager Admin",
          avatarDataUrl: "",
          password,
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "security-manager-member",
          email: "security-manager-member@example.com",
          phone: null,
          name: "Security Manager Member",
          avatarDataUrl: "",
          password,
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "security-manager-tenant-admin",
          email: "tenant-security-admin@example.com",
          phone: null,
          name: "Tenant Security Admin",
          avatarDataUrl: "",
          password,
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "security-secondary",
        slug: "security-secondary",
        name: "Security Secondary",
        logoDataUrl: "",
        accentColor: "#0f172a",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "primary:security-manager-admin",
          facilityId: "primary",
          userId: "security-manager-admin",
          role: "owner",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "security-secondary:security-manager-tenant-admin",
          facilityId: "security-secondary",
          userId: "security-manager-tenant-admin",
          role: "owner",
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
      .execute();
    await database.db
      .insertInto("securityEvents")
      .values({
        id: "security-manager-event",
        userId: null,
        type: "risk_observed",
        createdAt: Date.now(),
        metadata: JSON.stringify({
          surface: "password_login",
          level: "high",
          reason: "automation_marker",
          secret: "must-not-leak",
          nested: { token: "must-not-leak" },
        }),
      })
      .execute();

    app = (await import("../index.js")).app;
    const adminLogin = await request(app).post("/api/auth/login").send({
      identifier: "security-manager-admin@example.com",
      password: "SecurityManagerPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    const memberLogin = await request(app).post("/api/auth/login").send({
      identifier: "security-manager-member@example.com",
      password: "SecurityManagerPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    const tenantAdminLogin = await request(app).post("/api/auth/login").send({
      identifier: "tenant-security-admin@example.com",
      password: "SecurityManagerPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    adminCookie = adminLogin.headers["set-cookie"][0];
    memberCookie = memberLogin.headers["set-cookie"][0];
    tenantAdminCookie = tenantAdminLogin.headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("reports controls, observations and manager coordination to admins", async () => {
    const response = await request(app)
      .get("/api/admin/security-manager")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      mode: "observe",
      automaticBlockingEnabled: false,
      controls: {
        captcha: {
          configured: true,
          execution: "manual",
          serverValidation: true,
        },
        riskEngine: "observe",
      },
      metrics: {
        riskObservations7d: 1,
        highRiskObservations7d: 1,
      },
      coordination: {
        mode: "shared-runtime",
        managers: [
          "account",
          "security",
          "resource",
          "encryption",
          "environment",
          "email",
          "notification",
          "support",
        ],
      },
    });
    expect(response.body.encryption).toMatchObject({
      healthy: true,
      policy: {
        rawKeyMaterialExposed: false,
        automaticKeyRotationEnabled: false,
        keyChangesRequireExplicitOperatorAction: true,
      },
    });
    expect(
      response.body.recentEvents.find(
        (event: { type: string }) => event.type === "risk_observed",
      ),
    ).toMatchObject({
      type: "risk_observed",
      metadata: { level: "high", surface: "password_login" },
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
  });

  it("rejects security manager access for members", async () => {
    await request(app)
      .get("/api/admin/security-manager")
      .set("Cookie", memberCookie)
      .expect(403);
  });

  it("keeps tenant administrators outside platform-wide security telemetry", async () => {
    await request(app)
      .get("/api/admin/security-manager")
      .set("Cookie", tenantAdminCookie)
      .expect(403);
  });

  it("exposes CAPTCHA readiness without revealing secrets", async () => {
    const response = await request(app)
      .get("/api/auth/captcha-status")
      .expect(200);

    expect(response.body).toEqual({
      available: true,
      provider: "cloudflare_turnstile",
      execution: "manual",
      browserVerification: true,
      serverValidation: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});

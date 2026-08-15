import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("email manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-email-manager-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", "25");
    vi.stubEnv("EMAIL_FROM", "Umbravia Forge <noreply@example.test>");
    vi.stubEnv("SUPPORT_EMAIL_INBOUND_ENABLED", "false");
    vi.resetModules();

    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const password = await auth.hashPassword("EmailManagerPassword123");
    await database.db
      .insertInto("users")
      .values([
        {
          id: "email-manager-admin",
          email: "email-admin@example.test",
          phone: null,
          name: "Email Admin",
          avatarDataUrl: "",
          password,
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "email-manager-member",
          email: "email-member@example.test",
          phone: null,
          name: "Email Member",
          avatarDataUrl: "",
          password,
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "primary:email-manager-admin",
        facilityId: "primary",
        userId: "email-manager-admin",
        role: "owner",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();
    await database.db
      .insertInto("emailDeliveries")
      .values({
        id: "email-manager-failed-delivery",
        userId: null,
        kind: "support_update",
        recipient: "private-recipient@example.test",
        locale: "es",
        payloadEncrypted: "private-encrypted-payload",
        status: "failed",
        attempts: 3,
        maxAttempts: 3,
        nextAttemptAt: Date.now(),
        messageId: null,
        lastError: "smtp_unavailable",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sentAt: null,
        expiresAt: Date.now() + 60_000,
      })
      .execute();

    app = (await import("../index.js")).app;
    const adminLogin = await request(app).post("/api/auth/login").send({
      identifier: "email-admin@example.test",
      password: "EmailManagerPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    const memberLogin = await request(app).post("/api/auth/login").send({
      identifier: "email-member@example.test",
      password: "EmailManagerPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    adminCookie = adminLogin.headers["set-cookie"][0];
    memberCookie = memberLogin.headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("centralizes status without exposing recipients or encrypted payloads", async () => {
    const response = await request(app)
      .get("/api/admin/email-manager")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      mode: "manage-confirm-alert",
      readiness: {
        healthy: true,
        outbound: { state: "configured", mode: "local_mta" },
        inbound: { state: "disabled" },
      },
      queue: {
        byStatus: { failed: 1 },
        recentFailures: [
          expect.objectContaining({
            kind: "support_update",
            errorCode: "smtp_unavailable",
          }),
        ],
      },
      ownership: {
        manager: "email",
        scheduledBy: "resource",
        alertsDistributedBy: "coordinator",
        secretValuesExposed: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "private-recipient@example.test",
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "private-encrypted-payload",
    );
  });

  it("confirms readiness through the coordinator", async () => {
    const response = await request(app)
      .post("/api/admin/email-manager/audit")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      healthy: true,
      confirmations: expect.arrayContaining([
        "outbound_transport_configured",
        "queue_protection_available",
      ]),
    });
  });

  it("reports direct MX delivery as a distinct TLS-enforced transport", async () => {
    const { getEmailManagerReadiness } =
      await import("../services/email-manager.js");
    const readiness = getEmailManagerReadiness({
      NODE_ENV: "production",
      EMAIL_TRANSPORT_MODE: "direct_mx",
      EMAIL_FROM: "Umbravia Forge <no-reply@example.test>",
      EMAIL_DIRECT_HELO_NAME: "mail.example.test",
      EMAIL_DKIM_DOMAIN: "example.test",
      EMAIL_DKIM_SELECTOR: "mail",
      EMAIL_DKIM_PRIVATE_KEY_PATH: "/run/credentials/mail-dkim.pem",
      EMAIL_QUEUE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      SUPPORT_EMAIL_INBOUND_ENABLED: "false",
    });

    expect(readiness).toMatchObject({
      healthy: true,
      outbound: {
        state: "configured",
        mode: "direct_mx",
        tls: "required_starttls",
        authenticated: false,
      },
      confirmations: expect.arrayContaining([
        "direct_mx_transport_configured",
        "outbound_transport_configured",
      ]),
    });
  });

  it("keeps manager controls restricted to administrators", async () => {
    await request(app)
      .get("/api/admin/email-manager")
      .set("Cookie", memberCookie)
      .expect(403);
  });
});

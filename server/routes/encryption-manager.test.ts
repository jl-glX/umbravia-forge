import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("encryption manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-encryption-manager-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MFA_ENCRYPTION_KEY", "");
    vi.stubEnv("EMAIL_QUEUE_ENCRYPTION_KEY", "");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "false");
    vi.resetModules();

    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const password = await auth.hashPassword("EncryptionManagerPassword123");
    await database.db
      .insertInto("users")
      .values([
        {
          id: "encryption-manager-admin",
          email: "encryption-manager-admin@example.com",
          phone: null,
          name: "Encryption Manager Admin",
          avatarDataUrl: "",
          password,
          role: "admin",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
        {
          id: "encryption-manager-member",
          email: "encryption-manager-member@example.com",
          phone: null,
          name: "Encryption Manager Member",
          avatarDataUrl: "",
          password,
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
    const adminLogin = await request(app).post("/api/auth/login").send({
      identifier: "encryption-manager-admin@example.com",
      password: "EncryptionManagerPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    const memberLogin = await request(app).post("/api/auth/login").send({
      identifier: "encryption-manager-member@example.com",
      password: "EncryptionManagerPassword123",
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

  it("returns a safe coordinated cryptographic overview to administrators", async () => {
    const response = await request(app)
      .get("/api/admin/encryption-manager")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({
      healthy: true,
      policy: {
        rawKeyMaterialExposed: false,
        automaticKeyRotationEnabled: false,
        keyChangesRequireExplicitOperatorAction: true,
      },
      coordination: {
        mode: "shared-runtime",
        managers: expect.arrayContaining([
          "account",
          "security",
          "resource",
          "encryption",
        ]),
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("ENCRYPTION_KEY");
  });

  it("runs an explicit read-only audit and publishes a manager signal", async () => {
    const response = await request(app)
      .post("/api/admin/encryption-manager/audit")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body).toMatchObject({ healthy: true, findings: [] });

    const overview = await request(app)
      .get("/api/admin/encryption-manager")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(overview.body.coordination.recentSignals[0]).toMatchObject({
      source: "encryption",
      code: "ENCRYPTION_AUDIT_PASSED",
    });
  });

  it("rejects encryption manager access for members", async () => {
    await request(app)
      .get("/api/admin/encryption-manager")
      .set("Cookie", memberCookie)
      .expect(403);
  });
});

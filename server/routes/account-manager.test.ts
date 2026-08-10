import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("account manager API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let cookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-account-manager-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "account-manager@example.com",
      "Account Manager",
      "StrongPassword123",
    );
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: Date.now() })
      .where("id", "=", account.user.id)
      .execute();
    app = (await import("../index.js")).app;
    const login = await request(app).post("/api/auth/login").send({
      identifier: "account-manager@example.com",
      password: "StrongPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    cookie = login.headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("requires an authenticated account session", async () => {
    await request(app).get("/api/account/manager").expect(401);
  });

  it("returns a coordinated overview without enabling planned functions", async () => {
    const response = await request(app)
      .get("/api/account/manager")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.body).toMatchObject({
      accountStatus: "active",
      security: {
        mfaEnabled: false,
        passkeyCount: 0,
        activeSessionCount: 2,
      },
      lifecycle: { deletionExecutionEnabled: false },
      recovery: {
        availableMethods: ["password", "email", "code", "passkey"],
      },
      continuity: {
        status: "draft_available",
        executionEnabled: false,
        identityTransferAllowed: false,
        representations: [],
      },
      dataProtection: {
        healthy: true,
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            id: "password_hashing",
            primitive: "Argon2id",
            state: "active",
          }),
          expect.objectContaining({
            id: "e2ee_relay",
            state: "client_managed",
          }),
        ]),
      },
    });
    expect(response.body.recovery.plannedMethods).toEqual(["support"]);
  });

  it("remains available while an authenticated account is under security review", async () => {
    await database.db
      .updateTable("users")
      .set({ accountStatus: "security_review" })
      .where("email", "=", "account-manager@example.com")
      .execute();

    const response = await request(app)
      .get("/api/account/manager")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.accountStatus).toBe("security_review");

    await database.db
      .updateTable("users")
      .set({ accountStatus: "active" })
      .where("email", "=", "account-manager@example.com")
      .execute();
  });
});

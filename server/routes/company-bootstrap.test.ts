import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("one-time company head bootstrap", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-head-bootstrap-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update("head@example.com").digest("hex"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "first-verified-account",
          email: "head@example.com",
          phone: null,
          name: "Initial Head",
          avatarDataUrl: "",
          password: await auth.hashPassword("InitialHeadPassword123"),
          role: "member",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
        {
          id: "later-account",
          email: "later@example.com",
          phone: null,
          name: "Later Account",
          avatarDataUrl: "",
          password: await auth.hashPassword("LaterAccountPassword123"),
          role: "member",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
      ])
      .execute();
    app = (await import("../index.js")).app;
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("lets the first verified account establish the head exactly once", async () => {
    const login = await request(app).post("/api/auth/login").send({
      identifier: "head@example.com",
      password: "InitialHeadPassword123",
      accessPortal: "support",
      rememberDevice: false,
    });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0];

    await request(app)
      .post("/api/umf-support/bootstrap-head")
      .set("Cookie", cookie)
      .expect(201);

    await expect(
      database.db
        .selectFrom("corporateBootstrapState")
        .selectAll()
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      id: "company_head",
      claimedByUserId: "first-verified-account",
    });
    await expect(
      database.db
        .selectFrom("companyStaffProfiles")
        .select(["position", "status"])
        .where("userId", "=", "first-verified-account")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ position: "platform_head", status: "active" });

    await request(app)
      .post("/api/umf-support/bootstrap-head")
      .set("Cookie", cookie)
      .expect(409);
  });

  it("does not reopen bootstrap after the granted roles are removed", async () => {
    await database.db
      .deleteFrom("companyStaffProfiles")
      .where("userId", "=", "first-verified-account")
      .execute();
    await database.db
      .deleteFrom("umfSupportStaff")
      .where("userId", "=", "first-verified-account")
      .execute();
    await database.db
      .deleteFrom("platformOperators")
      .where("userId", "=", "first-verified-account")
      .execute();

    const login = await request(app).post("/api/auth/login").send({
      identifier: "later@example.com",
      password: "LaterAccountPassword123",
      accessPortal: "support",
      rememberDevice: false,
    });
    expect(login.status).toBe(401);
  });
});

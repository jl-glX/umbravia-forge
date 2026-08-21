import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("UMF Support designated head onboarding", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-head-onboarding-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update("head@example.com").digest("hex"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    app = (await import("../index.js")).app;
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects an unknown role before creating a corporate role request", async () => {
    await request(app)
      .post("/api/umf-support/access-requests")
      .send({
        email: "other@example.com",
        name: "Other",
        lastName: "Applicant",
        requestedRole: "platform_head",
        locale: "es",
      })
      .expect(400);

    await expect(
      database.db
        .selectFrom("umfSupportAccessRequests")
        .select("id")
        .where("email", "=", "other@example.com")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("requires the designated email and code, then creates the definitive password", async () => {
    const submitted = await request(app)
      .post("/api/umf-support/access-requests")
      .send({
        email: "head@example.com",
        name: "Platform",
        lastName: "Head",
        requestedRole: "director",
        locale: "es",
      })
      .expect(202);
    expect(submitted.body).toMatchObject({
      accepted: true,
      demoActivationCode: expect.stringMatching(/^\d{6}$/),
    });

    const pending = await database.db
      .selectFrom("umfSupportAccessRequests")
      .select(["id", "status", "requestedRole", "activationKind"])
      .where("email", "=", "head@example.com")
      .executeTakeFirstOrThrow();
    expect(pending).toMatchObject({
      status: "approved",
      requestedRole: "director",
      activationKind: "designated_head",
    });
    await expect(
      database.db
        .selectFrom("umfSupportAccessCredentials")
        .select("requestId")
        .where("requestId", "=", pending.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();

    await request(app)
      .post("/api/umf-support/activate")
      .send({
        email: "head@example.com",
        password: "weak",
        code: submitted.body.demoActivationCode,
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(400);

    const activated = await request(app)
      .post("/api/umf-support/activate")
      .send({
        email: "head@example.com",
        password: "DefinitiveHeadPassword123",
        code: submitted.body.demoActivationCode,
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);

    const userId = activated.body.user.id as string;
    await expect(
      database.db
        .selectFrom("users")
        .select(["accountStatus", "emailVerifiedAt", "identityRealm"])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      accountStatus: "active",
      emailVerifiedAt: expect.any(Number),
      identityRealm: "corporate_support",
    });
    await expect(
      database.db
        .selectFrom("platformOperators")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select(["role", "status"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ role: "director", status: "active" });
    await expect(
      database.db
        .selectFrom("companyStaffProfiles")
        .select(["position", "status"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ position: "platform_head", status: "active" });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("umfSupportAccessCredentials")
        .select("requestId")
        .where("requestId", "=", pending.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();

    const login = await request(app).post("/api/umf-support/login").send({
      email: "head@example.com",
      password: "DefinitiveHeadPassword123",
      rememberDevice: false,
    });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"][0]).toContain("umf-support_session=");
  });
});

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("UMF Support closed head registration", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-head-registration-"));
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

  it("rejects an email that direction did not preauthorize without retaining data", async () => {
    await request(app)
      .post("/api/umf-support/register")
      .send({
        email: "unknown@example.com",
        name: "Unknown",
        lastName: "Applicant",
        password: "UnknownPassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(400);

    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("email", "=", "unknown@example.com")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("umfSupportAccessRequests")
        .select("id")
        .where("email", "=", "unknown@example.com")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("lets only the server-designated first head register and verify the mailbox", async () => {
    const browser = request.agent(app);
    const registered = await browser
      .post("/api/umf-support/register")
      .send({
        email: "head@example.com",
        name: "Platform",
        lastName: "Head",
        password: "DefinitiveHeadPassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    expect(registered.body).toMatchObject({
      verificationRequired: true,
      demoVerificationCode: expect.stringMatching(/^\d{6}$/),
      user: {
        identityRealm: "corporate_support",
        accountStatus: "pending_verification",
      },
    });

    const userId = registered.body.user.id as string;
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["platformScope", "kind"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      platformScope: "support",
      kind: "email_verification",
    });

    await browser
      .post("/api/umf-support/verify-email")
      .send({ code: "000000" })
      .expect(400);
    const verification = await import("../services/email-verification.js");
    await expect(
      verification.verifyEmailCode(
        userId,
        registered.body.demoVerificationCode,
        "corporate_support",
      ),
    ).resolves.toBe(true);
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await browser
      .post("/api/umf-support/verify-email")
      .send({ code: registered.body.demoVerificationCode })
      .expect(200);

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
        .selectFrom("platformOperators")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("userId")
        .where("userId", "=", userId)
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

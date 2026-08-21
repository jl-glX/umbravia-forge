import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify as verifyArgon2 } from "argon2";
import request from "supertest";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("progressive account signup", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-signup-flow-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("EMAIL_VERIFICATION_ENABLED", "true");
    // This suite exercises several independent signup outcomes from one
    // in-process client. Rate-limit behavior has its own focused tests.
    vi.stubEnv("SIGNUP_RATE_LIMIT_MAX_REQUESTS", "50");
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    app = (await import("../index.js")).app;
  });

  afterAll(async () => {
    await database.closeDatabase();
    const reopened = new Database(join(directory, "database.sqlite"), {
      readonly: true,
    });
    try {
      const persisted = reopened
        .prepare(
          `SELECT email, name, lastName, countryCode, accountStatus,
                  emailVerifiedAt, password
             FROM users
            WHERE email = ?`,
        )
        .get("new-account@example.com") as
        | {
            email: string;
            name: string;
            lastName: string;
            countryCode: string;
            accountStatus: string;
            emailVerifiedAt: number | null;
            password: string;
          }
        | undefined;
      expect(persisted).toMatchObject({
        email: "new-account@example.com",
        name: "New",
        lastName: "Account",
        countryCode: "ES",
        accountStatus: "active",
        emailVerifiedAt: expect.any(Number),
      });
      expect(persisted?.password).toMatch(/^\$argon2id\$/);
      await expect(
        verifyArgon2(persisted?.password ?? "", "ProgressivePassword123"),
      ).resolves.toBe(true);
    } finally {
      reopened.close();
    }
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists acknowledgements and activates the account after code verification", async () => {
    const signup = await request(app).post("/api/auth/signup").send({
      email: "new-account@example.com",
      name: "New",
      lastName: "Account",
      password: "ProgressivePassword123",
      countryCode: "ES",
      locale: "es",
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);
    expect(signup.body).toMatchObject({
      verificationRequired: true,
      verificationEmailSent: false,
      demoVerificationCode: expect.stringMatching(/^\d{6}$/),
    });
    const cookie = signup.headers["set-cookie"][0];
    expect(signup.body.user).not.toHaveProperty("password");
    const storedCredential = await database.db
      .selectFrom("users")
      .select(["email", "name", "lastName", "countryCode", "password"])
      .where("email", "=", "new-account@example.com")
      .executeTakeFirstOrThrow();
    expect(storedCredential).toMatchObject({
      email: "new-account@example.com",
      name: "New",
      lastName: "Account",
      countryCode: "ES",
    });
    expect(storedCredential.password).not.toBe("ProgressivePassword123");
    expect(storedCredential.password).toMatch(/^\$argon2id\$/);
    await expect(
      verifyArgon2(storedCredential.password, "ProgressivePassword123"),
    ).resolves.toBe(true);
    const storedChallenge = await database.db
      .selectFrom("emailVerificationChallenges")
      .select("codeHash")
      .executeTakeFirstOrThrow();
    expect(storedChallenge.codeHash).not.toContain(
      signup.body.demoVerificationCode,
    );
    expect(storedChallenge.codeHash).toMatch(/^[a-f\d]+:[a-f\d]+$/);

    await request(app)
      .get("/api/activity-sessions")
      .set("Cookie", cookie)
      .expect(403);

    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: signup.body.demoVerificationCode })
      .expect(200, { verified: true });

    const user = await database.db
      .selectFrom("users")
      .select(["accountStatus", "emailVerifiedAt"])
      .where("email", "=", "new-account@example.com")
      .executeTakeFirstOrThrow();
    expect(user.accountStatus).toBe("active");
    expect(user.emailVerifiedAt).toEqual(expect.any(Number));
    await request(app)
      .get("/api/activity-sessions")
      .set("Cookie", cookie)
      .expect(403);

    const login = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: "new-account@example.com",
        password: "ProgressivePassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
      .expect(200);
    expect(login.body.user).toMatchObject({ accountStatus: "active" });
    expect(login.body.user).not.toHaveProperty("password");
  });

  it("creates an administrator tenant only after email verification", async () => {
    const signup = await request(app).post("/api/auth/signup").send({
      email: "new-administrator@example.com",
      name: "New",
      lastName: "Administrator",
      password: "ProgressivePassword123",
      countryCode: "ES",
      locale: "es",
      acceptedTerms: true,
      acceptedPrivacy: true,
      accountType: "administrator",
      facilityName: "Centro Verificado",
      facilityType: "functional_training",
    });
    expect(signup.status, JSON.stringify(signup.body)).toBe(201);
    expect(signup.body.user).toMatchObject({
      role: "admin",
      accountStatus: "pending_verification",
    });
    const userId = signup.body.user.id as string;
    expect(
      await database.db
        .selectFrom("administratorSignupProvisioning")
        .select(["facilityName", "facilityType"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      facilityName: "Centro Verificado",
      facilityType: "functional_training",
    });
    expect(
      await database.db
        .selectFrom("facilityMemberships")
        .select("id")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await database.db
        .selectFrom("commercialTrials")
        .select("id")
        .where("ownerUserId", "=", userId)
        .executeTakeFirst(),
    ).toBeUndefined();

    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", signup.headers["set-cookie"][0])
      .send({ code: signup.body.demoVerificationCode })
      .expect(200, { verified: true });

    const membership = await database.db
      .selectFrom("facilityMemberships")
      .innerJoin(
        "facilityProfiles",
        "facilityProfiles.id",
        "facilityMemberships.facilityId",
      )
      .select([
        "facilityMemberships.facilityId",
        "facilityMemberships.role",
        "facilityProfiles.name",
      ])
      .where("facilityMemberships.userId", "=", userId)
      .executeTakeFirstOrThrow();
    expect(membership).toMatchObject({
      role: "owner",
      name: "Centro Verificado",
    });
    expect(membership.facilityId).not.toBe("facility-alpha");
    const trial = await database.db
      .selectFrom("commercialTrials")
      .select(["facilityId", "ownerUserId", "startedAt", "expiresAt"])
      .where("ownerUserId", "=", userId)
      .executeTakeFirstOrThrow();
    expect(trial.facilityId).toBe(membership.facilityId);
    expect(trial.expiresAt - trial.startedAt).toBe(31 * 24 * 60 * 60 * 1000);
    expect(
      await database.db
        .selectFrom("administratorSignupProvisioning")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it("fails closed before creating an administrator when trial provisioning is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMMERCIAL_TRIALS_ENABLED", "false");
    try {
      const response = await request(app).post("/api/auth/signup").send({
        email: "blocked-administrator@example.com",
        name: "Blocked",
        lastName: "Administrator",
        password: "ProgressivePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
        accountType: "administrator",
        facilityName: "Centro Bloqueado",
        facilityType: "functional_training",
      });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("COMMERCIAL_TRIALS_DISABLED");
      expect(
        await database.db
          .selectFrom("users")
          .select("id")
          .where("email", "=", "blocked-administrator@example.com")
          .executeTakeFirst(),
      ).toBeUndefined();
    } finally {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("COMMERCIAL_TRIALS_ENABLED", "true");
    }
  });

  it("rotates the verification challenge when a pending account requests another email", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "resend-verification@example.com",
        name: "Resend",
        lastName: "Verification",
        password: "ProgressivePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    const cookie = signup.headers["set-cookie"][0];
    const before = await database.db
      .selectFrom("emailVerificationChallenges")
      .select("codeHash")
      .where("userId", "=", signup.body.user.id)
      .executeTakeFirstOrThrow();

    const resend = await request(app)
      .post("/api/auth/resend-verification")
      .set("Cookie", cookie)
      .expect(202);
    expect(resend.body).toMatchObject({
      sent: false,
      demoVerificationCode: expect.stringMatching(/^\d{6}$/),
    });

    const after = await database.db
      .selectFrom("emailVerificationChallenges")
      .select("codeHash")
      .where("userId", "=", signup.body.user.id)
      .executeTakeFirstOrThrow();
    expect(after.codeHash).not.toBe(before.codeHash);

    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: resend.body.demoVerificationCode })
      .expect(200, { verified: true });
  });

  it("locks an email challenge after five invalid attempts", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "locked-verification@example.com",
        name: "Locked",
        lastName: "Verification",
        password: "ProgressivePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    const cookie = signup.headers["set-cookie"][0];
    const invalidCode =
      signup.body.demoVerificationCode === "000000" ? "000001" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post("/api/auth/verify-email")
        .set("Cookie", cookie)
        .send({ code: invalidCode })
        .expect(400, { error: "Invalid or expired verification code" });
    }

    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: signup.body.demoVerificationCode })
      .expect(400, { error: "Invalid or expired verification code" });
    const stored = await database.db
      .selectFrom("emailVerificationChallenges")
      .select(["attempts", "consumedAt"])
      .where("userId", "=", signup.body.user.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ attempts: 5, consumedAt: null });
  });

  it("rolls back challenge consumption if the account cannot be activated", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "verification-state-race@example.com",
        name: "Verification",
        lastName: "State Race",
        password: "ProgressivePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    const cookie = signup.headers["set-cookie"][0];
    await database.db
      .updateTable("users")
      .set({ accountStatus: "security_review" })
      .where("id", "=", signup.body.user.id)
      .execute();

    await request(app)
      .post("/api/auth/verify-email")
      .set("Cookie", cookie)
      .send({ code: signup.body.demoVerificationCode })
      .expect(500);

    const [challenge, user] = await Promise.all([
      database.db
        .selectFrom("emailVerificationChallenges")
        .select("consumedAt")
        .where("userId", "=", signup.body.user.id)
        .executeTakeFirstOrThrow(),
      database.db
        .selectFrom("users")
        .select(["accountStatus", "emailVerifiedAt"])
        .where("id", "=", signup.body.user.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(challenge.consumedAt).toBeNull();
    expect(user).toEqual({
      accountStatus: "security_review",
      emailVerifiedAt: null,
    });
  });

  it("rejects signup without both explicit acknowledgements", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({
        email: "missing-consent@example.com",
        name: "Missing",
        lastName: "Consent",
        password: "ProgressivePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: false,
      })
      .expect(400);
  });

  it("activates new accounts without claiming email ownership when email verification is disabled", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENABLED", "false");
    try {
      const signup = await request(app)
        .post("/api/auth/signup")
        .send({
          email: "anti-automation-activation@example.com",
          name: "Anti Automation",
          lastName: "Activation",
          password: "ProgressivePassword123",
          countryCode: "ES",
          locale: "es",
          acceptedTerms: true,
          acceptedPrivacy: true,
        })
        .expect(201);
      expect(signup.body).toMatchObject({
        verificationRequired: false,
        verificationEmailSent: false,
        activationMethod: "development",
        user: { accountStatus: "active" },
      });
      expect(signup.body).not.toHaveProperty("demoVerificationCode");

      const stored = await database.db
        .selectFrom("users")
        .select(["accountStatus", "emailVerifiedAt"])
        .where("email", "=", "anti-automation-activation@example.com")
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        accountStatus: "active",
        emailVerifiedAt: null,
      });

      await request(app)
        .post("/api/auth/resend-verification")
        .set("Cookie", signup.headers["set-cookie"][0])
        .expect(410, {
          code: "EMAIL_VERIFICATION_DISABLED",
          error: "Email verification is temporarily disabled",
        });
    } finally {
      vi.stubEnv("EMAIL_VERIFICATION_ENABLED", "true");
    }
  });

  it("keeps an incomplete account pending when delivery must be retried", async () => {
    const email = "undeliverable-signup@example.com";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_REQUIRE_TLS = "false";
    process.env.EMAIL_FROM = "Umbravia Forge <no-reply@example.com>";
    try {
      await request(app)
        .post("/api/auth/signup")
        .send({
          email,
          name: "Undeliverable",
          lastName: "Signup",
          password: "ProgressivePassword123",
          countryCode: "ES",
          locale: "es",
          acceptedTerms: true,
          acceptedPrivacy: true,
        })
        .expect(201);
      const stored = await database.db
        .selectFrom("users")
        .select(["id", "accountStatus"])
        .where("email", "=", email)
        .executeTakeFirstOrThrow();
      expect(stored.accountStatus).toBe("pending_verification");
      const queued = await database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "payloadEncrypted"])
        .where("userId", "=", stored.id)
        .executeTakeFirstOrThrow();
      expect(queued.status).toBe("retry");
      expect(queued.attempts).toBe(1);
      expect(queued.payloadEncrypted).not.toContain("ProgressivePassword123");
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_SECURE;
      delete process.env.SMTP_REQUIRE_TLS;
      delete process.env.EMAIL_FROM;
    }
  });
});

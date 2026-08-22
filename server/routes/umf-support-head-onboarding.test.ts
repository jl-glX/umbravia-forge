import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("UMF Support verified account registration", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-verified-registration-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256", "");
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

  async function registerAndVerify(email: string, name: string) {
    const browser = request.agent(app);
    const registered = await browser
      .post("/api/umf-support/register")
      .send({
        email,
        name,
        lastName: "Support",
        password: "VerifiedSupportPassword123",
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
        email,
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
    await browser
      .post("/api/umf-support/verify-email")
      .send({ code: registered.body.demoVerificationCode })
      .expect(200, {
        verified: true,
        access: "awaiting_administrator_approval",
      });
    return { browser, userId };
  }

  it("creates a separate verified corporate account without granting staff access", async () => {
    const { userId } = await registerAndVerify(
      "verified-agent@example.com",
      "Verified",
    );
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
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("companyStaffProfiles")
        .select("position")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("corporateBootstrapState")
        .select("claimedByUserId")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    const login = await request(app).post("/api/umf-support/login").send({
      email: "verified-agent@example.com",
      password: "VerifiedSupportPassword123",
      rememberDevice: false,
    });
    expect(login.status).toBe(200);
    const accountOnlyCookie = login.headers["set-cookie"][0];
    await request(app)
      .get("/api/umf-support/session")
      .set("Cookie", accountOnlyCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          id: userId,
          identityRealm: "corporate_support",
          accessApproved: false,
        });
      });
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", accountOnlyCookie)
      .expect(403);
  });

  it("does not elevate the first or a later verified account by registration order", async () => {
    const first = await registerAndVerify("first@example.com", "First");
    const later = await registerAndVerify("later@example.com", "Later");
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "in", [first.userId, later.userId])
        .execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .selectFrom("companyStaffProfiles")
        .select("userId")
        .where("userId", "in", [first.userId, later.userId])
        .execute(),
    ).resolves.toEqual([]);
  });

  it("activates only the verified account explicitly configured as the first head", async () => {
    const email = "designated-head@example.com";
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update(email).digest("hex"),
    );
    const browser = request.agent(app);
    const registered = await browser
      .post("/api/umf-support/register")
      .send({
        email,
        name: "Designated",
        lastName: "Head",
        password: "DesignatedSupportPassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    await browser
      .post("/api/umf-support/verify-email")
      .send({ code: registered.body.demoVerificationCode })
      .expect(200, { verified: true, access: "company_head_approved" });
    await browser
      .get("/api/umf-support/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          id: registered.body.user.id,
          accessApproved: true,
        });
      });
  });
});

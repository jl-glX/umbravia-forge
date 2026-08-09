import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("account recovery API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("../services/auth.js");
  let recovery: typeof import("../services/account-recovery.js");
  let supportIdentifiers: typeof import("../services/support-identifiers.js");
  let app: typeof import("../index.js").app;
  let userId: string;
  const email = "recovery-route@example.com";
  const username = "recovery_route";
  let publicId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-recovery-route-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ACCOUNT_RECOVERY_RATE_LIMIT_MAX_REQUESTS", "100");
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("../services/auth.js");
    recovery = await import("../services/account-recovery.js");
    supportIdentifiers = await import("../services/support-identifiers.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      email,
      "Recovery Route",
      "RecoveryRoutePassword123",
      {},
      undefined,
      { requireEmailVerification: false },
    );
    userId = account.user.id;
    const now = Date.now();
    await database.db
      .insertInto("socialProfiles")
      .values({
        userId,
        username,
        bio: "",
        displayRealName: 0,
        birthDate: null,
        privacy: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    publicId = (await supportIdentifiers.getSupportIdentifier(userId)).publicId;
    app = (await import("../index.js")).app;
  }, 20_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("returns the same public response for known and unknown email addresses", async () => {
    const known = await request(app)
      .post("/api/auth/recovery/request")
      .send({ method: "email", identifier: email, captchaToken: "test-token" })
      .expect(202);
    const unknown = await request(app)
      .post("/api/auth/recovery/request")
      .send({
        method: "email",
        identifier: "unknown-recovery@example.com",
        captchaToken: "test-token",
      })
      .expect(202);

    expect(known.body).toEqual({ accepted: true });
    expect(unknown.body).toEqual(known.body);
  });

  it("keeps the same public response for known and unknown usernames and public IDs", async () => {
    for (const [method, knownIdentifier, unknownIdentifier] of [
      ["username", username, "missing_recovery_user"],
      ["public_id", publicId, "GT-U-FFFF-FFFF-FFFF"],
    ] as const) {
      const known = await request(app)
        .post("/api/auth/recovery/request")
        .send({
          method,
          identifier: knownIdentifier,
          captchaToken: "test-token",
        })
        .expect(202);
      const unknown = await request(app)
        .post("/api/auth/recovery/request")
        .send({
          method,
          identifier: unknownIdentifier,
          captchaToken: "test-token",
        })
        .expect(202);
      expect(known.body).toEqual({ accepted: true });
      expect(unknown.body).toEqual(known.body);
    }
  });

  it("rejects identifiers that do not match the explicitly selected method", async () => {
    await request(app)
      .post("/api/auth/recovery/request")
      .send({
        method: "public_id",
        identifier: email,
        captchaToken: "test-token",
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: "VALIDATION_ERROR" });
      });
  });

  it("never exposes whether an invalid code belongs to an account", async () => {
    const known = await request(app)
      .post("/api/auth/recovery/reset-password")
      .send({
        method: "email",
        identifier: email,
        code: "000000",
        newPassword: "RecoveredRoutePassword456",
      })
      .expect(400);
    const unknown = await request(app)
      .post("/api/auth/recovery/reset-password")
      .send({
        method: "email",
        identifier: "unknown-recovery@example.com",
        code: "000000",
        newPassword: "RecoveredRoutePassword456",
      })
      .expect(400);

    expect(known.body).toEqual({
      code: "ACCOUNT_RECOVERY_INVALID",
      error: "Invalid or expired recovery code",
    });
    expect(unknown.body).toEqual(known.body);
  });

  it("completes recovery through email, username and the current public ID", async () => {
    const cases = [
      { method: "email", identifier: email, password: "RecoveredEmail456" },
      {
        method: "username",
        identifier: username.toUpperCase(),
        password: "RecoveredUsername456",
      },
      {
        method: "public_id",
        identifier: "",
        password: "RecoveredPublicId456",
      },
    ] as const;

    for (const recoveryCase of cases) {
      const challenge = await recovery.createAccountRecoveryChallenge(userId);
      const identifier =
        recoveryCase.method === "public_id"
          ? (
              await supportIdentifiers.getSupportIdentifier(userId)
            ).publicId.toLowerCase()
          : recoveryCase.identifier;
      const response = await request(app)
        .post("/api/auth/recovery/reset-password")
        .send({
          method: recoveryCase.method,
          identifier,
          code: challenge.code,
          newPassword: recoveryCase.password,
        })
        .expect(200, { recovered: true });

      const setCookieHeader = response.headers["set-cookie"];
      const clearedCookies = Array.isArray(setCookieHeader)
        ? setCookieHeader.join(";")
        : (setCookieHeader ?? "");
      expect(clearedCookies).toContain("umbravia-forge_session=");
      expect(clearedCookies).toContain("umbravia-forge_mfa_challenge=");
      expect(clearedCookies).toContain("umbravia-forge_passkey_challenge=");
      expect(clearedCookies).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      await expect(
        auth.verifyUserPassword(userId, recoveryCase.password),
      ).resolves.toBe(true);
    }
  });
});

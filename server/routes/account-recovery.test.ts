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
  let app: typeof import("../index.js").app;
  let userId: string;
  const email = "recovery-route@example.com";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-recovery-route-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("../services/auth.js");
    recovery = await import("../services/account-recovery.js");
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
      .send({ identifier: email, captchaToken: "test-token" })
      .expect(202);
    const unknown = await request(app)
      .post("/api/auth/recovery/request")
      .send({
        identifier: "unknown-recovery@example.com",
        captchaToken: "test-token",
      })
      .expect(202);

    expect(known.body).toEqual({ accepted: true });
    expect(unknown.body).toEqual(known.body);
  });

  it("never exposes whether an invalid code belongs to an account", async () => {
    const known = await request(app)
      .post("/api/auth/recovery/reset-password")
      .send({
        identifier: email,
        code: "000000",
        newPassword: "RecoveredRoutePassword456",
      })
      .expect(400);
    const unknown = await request(app)
      .post("/api/auth/recovery/reset-password")
      .send({
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

  it("accepts a valid one-time challenge and clears authentication cookies", async () => {
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    const response = await request(app)
      .post("/api/auth/recovery/reset-password")
      .send({
        identifier: email,
        code: challenge.code,
        newPassword: "RecoveredRoutePassword456",
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
      auth.verifyUserPassword(userId, "RecoveredRoutePassword456"),
    ).resolves.toBe(true);
  });
});

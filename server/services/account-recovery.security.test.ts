import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("account recovery abuse resistance", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let recovery: typeof import("./account-recovery.js");
  let app: typeof import("../index.js").app;
  let userId: string;
  const email = "recovery-abuse@example.com";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-recovery-abuse-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ACCOUNT_RECOVERY_RATE_LIMIT_MAX_REQUESTS", "3");
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    recovery = await import("./account-recovery.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      email,
      "Recovery Abuse",
      "RecoveryAbusePassword123",
      {},
      undefined,
      { requireEmailVerification: false },
    );
    userId = account.user.id;
    app = (await import("../index.js")).app;
  }, 20_000);

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores only a salted hash of the recovery code", async () => {
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    const stored = await database.db
      .selectFrom("accountRecoveryChallenges")
      .select("codeHash")
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    expect(stored.codeHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/);
    expect(stored.codeHash).not.toContain(challenge.code);
  });

  it("rejects an expired code and preserves the current password", async () => {
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    await database.db
      .updateTable("accountRecoveryChallenges")
      .set({ expiresAt: Date.now() - 1 })
      .where("userId", "=", userId)
      .execute();

    await expect(
      recovery.resetPasswordWithRecoveryCode({
        identifier: email,
        code: challenge.code,
        newPassword: "ExpiredRecoveryPassword456",
      }),
    ).resolves.toBe(false);
    await expect(
      auth.verifyUserPassword(userId, "RecoveryAbusePassword123"),
    ).resolves.toBe(true);
  });

  it("allows only one winner when the same code is consumed concurrently", async () => {
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    const attempts = await Promise.allSettled([
      recovery.resetPasswordWithRecoveryCode({
        identifier: email,
        code: challenge.code,
        newPassword: "ConcurrentRecoveryPassword456",
      }),
      recovery.resetPasswordWithRecoveryCode({
        identifier: email,
        code: challenge.code,
        newPassword: "ConcurrentRecoveryPassword789",
      }),
    ]);
    const successful = attempts.filter(
      (result) => result.status === "fulfilled" && result.value,
    );

    expect(successful).toHaveLength(1);
    await expect(
      recovery.resetPasswordWithRecoveryCode({
        identifier: email,
        code: challenge.code,
        newPassword: "ReplayRecoveryPassword123",
      }),
    ).resolves.toBe(false);
  });

  it("rate-limits repeated recovery requests independently of the address", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post("/api/auth/recovery/request")
        .send({
          identifier: `synthetic-${attempt}@example.invalid`,
          captchaToken: "test-token",
        })
        .expect(202, { accepted: true });
    }

    await request(app)
      .post("/api/auth/recovery/request")
      .send({
        identifier: "synthetic-limited@example.invalid",
        captchaToken: "test-token",
      })
      .expect(429)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: "ACCOUNT_RECOVERY_RATE_LIMITED",
        });
      });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

describe("verified account email changes", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let service: typeof import("./email-change.js");
  let policy: typeof import("../lib/email-change-policy.js");
  let userId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-email-change-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.com");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("./auth.js");
    service = await import("./email-change.js");
    policy = await import("../lib/email-change-policy.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "owner@example.com",
      "Owner",
      "OwnerPassword123",
    );
    userId = account.user.id;
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: Date.now() })
      .where("id", "=", userId)
      .execute();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await database.db
      .deleteFrom("emailChangeChallenges")
      .where("userId", "=", userId)
      .execute();
    await database.db
      .deleteFrom("emailDeliveries")
      .where("userId", "=", userId)
      .execute();
    await database.db
      .deleteFrom("securityEvents")
      .where("userId", "=", userId)
      .execute();
    await database.db
      .updateTable("users")
      .set({ email: "owner@example.com", emailVerifiedAt: Date.now() })
      .where("id", "=", userId)
      .execute();
  });

  it("keeps the original email and automatically expires an unverified request", async () => {
    const startedAt = Date.now();
    const result = await service.requestEmailChange(
      userId,
      "pending@example.com",
    );

    expect(result.expiresAt - startedAt).toBeGreaterThanOrEqual(
      policy.EMAIL_CHANGE_CHALLENGE_DURATION_MS - 1_000,
    );
    expect(result.expiresAt - startedAt).toBeLessThanOrEqual(
      policy.EMAIL_CHANGE_CHALLENGE_DURATION_MS + 1_000,
    );
    expect(
      await database.db
        .selectFrom("users")
        .select("email")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ email: "owner@example.com" });

    const deliveries = await database.db
      .selectFrom("emailDeliveries")
      .select(["recipient", "expiresAt"])
      .where("userId", "=", userId)
      .execute();
    expect(deliveries.map(({ recipient }) => recipient)).toEqual(
      expect.arrayContaining(["owner@example.com", "pending@example.com"]),
    );

    await expect(
      service.cleanupExpiredEmailChangeChallenges(result.expiresAt + 1),
    ).resolves.toBe(1);
    await expect(
      database.db
        .selectFrom("emailChangeChallenges")
        .select("id")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    expect(
      await database.db
        .selectFrom("users")
        .select("email")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ email: "owner@example.com" });
    expect(
      await database.db
        .selectFrom("securityEvents")
        .select("type")
        .where("userId", "=", userId)
        .where("type", "=", "email_change_expired")
        .executeTakeFirst(),
    ).toEqual({ type: "email_change_expired" });
    expect(
      await database.db
        .selectFrom("emailDeliveries")
        .select(["status", "recipient", "payloadEncrypted"])
        .where("userId", "=", userId)
        .where("expiresAt", "=", result.expiresAt)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "superseded", recipient: "", payloadEncrypted: "" });
  });

  it("cancels a pending request without changing the account email", async () => {
    await service.requestEmailChange(userId, "cancelled@example.com");

    await expect(service.cancelEmailChange(userId)).resolves.toBe(true);
    await expect(service.cancelEmailChange(userId)).resolves.toBe(false);
    expect(
      await database.db
        .selectFrom("users")
        .select("email")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ email: "owner@example.com" });
    expect(
      await database.db
        .selectFrom("securityEvents")
        .select("type")
        .where("userId", "=", userId)
        .where("type", "=", "email_change_cancelled")
        .executeTakeFirst(),
    ).toEqual({ type: "email_change_cancelled" });
  });
});

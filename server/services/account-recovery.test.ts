import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("account recovery", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let lifecycle: typeof import("./account-lifecycle.js");
  let recovery: typeof import("./account-recovery.js");
  let identifiers: typeof import("./support-identifiers.js");
  let coordinator: typeof import("./manager-coordinator.js");
  let userId: string;
  const email = "recoverable-member@example.com";
  const username = "recoverable_member";
  let publicId: string;
  const originalPassword = "OriginalPassword123";
  const replacementPassword = "ReplacementPassword456";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-recovery-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    lifecycle = await import("./account-lifecycle.js");
    recovery = await import("./account-recovery.js");
    identifiers = await import("./support-identifiers.js");
    coordinator = await import("./manager-coordinator.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      email,
      "Recoverable Member",
      originalPassword,
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
    publicId = (await identifiers.getSupportIdentifier(userId)).publicId;
  }, 20_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("exposes only methods that are actually connected", () => {
    const methods = recovery.getRecoveryCapabilities();
    expect(methods).toHaveLength(5);
    expect(
      methods
        .filter((method) => method.id !== "support")
        .every((method) => method.status === "available"),
    ).toBe(true);
    expect(methods.find((method) => method.id === "support")).toMatchObject({
      status: "planned",
      entryPoint: null,
      canCancelPendingDeletion: false,
    });
    expect(recovery.getRecoveryLookupMethods()).toEqual([
      "email",
      "username",
      "public_id",
    ]);
  });

  it("resolves email, username and active public ID to the same account", async () => {
    for (const [method, identifier] of [
      ["email", email.toUpperCase()],
      ["username", username.toUpperCase()],
      ["public_id", publicId.toLowerCase()],
    ] as const) {
      await expect(
        recovery.requestPasswordRecovery(method, identifier),
      ).resolves.toMatchObject({ deliveryId: expect.any(String) });
      await expect(
        database.db
          .selectFrom("accountRecoveryChallenges")
          .select("userId")
          .where("userId", "=", userId)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId });
    }
  });

  it("does not create recoverable challenges for unknown or unverified accounts", async () => {
    await expect(
      recovery.requestPasswordRecovery("email", "missing@example.com"),
    ).resolves.toEqual({ deliveryId: null });

    const pending = await auth.signup(
      "pending-recovery@example.com",
      "Pending Recovery",
      "PendingPassword123",
      {},
      undefined,
      { requireEmailVerification: true },
    );
    await expect(
      recovery.requestPasswordRecovery("email", pending.user.email),
    ).resolves.toEqual({ deliveryId: null });
    await expect(
      database.db
        .selectFrom("accountRecoveryChallenges")
        .select("id")
        .where("userId", "=", pending.user.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("limits failed code attempts and keeps the password unchanged", async () => {
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        recovery.resetPasswordWithRecoveryCode({
          method: "email",
          identifier: email,
          code: "000000" === challenge.code ? "111111" : "000000",
          newPassword: replacementPassword,
        }),
      ).resolves.toBe(false);
    }
    await expect(
      database.db
        .selectFrom("accountRecoveryChallenges")
        .select("attempts")
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ attempts: 5 });
    await expect(
      recovery.resetPasswordWithRecoveryCode({
        method: "email",
        identifier: email,
        code: challenge.code,
        newPassword: replacementPassword,
      }),
    ).resolves.toBe(false);
    await expect(
      auth.verifyUserPassword(userId, originalPassword),
    ).resolves.toBe(true);
  });

  it("keeps a single active challenge under concurrent requests", async () => {
    await Promise.all([
      recovery.createAccountRecoveryChallenge(userId),
      recovery.createAccountRecoveryChallenge(userId),
      recovery.createAccountRecoveryChallenge(userId),
    ]);
    await expect(
      database.db
        .selectFrom("accountRecoveryChallenges")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ count: 1 });
  });

  it("does not collide with resource maintenance on authentication records", async () => {
    let releaseMaintenance!: () => void;
    let maintenanceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      maintenanceStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });
    const maintenance = coordinator.withCoordinatedManagerOperation(
      "resource",
      "test-authentication-cleanup",
      ["authentication-records"],
      async () => {
        maintenanceStarted();
        await release;
      },
    );
    await started;
    const challenge = await recovery.createAccountRecoveryChallenge(userId);
    await expect(
      recovery.resetPasswordWithRecoveryCode({
        method: "email",
        identifier: email,
        code: challenge.code,
        newPassword: replacementPassword,
      }),
    ).rejects.toMatchObject({
      name: "ManagerCoordinationConflictError",
      status: 409,
    });
    releaseMaintenance();
    await maintenance;
  });

  it("resets once, preserves security review and revokes sensitive account state", async () => {
    const beforeIdentifier = await identifiers.getSupportIdentifier(userId);
    const sessionBefore = await database.db
      .selectFrom("sessions")
      .select("id")
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .executeTakeFirstOrThrow();
    await lifecycle.scheduleAccountDeletion(userId, "manual", Date.now(), {
      keepSessionId: sessionBefore.id,
    });
    await database.db
      .updateTable("users")
      .set({ accountStatus: "security_review" })
      .where("id", "=", userId)
      .execute();
    const challenge = await recovery.createAccountRecoveryChallenge(userId);

    await expect(
      recovery.resetPasswordWithRecoveryCode({
        method: "public_id",
        identifier: publicId.toLowerCase(),
        code: challenge.code,
        newPassword: replacementPassword,
      }),
    ).resolves.toBe(true);

    await expect(
      auth.verifyUserPassword(userId, originalPassword),
    ).resolves.toBe(false);
    await expect(
      auth.verifyUserPassword(userId, replacementPassword),
    ).resolves.toBe(true);
    await expect(
      database.db
        .selectFrom("users")
        .select("password")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      password: expect.stringMatching(/^\$argon2id\$/),
    });
    await expect(
      database.db
        .selectFrom("users")
        .select("accountStatus")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ accountStatus: "security_review" });
    await expect(
      database.db
        .selectFrom("sessions")
        .select("revokedAt")
        .where("id", "=", sessionBefore.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ revokedAt: expect.any(Number) });
    expect((await identifiers.getSupportIdentifier(userId)).publicId).not.toBe(
      beforeIdentifier.publicId,
    );
    expect(
      (await lifecycle.getAccountLifecycle(userId)).deletionRequest,
    ).toBeNull();
    await expect(
      recovery.resetPasswordWithRecoveryCode({
        method: "username",
        identifier: username.toUpperCase(),
        code: challenge.code,
        newPassword: "AnotherReplacement789",
      }),
    ).resolves.toBe(false);
  });
});

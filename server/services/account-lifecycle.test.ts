import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("account lifecycle", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let lifecycle: typeof import("./account-lifecycle.js");
  let userId: string;

  async function createInactiveAccount(label: string) {
    const account = await auth.signup(
      `${label}@example.com`,
      `Inactive ${label}`,
      "StrongPassword123",
    );
    const lastActivity = Date.now() - 7 * 31 * 24 * 60 * 60 * 1000;
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: Date.now() })
      .where("id", "=", account.user.id)
      .execute();
    await database.db
      .updateTable("accountDeletionPreferences")
      .set({
        inactivityMonths: null,
        lastMeaningfulActivityAt: lastActivity,
        updatedAt: lastActivity,
      })
      .where("userId", "=", account.user.id)
      .execute();
    return { ...account, lastActivity };
  }

  async function addReviewDelivery(userId: string, createdAt: number) {
    const deliveryId = `review-${userId}`;
    await database.db
      .insertInto("securityEvents")
      .values({
        id: `event-${userId}-${createdAt}`,
        userId,
        type: "account_inactivity_review_delivered",
        createdAt,
        metadata: JSON.stringify({
          deliveryId,
          reviewDeliveryId: deliveryId,
          reminder: false,
        }),
      })
      .execute();
    return deliveryId;
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-lifecycle-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    lifecycle = await import("./account-lifecycle.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "lifecycle@example.com",
      "Lifecycle Member",
      "StrongPassword123",
    );
    userId = account.user.id;
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores an optional inactivity period", async () => {
    const configured = await lifecycle.updateInactivityDeletionPreference(
      userId,
      12,
    );
    expect(configured.inactivityMonths).toBe(12);
    expect(configured.dataDisposition.executionEnabled).toBe(false);
    expect(configured.dataDisposition.categories).toHaveLength(8);
    expect(configured.continuityBridge).toMatchObject({
      status: "draft_available",
      executionEnabled: false,
      identityTransferAllowed: false,
      representations: [],
    });

    const disabled = await lifecycle.updateInactivityDeletionPreference(
      userId,
      null,
    );
    expect(disabled.inactivityMonths).toBeNull();
  });

  it("starts one grace period after the user-defined inactivity threshold", async () => {
    await lifecycle.updateInactivityDeletionPreference(userId, 6);
    await database.db
      .updateTable("accountDeletionPreferences")
      .set({
        lastMeaningfulActivityAt: Date.now() - 7 * 30 * 24 * 60 * 60 * 1000,
      })
      .where("userId", "=", userId)
      .execute();

    const result = await lifecycle.evaluateDueInactivityDeletions();
    expect(result).toMatchObject({ evaluated: 1, scheduled: 1 });
    expect(await lifecycle.getAccountLifecycle(userId)).toMatchObject({
      currentState: "suspended_pending_deletion",
      deletionRequest: { trigger: "inactivity", status: "scheduled" },
      deletionJob: {
        status: "planned",
        executionEnabled: true,
      },
    });
    await lifecycle.cancelScheduledAccountDeletion(userId);
  });

  it("uses calendar months instead of fixed thirty-day approximations", async () => {
    await lifecycle.updateInactivityDeletionPreference(userId, 6);
    await database.db
      .updateTable("accountDeletionPreferences")
      .set({ lastMeaningfulActivityAt: Date.UTC(2025, 7, 31) })
      .where("userId", "=", userId)
      .execute();

    expect(
      await lifecycle.evaluateDueInactivityDeletions(Date.UTC(2026, 1, 27)),
    ).toMatchObject({ scheduled: 0 });
    expect(
      await lifecycle.evaluateDueInactivityDeletions(Date.UTC(2026, 1, 28)),
    ).toMatchObject({ scheduled: 1 });
    await lifecycle.cancelScheduledAccountDeletion(userId);
  });

  it("schedules one reversible request with a thirty-day grace period", async () => {
    const scheduled = await lifecycle.scheduleAccountDeletion(userId, "manual");
    expect(scheduled.deletionRequest?.status).toBe("scheduled");
    expect(scheduled.currentState).toBe("closure_requested");
    expect(scheduled.deletionJob).toMatchObject({
      status: "planned",
      executionEnabled: true,
    });
    expect(scheduled.supportedStates).toEqual(
      expect.arrayContaining([
        "pending_verification",
        "active",
        "security_review",
        "recovery_in_progress",
        "inactive",
        "suspended_pending_deletion",
        "deletion_cancelled",
        "closure_requested",
        "deletion_processing",
        "retained_legal",
        "legal_hold",
        "anonymized",
        "deleted",
      ]),
    );
    expect(
      scheduled.deletionRequest!.graceEndsAt -
        scheduled.deletionRequest!.requestedAt,
    ).toBe(30 * 24 * 60 * 60 * 1000);

    const duplicate = await lifecycle.scheduleAccountDeletion(userId, "manual");
    expect(duplicate.deletionRequest?.id).toBe(scheduled.deletionRequest?.id);

    const cancelled = await lifecycle.cancelScheduledAccountDeletion(userId);
    expect(cancelled.deletionRequest).toBeNull();
    expect(cancelled.deletionJob).toBeNull();
  });

  it("stores a data-only deletion review without scheduling account closure", async () => {
    const review = await lifecycle.saveDataDeletionReview(
      userId,
      ["bookings", "preferences"],
      "selected_data",
    );

    expect(review.deletionDraft).toMatchObject({
      selectedCategories: ["bookings", "preferences"],
      intent: "selected_data",
    });
    expect(review.deletionRequest).toBeNull();
    expect(review.dataDisposition.executionEnabled).toBe(false);
  });

  it("requires at least one category for a data-only review", async () => {
    await expect(
      lifecycle.saveDataDeletionReview(userId, [], "selected_data"),
    ).rejects.toThrow("Select at least one data category");
  });

  it("cancels pending deletion only after a completed recovery event", async () => {
    const recovery = await import("./account-recovery.js");
    await lifecycle.scheduleAccountDeletion(userId, "manual");

    const completed = await recovery.completeAccountRecovery(
      userId,
      "password_reset_completed",
    );

    expect(completed.cancelledPendingDeletion).toBe(true);
    expect(completed.lifecycle?.deletionRequest).toBeNull();
  });

  it("reports only genuinely active sessions and keeps data export disabled", async () => {
    await database.db
      .updateTable("users")
      .set({ sessionIdleTimeoutMinutes: 15 })
      .where("id", "=", userId)
      .execute();
    await database.db
      .updateTable("sessions")
      .set({ lastSeenAt: Date.now() - 16 * 60 * 1000 })
      .where("userId", "=", userId)
      .execute();

    const review = await lifecycle.getDataDeletionReview(userId);
    expect(review.closureImpact).toMatchObject({
      activeSessions: 0,
      dataExportStatus: "planned",
      executionEnabled: true,
    });
  });

  it("physically deletes an eligible account only after the grace period", async () => {
    const disposable = await auth.signup(
      "lifecycle-disposable@example.com",
      "Disposable Member",
      "StrongPassword123",
    );
    const scheduled = await lifecycle.scheduleAccountDeletion(
      disposable.user.id,
      "manual",
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    );
    expect(scheduled.deletionJob).toMatchObject({
      status: "planned",
      executionEnabled: true,
    });

    const result = await lifecycle.executeDueAccountDeletionJobs();
    expect(result).toMatchObject({ completed: 1, blocked: 0 });
    expect(
      await database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", disposable.user.id)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it("does not treat a retention record already scheduled for deletion as a legal hold", async () => {
    const disposable = await auth.signup(
      "lifecycle-retention-scheduled@example.com",
      "Scheduled Retention Member",
      "StrongPassword123",
    );
    const now = Date.now();
    await database.db
      .insertInto("dataRetentionPolicies")
      .values({
        id: `policy-${disposable.user.id}`,
        name: "Deletion-ready test policy",
        jurisdiction: "test",
        dataCategory: "account_profile",
        retentionDays: 1,
        legalBasisReference: "test-only",
        status: "active",
        version: 1,
        reviewedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("dataRetentionRecords")
      .values({
        id: `record-${disposable.user.id}`,
        userId: disposable.user.id,
        policyId: `policy-${disposable.user.id}`,
        sourceType: "account_profile",
        sourceId: disposable.user.id,
        status: "scheduled_deletion",
        retainUntil: now - 1,
        createdAt: now,
        updatedAt: now,
        releasedAt: null,
      })
      .execute();
    await lifecycle.scheduleAccountDeletion(
      disposable.user.id,
      "manual",
      now - 31 * 24 * 60 * 60 * 1000,
    );

    const result = await lifecycle.executeDueAccountDeletionJobs(now);
    expect(result).toMatchObject({ completed: 1, blocked: 0 });
    expect(
      await database.db
        .selectFrom("dataRetentionRecords")
        .select("userId")
        .where("id", "=", `record-${disposable.user.id}`)
        .executeTakeFirst(),
    ).toEqual({ userId: null });
  });

  it("keeps the active sign-in factors during the reversible grace period", async () => {
    const disposable = await auth.signup(
      "lifecycle-reversible@example.com",
      "Reversible Member",
      "StrongPassword123",
    );
    const currentSession = await database.db
      .selectFrom("sessions")
      .select("id")
      .where("userId", "=", disposable.user.id)
      .executeTakeFirstOrThrow();
    const now = Date.now();
    await database.db
      .insertInto("mfaCredentials")
      .values({
        userId: disposable.user.id,
        secretEncrypted: "encrypted-test-secret",
        recoveryCodeHashes: "[]",
        createdAt: now,
        updatedAt: now,
        enabledAt: now,
      })
      .execute();
    await database.db
      .insertInto("authChallenges")
      .values({
        id: `challenge-${disposable.user.id}`,
        userId: disposable.user.id,
        createdAt: now,
        expiresAt: now + 60_000,
        attempts: 0,
        consumedAt: null,
        rememberDevice: 0,
      })
      .execute();

    await lifecycle.scheduleAccountDeletion(disposable.user.id, "manual", now, {
      keepSessionId: currentSession.id,
    });

    await expect(
      database.db
        .selectFrom("mfaCredentials")
        .select("userId")
        .where("userId", "=", disposable.user.id)
        .executeTakeFirst(),
    ).resolves.toEqual({ userId: disposable.user.id });
    await expect(
      database.db
        .selectFrom("sessions")
        .select("id")
        .where("id", "=", currentSession.id)
        .executeTakeFirst(),
    ).resolves.toEqual({ id: currentSession.id });
    await expect(
      database.db
        .selectFrom("authChallenges")
        .select("id")
        .where("userId", "=", disposable.user.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("starts the six-month review only after its email is delivered", async () => {
    const account = await createInactiveAccount("review-queued");
    const result = await lifecycle.evaluateUnconfiguredInactivityReviews();
    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect(
      (await lifecycle.getAccountLifecycle(account.user.id)).inactivityReview,
    ).toMatchObject({ status: "none", stage: null });

    await addReviewDelivery(account.user.id, Date.now());
    expect(
      (await lifecycle.getAccountLifecycle(account.user.id)).inactivityReview,
    ).toMatchObject({
      status: "pending",
      stage: "awaiting_usage_confirmation",
    });
  });

  it("schedules deletion after silence on the delivered usage question", async () => {
    const account = await createInactiveAccount("review-silent");
    const deliveredAt =
      Date.now() - lifecycle.INACTIVITY_REVIEW_RESPONSE_MS - 1;
    await addReviewDelivery(account.user.id, deliveredAt);

    const result = await lifecycle.evaluateUnconfiguredInactivityReviews();
    expect(result.scheduled).toBeGreaterThanOrEqual(1);
    expect(await lifecycle.getAccountLifecycle(account.user.id)).toMatchObject({
      currentState: "suspended_pending_deletion",
      deletionRequest: { trigger: "inactivity", status: "scheduled" },
    });
  });

  it("does not delete after silence on the second confirmation question", async () => {
    const account = await createInactiveAccount("review-declined");
    await addReviewDelivery(account.user.id, Date.now());
    const secondQuestion = await lifecycle.answerInactivityReview(
      account.user.id,
      { stage: "usage", answer: "no" },
    );
    expect(secondQuestion.inactivityReview).toMatchObject({
      status: "pending",
      stage: "confirm_deletion",
      responseDueAt: null,
    });

    await lifecycle.evaluateUnconfiguredInactivityReviews(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    );
    expect(
      (await lifecycle.getAccountLifecycle(account.user.id)).deletionRequest,
    ).toBeNull();

    const kept = await lifecycle.answerInactivityReview(account.user.id, {
      stage: "deletion",
      answer: "no",
    });
    expect(kept.inactivityReview).toMatchObject({ status: "none" });
    expect(kept.deletionRequest).toBeNull();
  });
});

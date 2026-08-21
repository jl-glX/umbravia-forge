import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("commercial trial abandonment cleanup", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let service: typeof import("./commercial-trial.js");
  let environmentManager: typeof import("./environment-manager.js");
  let coordinator: typeof import("./manager-coordinator.js");
  let graceMs: number;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-trial-cleanup-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COMMERCIAL_TRIAL_CLEANUP_ENABLED", "true");
    vi.resetModules();
    database = await import("../db/client.js");
    service = await import("./commercial-trial.js");
    environmentManager = await import("./environment-manager.js");
    coordinator = await import("./manager-coordinator.js");
    graceMs = (await import("../lib/commercial-trial.js"))
      .COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function seedTrial(
    suffix: string,
    options: {
      autoCleanupEligible?: 0 | 1;
      realData?: "undeclared" | "yes";
    } = {},
  ) {
    const userId = `cleanup-user-${suffix}`;
    const facilityId = `cleanup-facility-${suffix}`;
    const trialId = `cleanup-trial-${suffix}`;
    await database.db
      .insertInto("users")
      .values({
        id: userId,
        email: `${suffix}@cleanup.example.com`,
        phone: null,
        name: `Cleanup ${suffix}`,
        avatarDataUrl: "",
        password: "test-only",
        role: "admin",
        sessionIdleTimeoutMinutes: 10080,
        accountStatus: "active",
        emailVerifiedAt: 1,
        createdAt: 1,
      })
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: facilityId,
        slug: facilityId,
        name: `Facility ${suffix}`,
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: `${facilityId}:${userId}`,
        facilityId,
        userId,
        role: "owner",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();
    await database.db
      .insertInto("commercialTrials")
      .values({
        id: trialId,
        facilityId,
        ownerUserId: userId,
        facilityName: `Facility ${suffix}`,
        facilityType: "traditional_gym",
        approximateMembers: null,
        trainerCount: null,
        spaceCount: null,
        usualCapacity: 20,
        classTypes: "[]",
        scheduleNotes: "",
        locale: "es",
        currency: "EUR",
        usesBookings: 1,
        usesWaitlist: 1,
        templateKey: "traditional_gym",
        status: "trial_active",
        subdomain: `${suffix}-demo`,
        realDataDeclaration: options.realData ?? "undeclared",
        autoCleanupEligible: options.autoCleanupEligible ?? 1,
        dataReviewRequestedAt: null,
        cleanupEligibleAt: null,
        conversionDraft: "[]",
        startedAt: 1,
        expiresAt: 100,
        pausedAt: null,
        closedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();
    return { userId, facilityId, trialId };
  }

  it("removes an unanswered trial tenant and its administrator after six hours", async () => {
    const seeded = await seedTrial("silent");
    await environmentManager.createManagedEnvironment({
      name: "Silent MVP",
      slug: "silent-demo",
      kind: "commercial_mvp",
      templateKey: "traditional_gym",
    });
    await database.db
      .insertInto("activitySessions")
      .values({
        id: "cleanup-class-silent",
        facilityId: seeded.facilityId,
        name: "Temporary class",
        description: "",
        trainerId: seeded.userId,
        trainerName: "Cleanup silent",
        maxCapacity: 10,
        scheduledAt: 1_000,
      })
      .execute();
    await database.db
      .insertInto("bookings")
      .values({
        id: "cleanup-booking-silent",
        activitySessionId: "cleanup-class-silent",
        userId: seeded.userId,
        status: "confirmed",
        createdAt: 1,
        cancelledAt: null,
      })
      .execute();

    const review = await service.evaluateDueCommercialTrialCleanups(200);
    expect(review).toMatchObject({ expired: 1, eligible: 0 });
    await expect(
      database.db
        .selectFrom("commercialTrials")
        .select(["status", "dataReviewRequestedAt", "cleanupEligibleAt"])
        .where("id", "=", seeded.trialId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "trial_expired",
      dataReviewRequestedAt: 200,
      cleanupEligibleAt: 200 + graceMs,
    });

    const cleanup = await service.evaluateDueCommercialTrialCleanups(
      200 + graceMs,
    );
    expect(cleanup).toMatchObject({
      eligible: 1,
      deletedTenants: 1,
      deletedAccounts: 1,
      executionEnabled: true,
    });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", seeded.userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("facilityProfiles")
        .select("id")
        .where("id", "=", seeded.facilityId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(environmentManager.listManagedEnvironments()).resolves.toEqual(
      [],
    );
  });

  it("never auto-removes trials with real data or existing accounts", async () => {
    const realData = await seedTrial("real-data", { realData: "yes" });
    const existingAccount = await seedTrial("existing", {
      autoCleanupEligible: 0,
    });

    await service.evaluateDueCommercialTrialCleanups(300);
    const result = await service.evaluateDueCommercialTrialCleanups(
      300 + graceMs,
    );
    expect(result).toMatchObject({ eligible: 0, deletedTenants: 0 });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "in", [realData.userId, existingAccount.userId])
        .execute(),
    ).resolves.toHaveLength(2);
  });

  it("removes the abandoned tenant but preserves an account active elsewhere", async () => {
    const seeded = await seedTrial("multi-centre");
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "cleanup-active-facility",
        slug: "cleanup-active-facility",
        name: "Active Facility",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: `cleanup-active-facility:${seeded.userId}`,
        facilityId: "cleanup-active-facility",
        userId: seeded.userId,
        role: "admin",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();

    await service.evaluateDueCommercialTrialCleanups(400);
    const result = await service.evaluateDueCommercialTrialCleanups(
      400 + graceMs,
    );
    expect(result).toMatchObject({
      eligible: 1,
      deletedTenants: 1,
      deletedAccounts: 0,
      retainedAccounts: 1,
    });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", seeded.userId)
        .executeTakeFirst(),
    ).resolves.toEqual({ id: seeded.userId });
  });

  it("defers cleanup while the user data decision is being processed", async () => {
    const seeded = await seedTrial("coordinated");
    await service.evaluateDueCommercialTrialCleanups(500);

    let release!: () => void;
    const held = coordinator.withCoordinatedManagerOperation(
      "account",
      "commercial",
      "test-data-review",
      [`commercial-trial:${seeded.facilityId}`],
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const deferred = await service.evaluateDueCommercialTrialCleanups(
      500 + graceMs,
    );
    expect(deferred).toMatchObject({ eligible: 1, deletedTenants: 0 });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", seeded.userId)
        .executeTakeFirst(),
    ).resolves.toEqual({ id: seeded.userId });

    release();
    await held;
    const retried = await service.evaluateDueCommercialTrialCleanups(
      500 + graceMs,
    );
    expect(retried).toMatchObject({
      deletedTenants: 1,
      deletedAccounts: 1,
    });
  });
});

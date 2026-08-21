import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("designated company head activation recovery", () => {
  let directory: string;
  let database: typeof import("../db/client.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-head-recovery-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update("corporate-head@example.com").digest("hex"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("resumes a pending pre-enrolment and moves fused authority to a different corporate email", async () => {
    const auth = await import("./auth.js");
    const support = await import("./umf-support.js");
    const commercial = await auth.signup(
      "commercial-head@example.com",
      "Commercial Head",
      "CommercialPassword123",
    );
    const commercialUserId = commercial.user.id;
    const requestId = "pending-designated-head";
    const now = Date.now();
    const corporatePassword = "IndependentCorporatePassword123";

    await database.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("corporateBootstrapState")
        .values({
          id: "company_head",
          claimedByUserId: commercialUserId,
          claimedAt: now,
        })
        .execute();
      await transaction
        .insertInto("umfSupportStaff")
        .values({
          userId: commercialUserId,
          role: "director",
          status: "active",
          approvedByUserId: commercialUserId,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .execute();
      await transaction
        .insertInto("companyStaffProfiles")
        .values({
          userId: commercialUserId,
          position: "platform_head",
          reportsToUserId: null,
          status: "active",
          appointedByUserId: commercialUserId,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .execute();
      await transaction
        .insertInto("umfSupportAccessRequests")
        .values({
          id: requestId,
          email: "corporate-head@example.com",
          name: "Corporate",
          lastName: "Head",
          requestedRole: "agent",
          activationKind: "staff",
          locale: "es",
          status: "pending",
          activationCodeHash: null,
          activationAttempts: 0,
          activationExpiresAt: null,
          reviewedByUserId: null,
          reviewedAt: null,
          activatedUserId: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await transaction
        .insertInto("umfSupportAccessCredentials")
        .values({
          requestId,
          passwordHash: await auth.hashPassword(corporatePassword),
          activationKind: "staff",
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        })
        .execute();
    });

    const resumed = await support.resumeDesignatedCompanyHeadActivation(
      "corporate-head@example.com",
    );
    expect(resumed.demoActivationCode).toMatch(/^\d{6}$/);
    await expect(
      database.db
        .selectFrom("umfSupportAccessRequests")
        .select(["status", "requestedRole", "activationKind"])
        .where("id", "=", requestId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "approved",
      requestedRole: "director",
      activationKind: "designated_head",
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["platformScope", "kind", "recipient"])
        .where("recipient", "=", "corporate-head@example.com")
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      platformScope: "support",
      kind: "support_update",
      recipient: "corporate-head@example.com",
    });

    const activated = await support.activateUmfSupportAccount(
      {
        email: "corporate-head@example.com",
        password: "NewIndependentCorporatePassword123",
        code: resumed.demoActivationCode,
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
      {},
    );
    expect(activated.user.identityRealm).toBe("corporate_support");
    expect(activated.user.email).toBe("corporate-head@example.com");
    expect(activated.user.id).not.toBe(commercialUserId);
    await expect(
      database.db
        .selectFrom("users")
        .select(["email", "identityRealm"])
        .where("id", "=", commercialUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      email: "commercial-head@example.com",
      identityRealm: "commercial",
    });
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select(["userId", "role", "status"])
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      userId: activated.user.id,
      role: "director",
      status: "active",
    });
    await expect(
      database.db
        .selectFrom("corporateBootstrapState")
        .select("claimedByUserId")
        .where("id", "=", "company_head")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ claimedByUserId: activated.user.id });

    await expect(
      auth.login(
        "corporate-head@example.com",
        "NewIndependentCorporatePassword123",
        "support",
      ),
    ).resolves.toMatchObject({ mfaRequired: false });
    await expect(
      auth.login(
        "commercial-head@example.com",
        "CommercialPassword123",
        "support",
      ),
    ).rejects.toThrow("Invalid email or password");
  });
});

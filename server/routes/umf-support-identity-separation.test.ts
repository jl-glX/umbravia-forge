import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("UMF Support and commercial identity separation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-identity-separation-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
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

  it("purges misplaced support authority without deleting or reopening the commercial account", async () => {
    const auth = await import("../services/auth.js");
    const lifecycle = await import("../services/account-lifecycle.js");
    const reset = await import("../services/umf-support-identity-reset.js");
    const commercial = await auth.signup(
      "member@example.com",
      "Commercial Member",
      "CommercialPassword123",
    );
    const commercialUserId = commercial.user.id;
    const now = Date.now();

    await createActiveTestFacility(database.db, "separation-facility");
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: `separation-facility:${commercialUserId}`,
        facilityId: "separation-facility",
        userId: commercialUserId,
        role: "member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await lifecycle.scheduleAccountDeletion(commercialUserId, "manual", now);
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
        .insertInto("platformOperators")
        .values({
          userId: commercialUserId,
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
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
        .insertInto("emailDeliveries")
        .values([
          {
            id: "commercial-delivery-preserved",
            userId: commercialUserId,
            platformScope: "commercial",
            kind: "security_notice",
            recipient: "member@example.com",
            locale: "es",
            payloadEncrypted: "commercial-payload",
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            nextAttemptAt: now,
            messageId: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            sentAt: null,
            expiresAt: now + 60_000,
          },
          {
            id: "misplaced-support-delivery-removed",
            userId: commercialUserId,
            platformScope: "support",
            kind: "support_update",
            recipient: "member@example.com",
            locale: "es",
            payloadEncrypted: "support-payload",
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            nextAttemptAt: now,
            messageId: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            sentAt: null,
            expiresAt: now + 60_000,
          },
        ])
        .execute();
    });

    const dryRun = await reset.planUmfSupportIdentityReset({
      corporateEmail: "support-head@example.com",
      legacyCommercialEmail: "member@example.com",
    });
    expect(dryRun).toMatchObject({
      corporateUserId: null,
      legacyCommercialUserId: commercialUserId,
      supportStaffRows: 1,
      companyStaffRows: 1,
      bootstrapRows: 1,
      corporateUserRows: 0,
    });
    await reset.applyUmfSupportIdentityReset({
      corporateEmail: "support-head@example.com",
      legacyCommercialEmail: "member@example.com",
    });

    await expect(
      database.db
        .selectFrom("users")
        .select(["id", "identityRealm"])
        .where("id", "=", commercialUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ id: commercialUserId, identityRealm: "commercial" });
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("userId")
        .where("facilityId", "=", "separation-facility")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ userId: commercialUserId });
    await expect(
      database.db
        .selectFrom("accountDeletionRequests")
        .select(["userId", "status"])
        .where("userId", "=", commercialUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ userId: commercialUserId, status: "scheduled" });
    await expect(
      database.db
        .selectFrom("platformOperators")
        .select("userId")
        .where("userId", "=", commercialUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ userId: commercialUserId });
    await expect(
      database.db.selectFrom("umfSupportStaff").select("userId").execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db.selectFrom("companyStaffProfiles").select("userId").execute(),
    ).resolves.toEqual([]);
    const retainedCommercialDeliveries = await database.db
      .selectFrom("emailDeliveries")
      .select(["id", "platformScope"])
      .where("recipient", "=", "member@example.com")
      .execute();
    expect(retainedCommercialDeliveries).toContainEqual({
      id: "commercial-delivery-preserved",
      platformScope: "commercial",
    });
    expect(retainedCommercialDeliveries).not.toContainEqual({
      id: "misplaced-support-delivery-removed",
      platformScope: "support",
    });
    expect(
      retainedCommercialDeliveries.every(
        (delivery) => delivery.platformScope === "commercial",
      ),
    ).toBe(true);

    const supportBrowser = request.agent(app);
    const registration = await supportBrowser
      .post("/api/umf-support/register")
      .send({
        email: "support-head@example.com",
        name: "Support",
        lastName: "Head",
        password: "CorporatePassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    await supportBrowser
      .post("/api/umf-support/verify-email")
      .send({ code: registration.body.demoVerificationCode })
      .expect(200);
    const designation = await import("../services/company-head-designation.js");
    await expect(
      designation.applyCompanyHeadDesignation("support-head@example.com"),
    ).resolves.toMatchObject({
      identityRealm: "corporate_support",
      supportRole: "director",
      supportStatus: "active",
      companyPosition: "platform_head",
    });

    const supportUserId = registration.body.user.id as string;
    expect(supportUserId).not.toBe(commercialUserId);
    await expect(
      database.db
        .selectFrom("users")
        .select(["email", "identityRealm"])
        .where("id", "=", supportUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      email: "support-head@example.com",
      identityRealm: "corporate_support",
    });
    await expect(
      database.db
        .selectFrom("accountDeletionRequests")
        .select("status")
        .where("userId", "=", commercialUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "scheduled" });

    const supportLogin = await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "support-head@example.com",
        password: "CorporatePassword123",
        rememberDevice: false,
      })
      .expect(200);
    const supportCookie = supportLogin.headers["set-cookie"][0];
    expect(supportCookie).toContain("umf-support_session=");

    await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "member@example.com",
        password: "CommercialPassword123",
        rememberDevice: false,
      })
      .expect(401);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", supportCookie)
      .expect(401);
  });

  it("blocks a reset aimed at a different email once the head is designated", async () => {
    const reset = await import("../services/umf-support-identity-reset.js");
    await expect(
      reset.planUmfSupportIdentityReset({
        corporateEmail: "other-support-account@example.com",
      }),
    ).rejects.toThrow("company head belongs to another identity");
    await expect(
      database.db
        .selectFrom("users")
        .select("identityRealm")
        .where("email", "=", "member@example.com")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ identityRealm: "commercial" });
  });
});

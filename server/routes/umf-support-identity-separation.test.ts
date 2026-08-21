import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("UMF Support identity separation migration", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-identity-separation-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update("shared@example.com").digest("hex"),
    );
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

  it("preserves the commercial account while moving corporate authority to a new identity", async () => {
    const auth = await import("../services/auth.js");
    const lifecycle = await import("../services/account-lifecycle.js");
    const commercial = await auth.signup(
      "shared@example.com",
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
    });

    await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "shared@example.com",
        password: "CommercialPassword123",
        rememberDevice: false,
      })
      .expect(401);

    const requested = await request(app)
      .post("/api/umf-support/access-requests")
      .send({
        email: "shared@example.com",
        name: "Corporate",
        lastName: "Head",
        requestedRole: "director",
        locale: "es",
      })
      .expect(202);
    const activated = await request(app)
      .post("/api/umf-support/activate")
      .send({
        email: "shared@example.com",
        password: "CorporatePassword123",
        code: requested.body.demoActivationCode,
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    const corporateUserId = activated.body.user.id as string;
    const corporateCookie = activated.headers["set-cookie"][0];

    expect(corporateCookie).toContain("umf-support_session=");

    expect(corporateUserId).not.toBe(commercialUserId);
    await expect(
      database.db
        .selectFrom("accountDeletionPreferences")
        .select("userId")
        .where("userId", "=", corporateUserId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .selectFrom("users")
        .select(["id", "identityRealm"])
        .where("email", "=", "shared@example.com")
        .orderBy("identityRealm")
        .execute(),
    ).resolves.toEqual([
      { id: commercialUserId, identityRealm: "commercial" },
      { id: corporateUserId, identityRealm: "corporate_support" },
    ]);

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
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ userId: commercialUserId });

    const commercialLogin = await request(app).post("/api/auth/login").send({
      identifier: "shared@example.com",
      password: "CommercialPassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    expect(commercialLogin.status).toBe(200);
    const commercialCookie = commercialLogin.headers["set-cookie"][0];
    expect(commercialCookie).toContain("umbravia-forge_session=");
    expect(commercialCookie).not.toContain("support_session");

    await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "shared@example.com",
        password: "CommercialPassword123",
        rememberDevice: false,
      })
      .expect(401);

    const commercialSession = await request(app)
      .get("/api/auth/session")
      .set("Cookie", commercialCookie)
      .expect(200);
    expect(commercialSession.body.user).toMatchObject({
      id: commercialUserId,
      identityRealm: "commercial",
      platformOperator: true,
    });

    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: commercialUserId,
        role: "director",
        status: "active",
        approvedByUserId: commercialUserId,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const supportService = await import("../services/umf-support.js");
    await expect(
      supportService.getUmfSupportCapabilities({
        sessionId: "corrupt-commercial-support-membership",
        createdAt: now,
        userId: commercialUserId,
        email: "shared@example.com",
        name: "Commercial Member",
        avatarDataUrl: "",
        role: "member",
        accountStatus: "active",
        identityRealm: "commercial",
        facility: null,
        platformOperator: true,
      }),
    ).rejects.toBeInstanceOf(supportService.UmfSupportAccessError);
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", commercialCookie)
      .expect(401);
    await request(app)
      .get("/api/umf-support/account/security")
      .set("Cookie", corporateCookie)
      .expect(200);
  });
});

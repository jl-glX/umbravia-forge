import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("configured UMF Support company head bootstrap", () => {
  const email = "configured-head@example.com";
  const password = "ConfiguredSupportPassword123";
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let userId: string;
  let initialSessionToken: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-configured-head-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256",
      createHash("sha256").update(email).digest("hex"),
    );
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    const fixtures = await import("../testing/corporate-support-fixtures.js");
    const account = await fixtures.createActiveCorporateSupportTestAccount(
      email,
      "Configured",
      password,
      {},
      {
        lastName: "Head",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    );
    userId = account.user.id;
    initialSessionToken = account.sessionToken;
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "legacy-commercial-owner",
        email,
        identityRealm: "commercial",
        phone: null,
        name: "Legacy",
        lastName: "Commercial",
        countryCode: "ES",
        locale: "es",
        accountStatus: "active",
        emailVerifiedAt: now,
        termsVersion: "draft-v1",
        termsAcceptedAt: now,
        privacyVersion: "draft-v1",
        privacyAcceptedAt: now,
        password: "not-used",
        avatarDataUrl: "",
        role: "member",
        sessionIdleTimeoutMinutes: 10080,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("accountDeletionRequests")
      .values({
        id: "legacy-commercial-deletion",
        userId: "legacy-commercial-owner",
        trigger: "manual",
        status: "scheduled",
        requestedAt: now,
        graceEndsAt: now + 86_400_000,
        cancelledAt: null,
        completedAt: null,
      })
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: "legacy-commercial-owner",
        role: "director",
        status: "active",
        approvedByUserId: "legacy-commercial-owner",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    await database.db
      .insertInto("companyStaffProfiles")
      .values({
        userId: "legacy-commercial-owner",
        position: "platform_head",
        reportsToUserId: null,
        status: "active",
        appointedByUserId: "legacy-commercial-owner",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    await database.db
      .insertInto("corporateBootstrapState")
      .values({
        id: "company_head",
        claimedByUserId: "legacy-commercial-owner",
        claimedAt: now,
      })
      .execute();
    app = (await import("../index.js")).app;
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("repairs an already verified configured account from its active corporate session", async () => {
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", userId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();

    const sessions = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .get("/api/umf-support/session")
          .set("Cookie", `umf-support_session=${initialSessionToken}`),
      ),
    );
    for (const response of sessions) {
      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        id: userId,
        identityRealm: "corporate_support",
        accessApproved: true,
      });
    }
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select(["role", "status"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ role: "director", status: "active" });
    await expect(
      database.db
        .selectFrom("companyStaffProfiles")
        .select(["position", "status"])
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ position: "platform_head", status: "active" });
    await expect(
      database.db
        .selectFrom("users")
        .select(["id", "identityRealm", "accountStatus"])
        .where("id", "=", "legacy-commercial-owner")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      id: "legacy-commercial-owner",
      identityRealm: "commercial",
      accountStatus: "active",
    });
    await expect(
      database.db
        .selectFrom("accountDeletionRequests")
        .select("status")
        .where("id", "=", "legacy-commercial-deletion")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "scheduled" });
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", "legacy-commercial-owner")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("remains idempotent when the designated account signs in again", async () => {
    await request(app)
      .post("/api/umf-support/login")
      .send({ email, password, rememberDevice: false })
      .expect(200);
    const events = await database.db
      .selectFrom("securityEvents")
      .select(["type", "metadata"])
      .where("userId", "=", userId)
      .where("type", "=", "company_head_bootstrapped")
      .execute();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.metadata)).toEqual({
      mode: "configured_email_bootstrap",
    });
  });

  it("does not grant the configured authority to another corporate account", async () => {
    const fixtures = await import("../testing/corporate-support-fixtures.js");
    const other = await fixtures.createActiveCorporateSupportTestAccount(
      "other-support@example.com",
      "Other",
      "OtherSupportPassword123",
      {},
      {
        lastName: "Support",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    );
    await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "other-support@example.com",
        password: "OtherSupportPassword123",
        rememberDevice: false,
      })
      .expect(200);
    await expect(
      database.db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", other.user.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });
});

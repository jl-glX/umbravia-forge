import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("manual company head designation", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let designation: typeof import("./company-head-designation.js");
  let fixtures: typeof import("../testing/corporate-support-fixtures.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-head-designation-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    designation = await import("./company-head-designation.js");
    fixtures = await import("../testing/corporate-support-fixtures.js");
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function createVerifiedAgent(email: string) {
    const result = await fixtures.createActiveCorporateSupportTestAccount(
      email,
      "Verified",
      "VerifiedSupportPassword123",
      {},
      {
        lastName: "Agent",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    );
    const now = Date.now();
    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: result.user.id,
        role: "agent",
        status: "active",
        approvedByUserId: result.user.id,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    return result.user.id;
  }

  it("changes only the exact verified corporate account after explicit apply", async () => {
    const userId = await createVerifiedAgent("head@example.com");
    await expect(
      designation.planCompanyHeadDesignation("head@example.com"),
    ).resolves.toMatchObject({
      userId,
      identityRealm: "corporate_support",
      accountVerified: true,
      supportRole: "agent",
      wouldChange: true,
    });
    await expect(
      designation.applyCompanyHeadDesignation("head@example.com"),
    ).resolves.toMatchObject({
      userId,
      supportRole: "director",
      supportStatus: "active",
      companyPosition: "platform_head",
      companyPositionStatus: "active",
      wouldChange: false,
    });
    await expect(
      database.db
        .selectFrom("corporateBootstrapState")
        .select("claimedByUserId")
        .where("id", "=", "company_head")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ claimedByUserId: userId });
  });

  it("does not transfer an existing head designation to a later account", async () => {
    await createVerifiedAgent("later@example.com");
    await expect(
      designation.planCompanyHeadDesignation("later@example.com"),
    ).rejects.toThrow("active platform head");
  });

  it("rejects a commercial identity even when it uses the same email", async () => {
    await database.db
      .insertInto("users")
      .values({
        id: "commercial-only",
        email: "commercial@example.com",
        identityRealm: "commercial",
        phone: null,
        name: "Commercial",
        lastName: "Only",
        countryCode: "ES",
        locale: "es",
        accountStatus: "active",
        emailVerifiedAt: Date.now(),
        termsVersion: "draft-v1",
        termsAcceptedAt: Date.now(),
        privacyVersion: "draft-v1",
        privacyAcceptedAt: Date.now(),
        password: "not-used",
        avatarDataUrl: "",
        role: "member",
        sessionIdleTimeoutMinutes: 10080,
        createdAt: Date.now(),
      })
      .execute();
    await expect(
      designation.planCompanyHeadDesignation("commercial@example.com"),
    ).rejects.toThrow("verified email");
  });
});

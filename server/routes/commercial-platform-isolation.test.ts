import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("commercial platform identity boundary", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let commercialToken: string;
  let corporateToken: string;
  let commercialUserId: string;
  let corporateUserId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-commercial-isolation-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    const commercial = await auth.signup(
      "shared-boundary@example.com",
      "Commercial Owner",
      "CommercialPassword123",
    );
    const { createActiveCorporateSupportTestAccount } =
      await import("../testing/corporate-support-fixtures.js");
    const corporate = await createActiveCorporateSupportTestAccount(
      "shared-boundary@example.com",
      "Support Operator",
      "CorporatePassword123",
      {},
      {
        lastName: "Operator",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    );
    commercialToken = commercial.sessionToken;
    corporateToken = corporate.sessionToken;
    commercialUserId = commercial.user.id;
    corporateUserId = corporate.user.id;

    const now = Date.now();
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: now })
      .where("id", "=", commercialUserId)
      .execute();

    // Model a corrupt historical relation. Realm authorization must still win.
    await database.db
      .insertInto("platformOperators")
      .values([
        {
          userId: corporateUserId,
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          userId: commercialUserId,
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps same-email commercial and support identities as separate rows", async () => {
    const identities = await database.db
      .selectFrom("users")
      .select(["id", "identityRealm"])
      .where("email", "=", "shared-boundary@example.com")
      .orderBy("identityRealm")
      .execute();

    expect(identities).toEqual([
      { id: commercialUserId, identityRealm: "commercial" },
      { id: corporateUserId, identityRealm: "corporate_support" },
    ]);
    expect(commercialUserId).not.toBe(corporateUserId);
  });

  it("rejects a support cookie and a corporate token on commercial session routes", async () => {
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", `umf-support_session=${corporateToken}`)
      .expect(401);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", `umbravia-forge_session=${corporateToken}`)
      .expect(401);
    await request(app)
      .get("/api/auth/facilities")
      .set("Cookie", `umbravia-forge_session=${corporateToken}`)
      .expect(401);

    await request(app)
      .get("/api/auth/session")
      .set("Cookie", `umbravia-forge_session=${commercialToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          id: commercialUserId,
          identityRealm: "commercial",
        });
      });
  });

  it("does not let a corrupt operator relation override the support realm", async () => {
    const facilityContext = await import("../services/facility-context.js");
    const relation = await database.db
      .selectFrom("platformOperators")
      .select(["userId", "status"])
      .where("userId", "=", corporateUserId)
      .executeTakeFirstOrThrow();
    expect(relation.status).toBe("active");
    await expect(
      facilityContext.isPlatformOperator(corporateUserId),
    ).resolves.toBe(false);
    await expect(
      facilityContext.isPlatformOperator(commercialUserId),
    ).resolves.toBe(true);

    await request(app)
      .get("/api/account/lifecycle")
      .set("Cookie", `umbravia-forge_session=${corporateToken}`)
      .expect(401);
  });

  it("keeps shared manager administration out of commercial web routes", async () => {
    const [serverIndex, clientRoutes, accountMenu, spanishCatalog] =
      await Promise.all([
        readFile(new URL("../index.ts", import.meta.url), "utf8"),
        readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8"),
        readFile(
          new URL(
            "../../client/src/components/AccountMenu.tsx",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL("../../client/src/i18n/locales/es.json", import.meta.url),
          "utf8",
        ),
      ]);
    expect(serverIndex).not.toMatch(
      /\.\/routes\/(?:manager-console|resource-manager|security-manager|environment-manager|email-manager|capability-roadmap|data-retention)|umf-corporate/,
    );
    expect(clientRoutes).not.toMatch(
      /ManagerConsolePage|ResourceManagerPage|SecurityManagerPage|EnvironmentManagerPage|EmailManagerPage|CapabilityRoadmapPage|DataRetentionPage/,
    );
    expect(accountMenu).not.toMatch(
      /manager-console|umf-support|SquareTerminal/,
    );
    expect(accountMenu).toContain('to="/support"');
    expect(JSON.parse(spanishCatalog).accountMenu).toEqual({
      open: "Abrir menú de cuenta",
      manage: "Abrir área de cuenta",
      support: "Ayuda del centro",
    });
  });
});

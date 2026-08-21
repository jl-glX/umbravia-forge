import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("shared internal manager administrator", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let service: typeof import("./internal-manager-administrators.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-manager-admin-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    service = await import("./internal-manager-administrators.js");
    await database.initializeDatabase();

    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "commercial-operator",
          email: "operator@example.com",
          identityRealm: "commercial",
          phone: null,
          name: "Commercial Operator",
          avatarDataUrl: "",
          password: "not-used-by-this-test",
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
        {
          id: "support-operator",
          email: "support@example.com",
          identityRealm: "corporate_support",
          phone: null,
          name: "Support Operator",
          avatarDataUrl: "",
          password: "not-used-by-this-test",
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("platformOperators")
      .values([
        {
          userId: "commercial-operator",
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          userId: "support-operator",
          source: "controlled_provisioning",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: "support-operator",
        role: "director",
        status: "active",
        approvedByUserId: null,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    await database.db
      .insertInto("companyStaffProfiles")
      .values({
        userId: "support-operator",
        position: "platform_head",
        reportsToUserId: null,
        status: "active",
        appointedByUserId: "support-operator",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
  }, 20_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("admits only a verified active commercial platform operator", async () => {
    await expect(
      service.resolveInternalManagerAdministratorActor(
        " OPERATOR@EXAMPLE.COM ",
        "commercial",
      ),
    ).resolves.toEqual({
      userId: "commercial-operator",
      email: "operator@example.com",
      name: "Commercial Operator",
      identityRealm: "commercial",
      platformScope: "commercial",
      authority: "commercial-platform-operator",
    });

    await expect(
      service.resolveInternalManagerAdministratorActor(
        "support@example.com",
        "commercial",
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_MANAGER_ADMINISTRATOR_ACCESS_DENIED",
    });
  });

  it("admits the active support platform head only for the support scope", async () => {
    await expect(
      service.resolveInternalManagerAdministratorActor(
        "support@example.com",
        "support",
      ),
    ).resolves.toEqual({
      userId: "support-operator",
      email: "support@example.com",
      name: "Support Operator",
      identityRealm: "corporate_support",
      platformScope: "support",
      authority: "support-platform-head",
    });
  });

  it.each(["commercial", "support"] as const)(
    "requires the local Linux allowlist before %s application authority",
    (platformScope) => {
      expect(
        service.authorizeLocalLinuxManagerAdministrator({
          operatingSystem: "linux",
          effectiveUserId: 1001,
          linuxUser: "umbravia-admin",
          allowedLinuxUsers: "deploy, umbravia-admin",
          platformScope,
        }),
      ).toEqual({
        channel: "local-linux-terminal",
        linuxUser: "umbravia-admin",
        platformScope,
      });
      expect(() =>
        service.authorizeLocalLinuxManagerAdministrator({
          operatingSystem: "linux",
          effectiveUserId: 1001,
          linuxUser: "not-allowed",
          allowedLinuxUsers: "deploy, umbravia-admin",
          platformScope,
        }),
      ).toThrow(service.InternalManagerAdministratorAccessError);
    },
  );

  it("rejects root and non-Linux execution", () => {
    for (const input of [
      { operatingSystem: "linux" as const, effectiveUserId: 0 },
      { operatingSystem: "win32" as const, effectiveUserId: null },
    ]) {
      expect(() =>
        service.authorizeLocalLinuxManagerAdministrator({
          ...input,
          linuxUser: "umbravia-admin",
          allowedLinuxUsers: "umbravia-admin",
          platformScope: "commercial",
        }),
      ).toThrow(service.InternalManagerAdministratorAccessError);
    }
  });

  it("uses one localized administrator across every shared manager profile", () => {
    const definitions = service.listInternalManagerAdministrators();
    expect(definitions).toHaveLength(12);
    expect(new Set(definitions.map(({ profileId }) => profileId)).size).toBe(
      12,
    );
    for (const definition of definitions) {
      expect(definition.copy.es.label).not.toBe("");
      expect(definition.copy.en.label).not.toBe("");
      expect(definition.copy.de.label).not.toBe("");
    }
  });

  it("exposes a shared read-only Linux boundary without web, remote or secret capabilities", async () => {
    const actor = await service.resolveInternalManagerAdministratorActor(
      "operator@example.com",
      "commercial",
    );
    for (const definition of service.listInternalManagerAdministrators()) {
      const managerInterface = service.getInternalManagerAdministratorInterface(
        actor,
        definition.profileId,
        "commercial",
        "es",
      );
      expect(managerInterface.administratorId).toBe(
        "shared-internal-manager-administrator",
      );
      expect(managerInterface.platformScope).toBe("commercial");
      expect(managerInterface.interface).toEqual({
        channel: "local-linux-terminal",
        mode: "observe-and-coordinate",
        webAvailable: false,
        remoteApiAvailable: false,
      });
      expect(managerInterface.boundaries).toEqual({
        managedIdentityRealms: ["commercial", "corporate_support"],
        operatorAuthority: "commercial-platform-operator",
        requiresScopeAuthority: true,
        webSessionAuthenticationEnabled: false,
        secretValuesExposed: false,
        secretMutationEnabled: false,
        hostCommandExecutionEnabled: false,
        domainMutationEnabled: false,
      });
    }
  });

  it("shows only operations explicitly assigned to the selected platform scope", async () => {
    const coordinator = await import("./manager-coordinator.js");
    const actor = await service.resolveInternalManagerAdministratorActor(
      "operator@example.com",
      "commercial",
    );
    const supportActor = await service.resolveInternalManagerAdministratorActor(
      "support@example.com",
      "support",
    );
    let releaseCommercial!: () => void;
    let releaseSupport!: () => void;
    const commercialRun = coordinator.withCoordinatedManagerOperation(
      "account",
      "commercial",
      "commercial-route-check",
      ["commercial-test-scope"],
      () =>
        new Promise<void>((resolve) => {
          releaseCommercial = resolve;
        }),
    );
    const supportRun = coordinator.withCoordinatedManagerOperation(
      "account",
      "support",
      "support-route-check",
      ["support-test-scope"],
      () =>
        new Promise<void>((resolve) => {
          releaseSupport = resolve;
        }),
    );

    const commercialView = service.getInternalManagerAdministratorInterface(
      actor,
      "manager-account",
      "commercial",
    );
    const supportView = service.getInternalManagerAdministratorInterface(
      supportActor,
      "manager-account",
      "support",
    );
    expect(commercialView.runtime.activeOperations).toMatchObject([
      { operation: "commercial-route-check", platformScope: "commercial" },
    ]);
    expect(supportView.runtime.activeOperations).toMatchObject([
      { operation: "support-route-check", platformScope: "support" },
    ]);

    releaseCommercial();
    releaseSupport();
    await Promise.all([commercialRun, supportRun]);
  });

  it("keeps same-content manager signals separated by platform scope", async () => {
    const coordinator = await import("./manager-coordinator.js");
    const actor = await service.resolveInternalManagerAdministratorActor(
      "operator@example.com",
      "commercial",
    );
    const supportActor = await service.resolveInternalManagerAdministratorActor(
      "support@example.com",
      "support",
    );
    coordinator.publishManagerSignal(
      "account",
      "commercial",
      "warning",
      "MANAGER_SCOPE_TEST",
      "The same safe diagnostic message.",
    );
    coordinator.publishManagerSignal(
      "account",
      "support",
      "warning",
      "MANAGER_SCOPE_TEST",
      "The same safe diagnostic message.",
    );

    const commercialSignals = service.getInternalManagerAdministratorInterface(
      actor,
      "manager-account",
      "commercial",
    ).runtime.recentSignals;
    const supportSignals = service.getInternalManagerAdministratorInterface(
      supportActor,
      "manager-account",
      "support",
    ).runtime.recentSignals;
    expect(
      commercialSignals.filter(({ code }) => code === "MANAGER_SCOPE_TEST"),
    ).toMatchObject([{ platformScope: "commercial" }]);
    expect(
      supportSignals.filter(({ code }) => code === "MANAGER_SCOPE_TEST"),
    ).toMatchObject([{ platformScope: "support" }]);
  });
});

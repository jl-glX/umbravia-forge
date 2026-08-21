import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CorporateManagerProfileId } from "../db/types.js";

const diagnosticProbeMocks = vi.hoisted(() => ({
  run: vi.fn(async (check: string) => ({ check, healthy: true })),
  format: vi.fn(() => ["probe=healthy", "target=diagnostic-probe"]),
}));

vi.mock("./support-diagnostic-probe.js", () => ({
  runSupportDiagnosticProbe: diagnosticProbeMocks.run,
  formatSupportDiagnosticProbeReport: diagnosticProbeMocks.format,
}));

describe("corporate manager terminal security", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let managerConsole: typeof import("./manager-console.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-manager-console-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    managerConsole = await import("./manager-console.js");
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function createManager(
    suffix: string,
    profileId: CorporateManagerProfileId = "manager-core",
  ) {
    const userId = `manager-console-${suffix}`;
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: userId,
        email: `${suffix}@manager-console.test`,
        phone: null,
        name: `Manager ${suffix}`,
        avatarDataUrl: "",
        password: "not-used-by-this-test",
        role: "admin",
        sessionIdleTimeoutMinutes: 15,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("corporateRoleAssignments")
      .values({
        id: `corporate-role-${suffix}`,
        userId,
        profileId,
        assignedByUserId: userId,
        status: "active",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    return userId;
  }

  async function createExternalIdentity(userId: string) {
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "external",
    });
    const connected = await managerConsole.exchangeManagerTerminalCredential(
      issued.credential,
      "external",
    );
    return await managerConsole.authenticateManagerTerminalSession(
      connected.terminalSessionToken,
      "external",
    );
  }

  it("exposes the fixed hierarchy and nests the cryptographic replacement manager", () => {
    const supreme = managerConsole.corporateConsoleProfiles.find(
      (profile) => profile.id === "umbravia-forge",
    );
    const core = managerConsole.corporateConsoleProfiles.find(
      (profile) => profile.id === "manager-core",
    );
    const coordinator = managerConsole.corporateConsoleProfiles.find(
      (profile) => profile.id === "manager-coordinator",
    );
    const administrator = managerConsole.corporateConsoleProfiles.find(
      (profile) => profile.id === "manager-flow-administrator",
    );
    const auxiliary = managerConsole.corporateConsoleProfiles.find(
      (profile) => profile.id === "manager-cryptographic-material-replacement",
    );

    expect(supreme).toMatchObject({ priority: 0, assignable: false });
    expect(core).toMatchObject({ priority: 1, parentId: "umbravia-forge" });
    expect(coordinator).toMatchObject({
      priority: 2,
      parentId: "manager-core",
    });
    expect(administrator).toMatchObject({
      priority: 3,
      parentId: "manager-coordinator",
    });
    expect(auxiliary).toMatchObject({
      priority: 4,
      assignable: false,
      parentId: "manager-encryption",
    });
  });

  it("returns delegated modules to the company head when assignments disappear", async () => {
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "company-platform-head",
          email: "company-platform-head@example.test",
          phone: null,
          name: "Platform Head",
          avatarDataUrl: "",
          password: "not-used-by-this-test",
          role: "admin",
          sessionIdleTimeoutMinutes: 15,
          createdAt: now,
        },
        {
          id: "company-support-lead",
          email: "company-support-lead@example.test",
          phone: null,
          name: "Support Lead",
          avatarDataUrl: "",
          password: "not-used-by-this-test",
          role: "admin",
          sessionIdleTimeoutMinutes: 15,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("companyStaffProfiles")
      .values([
        {
          userId: "company-platform-head",
          position: "platform_head",
          reportsToUserId: null,
          status: "active",
          appointedByUserId: "company-platform-head",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          userId: "company-support-lead",
          position: "area_head",
          reportsToUserId: "company-platform-head",
          status: "active",
          appointedByUserId: "company-platform-head",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: "company-support-lead",
        role: "agent",
        status: "active",
        approvedByUserId: "company-platform-head",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();

    const initial = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(initial).toMatchObject({ companyHead: true, enabled: true });
    expect(initial.profileIds).toContain("manager-support");
    expect(initial.automaticProfileIds).toContain("manager-support");

    await database.db
      .insertInto("corporateRoleDelegations")
      .values({
        id: "corporate-delegation-pending-support",
        profileId: "manager-support",
        delegatedByUserId: "company-platform-head",
        recipientUserId: "company-support-lead",
        status: "pending",
        assignmentId: null,
        createdAt: now,
        respondedAt: null,
        updatedAt: now,
      })
      .execute();
    const awaitingDecision = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(awaitingDecision.profileIds).not.toContain("manager-support");

    await database.db
      .updateTable("umfSupportStaff")
      .set({ status: "revoked", revokedAt: Date.now() })
      .where("userId", "=", "company-support-lead")
      .execute();
    const unavailableRecipient = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(unavailableRecipient.profileIds).toContain("manager-support");
    await database.db
      .updateTable("umfSupportStaff")
      .set({ status: "active", revokedAt: null })
      .where("userId", "=", "company-support-lead")
      .execute();

    await database.db
      .updateTable("corporateRoleDelegations")
      .set({ status: "rejected", respondedAt: Date.now() })
      .where("id", "=", "corporate-delegation-pending-support")
      .execute();
    const rejected = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(rejected.profileIds).toContain("manager-support");

    await database.db
      .insertInto("corporateRoleAssignments")
      .values({
        id: "corporate-role-delegated-support",
        userId: "company-support-lead",
        profileId: "manager-support",
        assignedByUserId: "company-platform-head",
        status: "active",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    const delegated = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(delegated.profileIds).not.toContain("manager-support");
    expect(delegated.profileIds).toContain("manager-email");

    await database.db
      .updateTable("corporateRoleAssignments")
      .set({ status: "revoked", revokedAt: Date.now() })
      .where("id", "=", "corporate-role-delegated-support")
      .execute();
    const restored = await managerConsole.getCorporateConsoleAccess(
      "company-platform-head",
      true,
    );
    expect(restored.profileIds).toContain("manager-support");
    expect(restored.automaticProfileIds).toContain("manager-support");
  });

  it("exposes an isolated Linux workspace without host or secret access", async () => {
    const userId = await createManager("safe-commands");
    const identity = await createExternalIdentity(userId);
    const overview = await managerConsole.getManagerConsoleOverview(identity);
    expect(overview).toMatchObject({
      shell: "bash",
      mode: "isolated-linux-workspace",
      operatingSystemAccess: "isolated-container-only",
      execution: {
        hostNetwork: false,
        hostFilesystemMounted: false,
        readOnlyRootFilesystem: true,
      },
    });
    expect(overview.allowedCommands).toContain("exit");
    await expect(
      managerConsole.executeManagerConsoleCommand({
        actorUserId: userId,
        terminalIdentity: identity,
        command: "cat /etc/passwd",
      }),
    ).rejects.toThrow("not enabled");
  });

  it("keeps internal credentials closed without store-app attestation", async () => {
    const userId = await createManager("internal-gate");
    await expect(
      managerConsole.issueManagerTerminalCredential({
        userId,
        accessMode: "internal",
      }),
    ).rejects.toThrow("attested corporate desktop app");
  });

  it("keeps an internal credential only while activity and trust remain valid", async () => {
    const userId = await createManager("internal-session");
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "internal",
      trustedInternalClient: {
        distribution: "microsoft-store",
        attestationVerified: true,
      },
    });
    expect(issued).toMatchObject({
      accessMode: "internal",
      expiresAt: null,
      singleUse: false,
    });
    expect(issued.credential).toMatch(/^ufi_/);

    const stored = await database.db
      .selectFrom("managerTerminalAccess")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    expect(stored.credentialHash).not.toBe(issued.credential);
    expect(stored.terminalSessionHash).toBe(stored.credentialHash);
    expect(stored.lastHeartbeatAt).toEqual(expect.any(Number));

    await expect(
      managerConsole.exchangeManagerTerminalCredential(
        issued.credential,
        "internal",
      ),
    ).resolves.toMatchObject({
      terminalSessionToken: issued.credential,
      accessMode: "internal",
      expiresAt: null,
    });

    await database.db
      .updateTable("managerTerminalAccess")
      .set({
        lastActivityAt:
          Date.now() -
          managerConsole.MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS -
          1,
      })
      .where("userId", "=", userId)
      .execute();
    await expect(
      managerConsole.authenticateManagerTerminalSession(
        issued.credential,
        "internal",
      ),
    ).rejects.toThrow("invalid or expired");
  });

  it("revokes a terminal session when its portable heartbeat stops", async () => {
    const userId = await createManager("heartbeat-loss");
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "internal",
      trustedInternalClient: {
        distribution: "mac-app-store",
        attestationVerified: true,
      },
    });
    await database.db
      .updateTable("managerTerminalAccess")
      .set({
        lastHeartbeatAt:
          Date.now() - managerConsole.MANAGER_TERMINAL_HEARTBEAT_TIMEOUT_MS - 1,
      })
      .where("userId", "=", userId)
      .execute();

    await expect(
      managerConsole.authenticateManagerTerminalSession(
        issued.credential,
        "internal",
      ),
    ).rejects.toThrow("invalid or expired");
    await expect(
      database.db
        .selectFrom("managerTerminalAccess")
        .select("revokedAt")
        .where("userId", "=", userId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ revokedAt: expect.any(Number) });
  });

  it("exchanges an external credential once and exit revokes its session", async () => {
    const userId = await createManager("external-session");
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "external",
    });
    expect(issued).toMatchObject({
      accessMode: "external",
      singleUse: true,
    });
    const connected = await managerConsole.exchangeManagerTerminalCredential(
      issued.credential,
      "external",
    );
    expect(connected.terminalSessionToken).toMatch(/^ufs_/);
    await expect(
      managerConsole.exchangeManagerTerminalCredential(
        issued.credential,
        "external",
      ),
    ).rejects.toThrow("invalid or expired");
    await expect(
      managerConsole.authenticateManagerTerminalSession(
        connected.terminalSessionToken,
        "external",
      ),
    ).resolves.toMatchObject({ userId });
    await managerConsole.closeManagerTerminalSession(
      connected.terminalSessionToken,
      "external",
    );
    await expect(
      managerConsole.authenticateManagerTerminalSession(
        connected.terminalSessionToken,
        "external",
      ),
    ).rejects.toThrow("invalid or expired");
  });

  it("limits an external credential to its explicitly selected manager branch", async () => {
    const userId = await createManager("scoped-credential");
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "external",
      scopeProfileId: "manager-email",
    });
    const connected = await managerConsole.exchangeManagerTerminalCredential(
      issued.credential,
      "external",
    );
    const identity = await managerConsole.authenticateManagerTerminalSession(
      connected.terminalSessionToken,
      "external",
    );
    const overview = await managerConsole.getManagerConsoleOverview(identity);

    expect(overview.access).toMatchObject({
      authorityProfileId: "manager-email",
      priority: 4,
    });
    expect(overview.profiles.map((profile) => profile.id)).toEqual([
      "umbravia-forge",
      "manager-email",
    ]);
  });

  it("runs the read-only probe only from the support manager branch", async () => {
    const supportUserId = await createManager(
      "support-diagnostics",
      "manager-support",
    );
    const supportIdentity = await createExternalIdentity(supportUserId);
    const result = await managerConsole.executeManagerConsoleCommand({
      actorUserId: supportUserId,
      terminalIdentity: supportIdentity,
      command: "ufctl diagnose probe tls",
    });

    expect(result.lines).toEqual(["probe=healthy", "target=diagnostic-probe"]);
    expect(diagnosticProbeMocks.run).toHaveBeenCalledWith("tls");

    const emailUserId = await createManager(
      "email-diagnostics-denied",
      "manager-email",
    );
    const emailIdentity = await createExternalIdentity(emailUserId);
    await expect(
      managerConsole.executeManagerConsoleCommand({
        actorUserId: emailUserId,
        terminalIdentity: emailIdentity,
        command: "ufctl diagnose probe all",
      }),
    ).rejects.toThrow("only available in the support manager branch");
  });

  it("creates organizational workspaces and applies temporary access only by consent", async () => {
    const actorUserId = await createManager("dynamic-actor");
    const targetUserId = await createManager(
      "dynamic-target",
      "manager-support",
    );
    const actorIdentity = await createExternalIdentity(actorUserId);

    await managerConsole.executeManagerConsoleCommand({
      actorUserId,
      terminalIdentity: actorIdentity,
      command: "ufctl unit create workgroup mail-audit Mail audit",
    });
    await managerConsole.executeManagerConsoleCommand({
      actorUserId,
      terminalIdentity: actorIdentity,
      command: `ufctl unit add mail-audit ${targetUserId} member`,
    });
    await managerConsole.executeManagerConsoleCommand({
      actorUserId,
      terminalIdentity: actorIdentity,
      command: `ufctl permission grant manager-email ${targetUserId} 30 external unit:mail-audit`,
    });

    await expect(
      database.db
        .selectFrom("managerOrganizationalUnits")
        .select(["slug", "kind"])
        .where("slug", "=", "mail-audit")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ slug: "mail-audit", kind: "workgroup" });
    await expect(
      managerConsole.issueManagerTerminalCredential({
        userId: targetUserId,
        accessMode: "external",
        scopeProfileId: "manager-email",
        allowTemporaryPermissions: false,
      }),
    ).rejects.toThrow("exceeds the currently effective authority");
    await expect(
      managerConsole.issueManagerTerminalCredential({
        userId: targetUserId,
        accessMode: "external",
        scopeProfileId: "manager-email",
        allowTemporaryPermissions: true,
      }),
    ).resolves.toMatchObject({
      scopeProfileId: "manager-email",
      allowTemporaryPermissions: true,
    });
  });

  it("revokes access immediately after role or account trust is lost", async () => {
    const roleUserId = await createManager("role-loss", "manager-coordinator");
    const roleCredential = await managerConsole.issueManagerTerminalCredential({
      userId: roleUserId,
      accessMode: "internal",
      trustedInternalClient: {
        distribution: "microsoft-store",
        attestationVerified: true,
      },
    });
    await database.db
      .updateTable("corporateRoleAssignments")
      .set({ status: "revoked", revokedAt: Date.now() })
      .where("userId", "=", roleUserId)
      .execute();
    await expect(
      managerConsole.authenticateManagerTerminalSession(
        roleCredential.credential,
        "internal",
      ),
    ).rejects.toThrow("invalid or expired");

    const accountUserId = await createManager("account-loss");
    const accountCredential =
      await managerConsole.issueManagerTerminalCredential({
        userId: accountUserId,
        accessMode: "internal",
        trustedInternalClient: {
          distribution: "mac-app-store",
          attestationVerified: true,
        },
      });
    await database.db
      .updateTable("users")
      .set({ accountStatus: "security_review" })
      .where("id", "=", accountUserId)
      .execute();
    await expect(
      managerConsole.authenticateManagerTerminalSession(
        accountCredential.credential,
        "internal",
      ),
    ).rejects.toThrow("invalid or expired");
    await expect(
      database.db
        .selectFrom("managerTerminalAccess")
        .select("revokedAt")
        .where("userId", "=", accountUserId)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({ revokedAt: expect.any(Number) });
  });
});

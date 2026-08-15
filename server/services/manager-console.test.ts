import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    profileId:
      | "manager-core"
      | "manager-coordinator"
      | "manager-encryption" = "manager-core",
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

  it("provides only the virtual Linux-like command set", async () => {
    const userId = await createManager("safe-commands");
    const overview = await managerConsole.getManagerConsoleOverview(userId);
    expect(overview).toMatchObject({
      shell: "umbravia-sh",
      mode: "virtual-linux-command-set",
      operatingSystemAccess: false,
    });
    expect(overview.allowedCommands).toContain("exit");
    await expect(
      managerConsole.executeManagerConsoleCommand({
        actorUserId: userId,
        command: "cat /etc/passwd",
      }),
    ).rejects.toThrow("real system paths");
    await expect(
      managerConsole.executeManagerConsoleCommand({
        actorUserId: userId,
        command: "whoami | more",
      }),
    ).rejects.toThrow("Pipes");
  });

  it("keeps an internal credential only while activity and trust remain valid", async () => {
    const userId = await createManager("internal-session");
    const issued = await managerConsole.issueManagerTerminalCredential({
      userId,
      accessMode: "internal",
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

  it("revokes access immediately after role or account trust is lost", async () => {
    const roleUserId = await createManager("role-loss", "manager-coordinator");
    const roleCredential = await managerConsole.issueManagerTerminalCredential({
      userId: roleUserId,
      accessMode: "internal",
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

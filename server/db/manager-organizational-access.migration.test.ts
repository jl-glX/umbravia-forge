import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("dynamic manager organizational access migration", () => {
  let directory: string;
  let database: typeof import("./client.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-manager-units-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("./client.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates dynamic units, memberships and temporary permissions", async () => {
    await expect(
      database.db
        .selectFrom("managerOrganizationalUnits")
        .selectAll()
        .execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .selectFrom("managerOrganizationalMemberships")
        .selectAll()
        .execute(),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .selectFrom("managerTemporaryPermissions")
        .selectAll()
        .execute(),
    ).resolves.toEqual([]);
  });

  it("stores explicit scope and temporary-permission consent on credentials", async () => {
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "manager-migration-user",
        email: "manager-migration@example.com",
        phone: null,
        name: "Manager Migration",
        avatarDataUrl: "",
        password: "not-used",
        role: "admin",
        sessionIdleTimeoutMinutes: 15,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("managerTerminalAccess")
      .values({
        id: "manager-migration-access",
        userId: "manager-migration-user",
        accessMode: "external",
        scopeProfileId: "manager-email",
        allowTemporaryPermissions: 1,
        credentialHash: "manager-migration-credential",
        terminalSessionHash: null,
        createdAt: now,
        expiresAt: now + 60_000,
        lastActivityAt: now,
        lastHeartbeatAt: now,
        consumedAt: null,
        terminalSessionExpiresAt: null,
        revokedAt: null,
      })
      .execute();

    await expect(
      database.db
        .selectFrom("managerTerminalAccess")
        .select(["scopeProfileId", "allowTemporaryPermissions"])
        .where("id", "=", "manager-migration-access")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      scopeProfileId: "manager-email",
      allowTemporaryPermissions: 1,
    });
  });
});

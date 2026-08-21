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

  it("does not retain the retired browser-terminal credential table", async () => {
    const tables = await database.db.introspection.getTables();
    expect(tables.some((table) => table.name === "managerTerminalAccess")).toBe(
      false,
    );
  });
});

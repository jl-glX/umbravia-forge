import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("initial company head provisioning", () => {
  let directory: string;
  let databasePath: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-company-head-"));
    databasePath = join(directory, "database.sqlite");
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    const database = await import("../db/client.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values({
        id: "company-head",
        email: "head@example.com",
        phone: null,
        name: "Company Head",
        avatarDataUrl: "",
        password: "not-used-by-this-test",
        role: "admin",
        accountStatus: "active",
        emailVerifiedAt: Date.now(),
        sessionIdleTimeoutMinutes: 10080,
        createdAt: Date.now(),
      })
      .execute();
    await database.closeDatabase();
  }, 20_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates one visible company head and grants platform authority separately", () => {
    const command = [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      join(process.cwd(), "scripts", "provision-company-head.ts"),
      "--email",
      "head@example.com",
      "--confirm-email",
      "head@example.com",
      "--apply",
    ];
    const run = () =>
      execFileSync(process.execPath, command, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATA_DIRECTORY: directory,
          NODE_ENV: "test",
        },
        encoding: "utf8",
      });

    expect(run()).toContain('"status": "applied"');
    expect(run()).toContain('"platformOperatorChanged": false');

    const raw = new Database(databasePath, { readonly: true });
    try {
      expect(
        raw
          .prepare(
            "SELECT position, status, reportsToUserId FROM companyStaffProfiles WHERE userId = ?",
          )
          .get("company-head"),
      ).toEqual({
        position: "platform_head",
        status: "active",
        reportsToUserId: null,
      });
      expect(
        raw
          .prepare("SELECT role, status FROM umfSupportStaff WHERE userId = ?")
          .get("company-head"),
      ).toEqual({ role: "director", status: "active" });
      expect(
        raw
          .prepare(
            "SELECT source, status FROM platformOperators WHERE userId = ?",
          )
          .get("company-head"),
      ).toEqual({ source: "controlled_provisioning", status: "active" });
      expect(
        raw
          .prepare(
            "SELECT COUNT(*) AS count FROM companyStaffProfiles WHERE status = 'active'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        raw
          .prepare(
            "SELECT id, claimedByUserId FROM corporateBootstrapState WHERE id = 'company_head'",
          )
          .get(),
      ).toEqual({ id: "company_head", claimedByUserId: "company-head" });
    } finally {
      raw.close();
    }
  }, 20_000);
});

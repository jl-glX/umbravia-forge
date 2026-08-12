import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("support tenant migration", () => {
  let directory: string | undefined;
  let migratedDatabase: typeof import("./client.js") | undefined;

  afterEach(async () => {
    await migratedDatabase?.closeDatabase();
    migratedDatabase = undefined;
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("moves legacy knowledge into primary and permits the same slug per facility", async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-support-v19-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.db
      .insertInto("users")
      .values({
        id: "support-author",
        email: "support-author@example.com",
        phone: null,
        name: "Support Author",
        avatarDataUrl: "",
        password: "test-only",
        role: "admin",
        sessionIdleTimeoutMinutes: 10080,
        createdAt: 10,
      })
      .execute();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TABLE supportKnowledgeArticles;
      CREATE TABLE supportKnowledgeArticles (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL,
        authorUserId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        publishedAt INTEGER
      );
      INSERT INTO supportKnowledgeArticles (
        id, slug, title, summary, body, category, status, authorUserId,
        createdAt, updatedAt, publishedAt
      ) VALUES (
        'legacy-article', 'shared-guide', 'Legacy guide', '', 'Legacy body',
        'general', 'published', 'support-author', 10, 10, 10
      );
    `);
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await migratedDatabase.initializeDatabase();
    const now = Date.now();
    await migratedDatabase.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await migratedDatabase.db
      .insertInto("supportKnowledgeArticles")
      .values({
        id: "secondary-article",
        facilityId: "secondary",
        slug: "shared-guide",
        title: "Secondary guide",
        summary: "",
        body: "Secondary body",
        category: "general",
        status: "published",
        authorUserId: "support-author",
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
      })
      .execute();

    await expect(
      migratedDatabase.db
        .selectFrom("supportKnowledgeArticles")
        .select(["id", "facilityId", "slug"])
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([
      {
        id: "legacy-article",
        facilityId: "primary",
        slug: "shared-guide",
      },
      {
        id: "secondary-article",
        facilityId: "secondary",
        slug: "shared-guide",
      },
    ]);
  });

  it("recreates the knowledge table when the rest of the support schema already exists", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-support-partial-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();

    const baselineDatabase = await import("./client.js");
    await baselineDatabase.initializeDatabase();
    await baselineDatabase.closeDatabase();

    const raw = new Database(join(directory, "database.sqlite"));
    raw.exec("DROP TABLE supportKnowledgeArticles");
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'supportTickets'",
        )
        .get(),
    ).toEqual({ name: "supportTickets" });
    raw.close();

    vi.resetModules();
    migratedDatabase = await import("./client.js");
    await expect(
      migratedDatabase.initializeDatabase(),
    ).resolves.toBeUndefined();
    await expect(
      migratedDatabase.db
        .selectFrom("supportKnowledgeArticles")
        .selectAll()
        .execute(),
    ).resolves.toEqual([]);
  });
});

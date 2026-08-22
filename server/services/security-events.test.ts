import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("security event retention", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let events: typeof import("./security-events.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-security-events-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.resetModules();
    database = await import("../db/client.js");
    events = await import("./security-events.js");
    await database.initializeDatabase();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("removes only history older than 30 days", async () => {
    const now = Date.UTC(2026, 7, 22, 12);
    await database.db
      .insertInto("securityEvents")
      .values([
        {
          id: "security-expired",
          userId: null,
          type: "login_failed",
          createdAt: now - events.SECURITY_EVENT_RETENTION_MS - 1,
          metadata: "{}",
        },
        {
          id: "security-current",
          userId: null,
          type: "private_content_accessed",
          createdAt: now - events.SECURITY_EVENT_RETENTION_MS,
          metadata: "{}",
        },
      ])
      .execute();

    await expect(events.purgeExpiredSecurityEvents(now)).resolves.toBe(1);
    await expect(
      database.db
        .selectFrom("securityEvents")
        .select("id")
        .orderBy("id")
        .execute(),
    ).resolves.toEqual([{ id: "security-current" }]);
  });
});

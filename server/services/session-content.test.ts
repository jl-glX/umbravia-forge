import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FACILITY_ID = "facility-session-content";

describe("class session content", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let sessions: typeof import("./session-content.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-session-content-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    sessions = await import("./session-content.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "content-member",
        email: "content@example.com",
        phone: null,
        name: "Content Member",
        avatarDataUrl: "",
        password: "not-used",
        role: "member",
        sessionIdleTimeoutMinutes: 10_080,
        createdAt: Date.now(),
      })
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: FACILITY_ID,
        slug: "session-content",
        name: "Session content",
        logoDataUrl: "",
        accentColor: "#f97316",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("activitySessions")
      .values({
        facilityId: FACILITY_ID,
        id: "content-class",
        name: "Strength session",
        description: "",
        trainerId: "trainer",
        trainerName: "Trainer",
        maxCapacity: 10,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores editable blocks and member progress independently", async () => {
    const block = {
      id: "block-strength",
      type: "strength" as const,
      title: "Back squat",
      instructions: "Build progressively",
      exercises: ["Back squat"],
      sets: "5",
      repetitions: "5",
      duration: "20 min",
      rest: "2 min",
      percentage: "75%",
      load: "",
      material: ["Rack", "Barbell"],
      adaptations: "Goblet squat",
      mediaUrls: ["https://example.com/squat"],
      notes: "Control technique",
    };
    const content = await sessions.saveSessionContent("content-class", {
      terminology: "Training plan",
      blocks: [block],
      commentsEnabled: true,
    });
    expect(content).toMatchObject({
      terminology: "Training plan",
      commentsEnabled: true,
      blocks: [block],
    });

    const progress = await sessions.saveSessionProgress(
      "content-class",
      "content-member",
      {
        completedBlockIds: ["block-strength", "unknown-block"],
        notes: "Felt stable",
      },
    );
    expect(progress.completedBlockIds).toEqual(["block-strength"]);
    expect(progress.notes).toBe("Felt stable");
    expect((await sessions.getSessionContent("content-class")).blocks).toEqual([
      block,
    ]);
  });

  it("rejects duplicate block identifiers before persisting ambiguous content", async () => {
    const duplicate = {
      id: "duplicate-block",
      type: "custom" as const,
      title: "Duplicate",
      instructions: "",
      exercises: [],
      sets: "",
      repetitions: "",
      duration: "",
      rest: "",
      percentage: "",
      load: "",
      material: [],
      adaptations: "",
      mediaUrls: [],
      notes: "",
    };
    await expect(
      sessions.saveSessionContent("content-class", {
        terminology: "Training plan",
        blocks: [duplicate, duplicate],
        commentsEnabled: false,
      }),
    ).rejects.toThrow("identifiers must be unique");
  });

  it("does not create phantom progress for a class that does not exist", async () => {
    await expect(
      sessions.getSessionProgress("missing-class", "content-member"),
    ).rejects.toThrow("Class not found");
  });
});

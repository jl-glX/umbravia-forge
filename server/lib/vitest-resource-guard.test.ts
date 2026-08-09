import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireVitestRunLock,
  cleanupDirectoriesCreatedAfterSnapshot,
  cleanupStaleVitestDirectories,
} from "../../scripts/testing/vitest-resource-guard.js";

describe("Vitest resource guard", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vitest-resource-guard-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("removes only recognized stale test directories", async () => {
    const stale = path.join(root, "umbravia-forge-auth-stale-example");
    const recent = path.join(root, "umbravia-forge-auth-recent-example");
    const unrelated = path.join(root, "another-project-stale-example");
    await Promise.all([mkdir(stale), mkdir(recent), mkdir(unrelated)]);
    const oldDate = new Date("2025-01-01T00:00:00.000Z");
    await Promise.all([
      utimes(stale, oldDate, oldDate),
      utimes(unrelated, oldDate, oldDate),
    ]);

    const report = await cleanupStaleVitestDirectories({
      root,
      minimumAgeMs: 60_000,
      now: new Date("2025-01-01T00:02:00.000Z").getTime(),
    });

    expect(report.failed).toEqual([]);
    expect(report.removed).toEqual([stale]);
    await expect(mkdir(stale)).resolves.toBeUndefined();
    await expect(mkdir(recent)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(mkdir(unrelated)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("removes recognized directories created after the baseline", async () => {
    const preserved = path.join(root, "umbravia-forge-auth-existing-example");
    const created = path.join(root, "umbravia-forge-auth-created-example");
    await mkdir(preserved);
    await mkdir(created);

    const report = await cleanupDirectoriesCreatedAfterSnapshot(
      new Set([path.basename(preserved)]),
      root,
    );

    expect(report.failed).toEqual([]);
    expect(report.removed).toEqual([created]);
    await expect(mkdir(preserved)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(mkdir(created)).resolves.toBeUndefined();
  });

  it("blocks a second active Vitest execution and releases its own lock", async () => {
    const release = await acquireVitestRunLock(root);
    await expect(acquireVitestRunLock(root)).rejects.toThrow(
      /ejecución de Vitest activa/,
    );
    await release();

    const secondRelease = await acquireVitestRunLock(root);
    await secondRelease();
  });

  it("recovers an invalid lock left by an interrupted execution", async () => {
    await writeFile(path.join(root, "umbravia-forge-vitest.lock"), "invalid");

    const release = await acquireVitestRunLock(root);
    await release();
  });
});

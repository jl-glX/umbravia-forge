import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vitest process supervisor", () => {
  it("uses a shell-independent owned child and bounded shutdown", async () => {
    const source = await readFile(
      path.resolve("scripts", "testing", "run-vitest.mjs"),
      "utf8",
    );

    expect(source).toContain("shell: false");
    expect(source).toContain("windowsHide: true");
    expect(source).toContain("detached: ownsProcessGroup");
    expect(source).toContain("process.kill(-child.pid, signal)");
    expect(source).toContain('signalOwnedVitest("SIGKILL")');
    expect(source).toContain("10_000");
    expect(source).not.toMatch(/taskkill|Stop-Process|pkill|killall/);
  });

  it("uses worker threads so Windows owns a single Vitest process", async () => {
    const source = await readFile(path.resolve("vitest.config.ts"), "utf8");

    expect(source).toContain('pool: "threads"');
    expect(source).toContain("maxWorkers: workerCount");
  });

  it("serializes managed runs and removes only Vite's disposable config cache", async () => {
    const source = await readFile(
      path.resolve("scripts", "testing", "run-vitest.mjs"),
      "utf8",
    );

    expect(source).toContain("umbravia-forge-vitest-supervisor-");
    expect(source).toContain('"node_modules",');
    expect(source).toContain('".vite-temp",');
    expect(source).toContain("maxRetries: 8");
    expect(source).toContain("await releaseSupervisorOnce()");
    expect(source).not.toMatch(/taskkill|Stop-Process|pkill|killall/);
  });
});

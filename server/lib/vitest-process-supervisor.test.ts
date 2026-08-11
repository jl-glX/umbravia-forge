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

  it("uses worker threads with an operating-system-neutral worker policy", async () => {
    const source = await readFile(path.resolve("vitest.config.ts"), "utf8");

    expect(source).toContain('pool: "threads"');
    expect(source).toContain("maxWorkers: workerCount");
    expect(source).toContain("process.env.CI ? 2 : 1");
    expect(source).not.toContain("process.platform");
    expect(source).not.toContain("win32");
  });

  it("reuses npm's JavaScript entry point without platform-specific executable extensions", async () => {
    const sourceFiles = await Promise.all(
      ["scripts/run-ci.mjs", "scripts/audit-ci.mjs"].map((file) =>
        readFile(path.resolve(file), "utf8"),
      ),
    );
    const invocationSource = await readFile(
      path.resolve("scripts", "lib", "npm-invocation.mjs"),
      "utf8",
    );

    expect(invocationSource).toContain("environment.npm_execpath");
    expect(invocationSource).toContain("command: process.execPath");
    for (const source of sourceFiles) {
      expect(source).toContain("resolveNpmInvocation");
      expect(source).not.toMatch(/npm\.cmd|process\.platform|win32/);
    }
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

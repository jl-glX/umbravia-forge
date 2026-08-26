import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  executeSupportDiagnosticProbeCommand,
  isDirectModuleInvocation,
  parseSupportDiagnosticProbeArguments,
} from "./check-support-diagnostic-probe.js";
import type { SupportDiagnosticProbeReport } from "../services/support-diagnostic-probe.js";

function report(healthy: boolean): SupportDiagnosticProbeReport {
  return {
    target: "https://cf-test.umbraviaforge.com",
    check: "all",
    checkedAt: "2026-08-26T20:00:00.000Z",
    healthy,
    dns: { ok: healthy, ipv4: ["46.225.103.156"], ipv6: [], errors: [] },
    tls: null,
    live: null,
    ready: null,
  };
}

describe("support diagnostic probe local command", () => {
  it("defaults to the complete fixed-target diagnostic", async () => {
    const runProbe = vi.fn(async () => report(true));
    const write = vi.fn();

    await expect(
      executeSupportDiagnosticProbeCommand([], { runProbe, write }),
    ).resolves.toBe(0);
    expect(runProbe).toHaveBeenCalledWith("all");
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("probe=healthy"),
    );
  });

  it("returns a failing process result when the requested check is degraded", async () => {
    const runProbe = vi.fn(async () => report(false));

    await expect(
      executeSupportDiagnosticProbeCommand(["dns"], {
        runProbe,
        write: vi.fn(),
      }),
    ).resolves.toBe(1);
    expect(runProbe).toHaveBeenCalledWith("dns");
  });

  it("rejects arbitrary targets and unsupported argument combinations", () => {
    expect(() =>
      parseSupportDiagnosticProbeArguments([
        "--origin",
        "https://internal.example",
      ]),
    ).toThrow("una sola comprobacion");
    expect(() =>
      parseSupportDiagnosticProbeArguments(["https://internal.example"]),
    ).toThrow("Comprobacion no reconocida");
  });

  it("recognizes execution through the current release symbolic link", () => {
    const releasePath = path.resolve(
      "release",
      "dist/server/bin/check-support-diagnostic-probe.js",
    );
    const currentPath = path.resolve(
      "current",
      "dist/server/bin/check-support-diagnostic-probe.js",
    );
    const resolveRealPath = vi.fn((candidate: string) =>
      candidate === currentPath ? releasePath : candidate,
    );

    expect(
      isDirectModuleInvocation(
        pathToFileURL(releasePath).href,
        currentPath,
        resolveRealPath,
      ),
    ).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeIsolatedManagerTerminalCommand,
  getManagerTerminalExecutionStatus,
  translateManagerTerminalCommand,
} from "./manager-terminal-executor.js";

describe("isolated manager terminal executor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled and separated from host resources by default", () => {
    expect(getManagerTerminalExecutionStatus()).toMatchObject({
      enabled: false,
      backend: "docker",
      network: "none",
      hostNetwork: false,
      hostFilesystemMounted: false,
      readOnlyRootFilesystem: true,
      plaintextWorkspacePersistent: false,
      activeWorkspaceStorage: "container-tmpfs",
      encryptedWorkspaceSnapshots: {
        enabled: true,
        primitive: "AES-256-GCM",
      },
    });
  });

  it("fails closed before invoking a runtime when execution is disabled", async () => {
    await expect(
      executeIsolatedManagerTerminalCommand({
        accessId: "disabled-access",
        workspaceKey: "disabled-workspace",
        command: "pwd",
      }),
    ).rejects.toMatchObject({
      code: "MANAGER_TERMINAL_EXECUTION_UNAVAILABLE",
      status: 503,
    });
  });

  it("accepts only the explicit network modes", () => {
    vi.stubEnv("MANAGER_TERMINAL_NETWORK_MODE", "host");
    expect(() => getManagerTerminalExecutionStatus()).toThrow(
      "must be none or bridge",
    );
  });

  it("translates familiar Windows aliases without depending on Windows", () => {
    expect(translateManagerTerminalCommand("dir src")).toBe("ls -la src");
    expect(translateManagerTerminalCommand("type README.md")).toBe(
      "cat README.md",
    );
    expect(translateManagerTerminalCommand("Get-ChildItem src")).toBe(
      "Get-ChildItem src",
    );
  });
});

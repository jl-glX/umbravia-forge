import { describe, expect, it } from "vitest";
import {
  getManagerCoordinationStatus,
  ManagerAccessPolicyError,
  ManagerCoordinationConflictError,
  publishManagerSignal,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";

describe("manager coordinator", () => {
  it("prevents two managers from using the same scope simultaneously", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withCoordinatedManagerOperation(
      "account",
      "account-deletion",
      ["account-records"],
      async () => firstCanFinish,
    );

    await expect(
      withCoordinatedManagerOperation(
        "resource",
        "residual-cleanup",
        ["account-records"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerCoordinationConflictError);

    releaseFirst();
    await first;
    expect(getManagerCoordinationStatus().activeOperations).toHaveLength(0);
  });

  it("shares signals between managers", () => {
    publishManagerSignal(
      "security",
      "warning",
      "TEST_SIGNAL",
      "A coordinated test signal",
    );

    expect(getManagerCoordinationStatus().recentSignals[0]).toMatchObject({
      source: "security",
      severity: "warning",
      code: "TEST_SIGNAL",
    });
  });

  it("normalizes operation scopes before detecting conflicts", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withCoordinatedManagerOperation(
      "account",
      " account-deletion ",
      [" account-records ", "account-records"],
      async () => firstCanFinish,
    );

    await expect(
      withCoordinatedManagerOperation(
        "encryption",
        "key-readiness",
        ["account-records"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerCoordinationConflictError);

    releaseFirst();
    await first;
  });

  it("rejects unnamed operations and empty scopes", async () => {
    await expect(
      withCoordinatedManagerOperation(
        "security",
        "   ",
        ["security-events"],
        async () => undefined,
      ),
    ).rejects.toThrow("requires a name");
    await expect(
      withCoordinatedManagerOperation(
        "security",
        "security-audit",
        ["", "   "],
        async () => undefined,
      ),
    ).rejects.toThrow("requires at least one scope");
  });

  it("enforces exclusive ownership of security and encryption file scopes", async () => {
    await expect(
      withCoordinatedManagerOperation(
        "account",
        "read-security-files",
        ["security-files"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerAccessPolicyError);
    await expect(
      withCoordinatedManagerOperation(
        "resource",
        "read-encryption-files",
        ["encryption-files"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerAccessPolicyError);

    await expect(
      withCoordinatedManagerOperation(
        "security",
        "security-file-audit",
        ["security-files"],
        async () => "security-ok",
      ),
    ).resolves.toBe("security-ok");
    await expect(
      withCoordinatedManagerOperation(
        "encryption",
        "encryption-file-audit",
        ["encryption-files"],
        async () => "encryption-ok",
      ),
    ).resolves.toBe("encryption-ok");
  });

  it("denies generic secret and raw file scopes to every manager", async () => {
    for (const manager of ["security", "encryption"] as const) {
      await expect(
        withCoordinatedManagerOperation(
          manager,
          "unsafe-file-operation",
          ["raw-key-material"],
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ManagerAccessPolicyError);
      await expect(
        withCoordinatedManagerOperation(
          manager,
          "literal-file-operation",
          ["file:/etc/umbravia-forge/secret"],
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ManagerAccessPolicyError);
    }
  });

  it("redacts common secret forms from shared manager signals", () => {
    publishManagerSignal(
      "security",
      "critical",
      "SECRET_REDACTION_TEST",
      "token=must-not-leak\npassword:also-hidden",
    );

    const signal = getManagerCoordinationStatus().recentSignals[0];
    expect(signal.message).toBe("[REDACTED] [REDACTED]");
    expect(signal.message).not.toContain("must-not-leak");
    expect(signal.message).not.toContain("also-hidden");
  });

  it("publishes the least-privilege policy without secret material", () => {
    expect(getManagerCoordinationStatus().accessPolicy).toEqual({
      defaultSensitiveFileAccess: "denied",
      rawSecretExposure: "denied",
      protectedScopes: {
        "security-files": "security",
        "encryption-files": "encryption",
      },
      keyChangesRequireExplicitOperatorAction: true,
    });
  });
});

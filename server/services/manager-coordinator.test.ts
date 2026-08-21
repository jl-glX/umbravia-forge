import { describe, expect, it } from "vitest";
import {
  getManagerCoordinationStatus,
  ManagerAccessPolicyError,
  ManagerControlChannelPolicyError,
  ManagerConnectionPolicyError,
  ManagerCoordinationConflictError,
  publishManagerSignal,
  requireManagerConnection,
  transferManagerConnectionPayload,
  withCoordinatedManagerOperation,
  withHighPriorityManagerDirective,
} from "./manager-coordinator.js";

describe("manager coordinator", () => {
  it("prevents two managers from using the same scope simultaneously", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withCoordinatedManagerOperation(
      "account",
      "commercial",
      "account-deletion",
      ["account-records"],
      async () => firstCanFinish,
    );

    await expect(
      withCoordinatedManagerOperation(
        "resource",
        "commercial",
        "residual-cleanup",
        ["account-records"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerCoordinationConflictError);

    releaseFirst();
    await first;
    expect(
      getManagerCoordinationStatus("commercial").activeOperations,
    ).toHaveLength(0);
  });

  it("shares signals between managers", () => {
    publishManagerSignal(
      "security",
      "commercial",
      "warning",
      "TEST_SIGNAL",
      "A coordinated test signal",
    );

    expect(
      getManagerCoordinationStatus("commercial").recentSignals[0],
    ).toMatchObject({
      source: "security",
      severity: "warning",
      code: "TEST_SIGNAL",
    });
  });

  it("administers an explicit compatibility registry between managers", () => {
    expect(
      requireManagerConnection("support", "email", "channel-readiness"),
    ).toMatchObject({
      consumer: "support",
      provider: "email",
      mode: "read-only",
      compatible: true,
      scopes: ["notification-delivery", "support-email-ingress"],
    });
    expect(getManagerCoordinationStatus("commercial").connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumer: "resource",
          provider: "email",
          capability: "scheduled-maintenance",
          compatible: true,
        }),
        expect.objectContaining({
          consumer: "security",
          provider: "encryption",
          capability: "security-hardening",
          mode: "read-only",
          scopes: ["encryption-readiness"],
          compatible: true,
        }),
      ]),
    );
  });

  it("allows only the registered read-only security hardening connection", () => {
    expect(
      requireManagerConnection("security", "encryption", "security-hardening"),
    ).toMatchObject({
      mode: "read-only",
      scopes: ["encryption-readiness"],
    });
    expect(() =>
      requireManagerConnection("encryption", "security", "security-hardening"),
    ).toThrow(ManagerConnectionPolicyError);
  });

  it("rejects unregistered or reversed manager connections", () => {
    expect(() =>
      requireManagerConnection("email", "account", "channel-readiness"),
    ).toThrow(ManagerConnectionPolicyError);
  });

  it("protects registered payloads and stored coordinator messages", () => {
    const original = { verification: true, recovery: false };
    const transferred = transferManagerConnectionPayload(
      "account",
      "email",
      "channel-readiness",
      original,
    );
    expect(transferred).toEqual({ verification: true, recovery: false });
    expect(transferred).not.toBe(original);

    const status = getManagerCoordinationStatus("commercial");
    expect(status.connectionProtection).toMatchObject({
      primitive: "AES-256-GCM",
      payloadsEncryptedInTransit: true,
      signalMessagesEncryptedAtRest: true,
      keyMaterialExposed: false,
    });
    expect(JSON.stringify(status)).not.toContain("messageEncrypted");
  });

  it("normalizes operation scopes before detecting conflicts", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withCoordinatedManagerOperation(
      "account",
      "commercial",
      " account-deletion ",
      [" account-records ", "account-records"],
      async () => firstCanFinish,
    );

    await expect(
      withCoordinatedManagerOperation(
        "encryption",
        "commercial",
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
        "commercial",
        "   ",
        ["security-events"],
        async () => undefined,
      ),
    ).rejects.toThrow("requires a name");
    await expect(
      withCoordinatedManagerOperation(
        "security",
        "commercial",
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
        "commercial",
        "read-security-files",
        ["security-files"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerAccessPolicyError);
    await expect(
      withCoordinatedManagerOperation(
        "resource",
        "commercial",
        "read-encryption-files",
        ["encryption-files"],
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerAccessPolicyError);

    await expect(
      withCoordinatedManagerOperation(
        "security",
        "commercial",
        "security-file-audit",
        ["security-files"],
        async () => "security-ok",
      ),
    ).resolves.toBe("security-ok");
    await expect(
      withCoordinatedManagerOperation(
        "encryption",
        "commercial",
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
          "commercial",
          "unsafe-file-operation",
          ["raw-key-material"],
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ManagerAccessPolicyError);
      await expect(
        withCoordinatedManagerOperation(
          manager,
          "commercial",
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
      "commercial",
      "critical",
      "SECRET_REDACTION_TEST",
      "token=must-not-leak\npassword:also-hidden",
    );

    const signal = getManagerCoordinationStatus("commercial").recentSignals[0];
    expect(signal.message).toBe("[REDACTED] [REDACTED]");
    expect(signal.message).not.toContain("must-not-leak");
    expect(signal.message).not.toContain("also-hidden");
  });

  it("partitions signal presentation and retention under symmetric saturation", () => {
    for (const platformScope of ["commercial", "support"] as const) {
      for (let index = 0; index < 55; index += 1) {
        publishManagerSignal(
          "notification",
          platformScope,
          "warning",
          `SCOPE_SATURATION_${platformScope.toUpperCase()}_${index}`,
          `${platformScope} diagnostic ${index}`,
        );
      }
    }

    const commercial = getManagerCoordinationStatus("commercial");
    const support = getManagerCoordinationStatus("support");
    expect(commercial.recentSignals).toHaveLength(20);
    expect(support.recentSignals).toHaveLength(20);
    expect(
      commercial.recentSignals.every(
        (signal) => signal.platformScope === "commercial",
      ),
    ).toBe(true);
    expect(
      support.recentSignals.every(
        (signal) => signal.platformScope === "support",
      ),
    ).toBe(true);
    expect(commercial.signalRetention).toEqual({
      limitPerScope: 50,
      retained: 50,
    });
    expect(support.signalRetention).toEqual({
      limitPerScope: 50,
      retained: 50,
    });
  });

  it("publishes the least-privilege policy without secret material", () => {
    expect(getManagerCoordinationStatus("commercial").accessPolicy).toEqual({
      defaultSensitiveFileAccess: "denied",
      rawSecretExposure: "denied",
      protectedScopes: {
        "security-files": "security",
        "encryption-files": "encryption",
      },
      keyChangesRequireExplicitOperatorAction: true,
    });
  });

  it("publishes the traffic administrator contract without domain authority", () => {
    expect(
      getManagerCoordinationStatus("commercial").managerCore.administrator,
    ).toEqual({
      role: "traffic-priority-conflict-administrator",
      executesDomainWork: false,
      changesManagerConfiguration: false,
      mutatesSecrets: false,
    });
  });

  it("protects and acknowledges high-priority coordinator directives", async () => {
    const response = await withHighPriorityManagerDirective(
      "resource",
      "commercial",
      "order",
      "run-priority-maintenance",
      ["resource-maintenance"],
      "critical",
      async () => "completed-by-resource-manager",
    );

    expect(response.result).toBe("completed-by-resource-manager");
    expect(response.receipt).toMatchObject({
      requestDirection: "manager-coordinator-to-core",
      acknowledgementDirection: "manager-core-to-coordinator",
      kind: "order",
      priority: "critical",
      status: "completed",
    });
    expect(response.receipt.directiveId).toMatch(/^manager-directive-/);
    expect(
      getManagerCoordinationStatus("commercial").managerCore
        .highPriorityChannel,
    ).toEqual(
      expect.objectContaining({
        allowedPriorities: ["critical", "high"],
        trafficClass: "control",
        requestEncryptedInTransit: true,
        acknowledgementEncryptedInTransit: true,
        bypassesConflictChecks: false,
        bypassesCapacityLimits: false,
        carriesSecretMaterial: false,
      }),
    );
  });

  it("rejects unsafe metadata on the high-priority channel", async () => {
    await expect(
      withHighPriorityManagerDirective(
        "security",
        "commercial",
        "instruction",
        "token=must-not-travel",
        ["security-events"],
        "high",
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerControlChannelPolicyError);
    await expect(
      withHighPriorityManagerDirective(
        "security",
        "commercial",
        "instruction",
        "review-security-events",
        ["file:/etc/private"],
        "high",
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerControlChannelPolicyError);
  });
});

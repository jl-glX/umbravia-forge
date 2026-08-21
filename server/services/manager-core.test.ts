import { describe, expect, it, vi } from "vitest";
import {
  ManagerAdministrator,
  ManagerControlChannelPolicyError,
  ManagerCoordinationConflictError,
  ManagerQueueCapacityError,
} from "./manager-core.js";

describe("manager core administrator", () => {
  it("preserves immediate conflict detection for interactive operations", async () => {
    const administrator = new ManagerAdministrator();
    let release!: () => void;
    const held = administrator.runImmediate(
      "email",
      "commercial",
      "delivery",
      ["notification-delivery"],
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    expect(() =>
      administrator.runImmediate(
        "resource",
        "commercial",
        "maintenance",
        ["notification-delivery"],
        async () => undefined,
      ),
    ).toThrow(ManagerCoordinationConflictError);

    release();
    await held;
  });

  it("queues conflicting work and executes it after the active scope is free", async () => {
    const administrator = new ManagerAdministrator();
    const order: string[] = [];
    let release!: () => void;
    const held = administrator.runImmediate(
      "email",
      "commercial",
      "delivery",
      ["notification-delivery"],
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push("active");
            resolve();
          };
        }),
    );
    const queued = administrator.enqueue(
      "resource",
      "commercial",
      "maintenance",
      ["notification-delivery"],
      async () => order.push("queued"),
      "high",
      "maintenance",
    );

    expect(administrator.getStatus().queuedOperations).toHaveLength(1);
    release();
    await Promise.all([held, queued]);
    expect(order).toEqual(["active", "queued"]);
  });

  it("limits queue growth independently for every manager", async () => {
    const administrator = new ManagerAdministrator({
      globalConcurrency: 1,
      perManagerQueueCapacity: 1,
      maxQueueWaitMs: 1_000,
    });
    let release!: () => void;
    const held = administrator.runImmediate(
      "email",
      "commercial",
      "delivery",
      ["delivery"],
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const queued = administrator.enqueue(
      "email",
      "commercial",
      "maintenance",
      ["maintenance"],
      async () => undefined,
    );
    expect(() =>
      administrator.enqueue(
        "email",
        "commercial",
        "extra",
        ["extra"],
        async () => undefined,
      ),
    ).toThrow(ManagerQueueCapacityError);
    release();
    await Promise.all([held, queued]);
  });

  it("deduplicates noncritical traffic but never drops critical signals", () => {
    const now = vi.fn(() => 1_000);
    const administrator = new ManagerAdministrator({ now });

    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "warning",
        "QUEUE_DELAY",
        "a",
      ),
    ).toBe(true);
    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "warning",
        "QUEUE_DELAY",
        "a",
      ),
    ).toBe(false);
    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "critical",
        "QUEUE_DOWN",
        "b",
      ),
    ).toBe(true);
    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "critical",
        "QUEUE_DOWN",
        "b",
      ),
    ).toBe(true);
  });

  it("rate-limits informational signals independently by platform scope", () => {
    const administrator = new ManagerAdministrator({
      now: () => 1_000,
      lowPrioritySignalsPerMinute: 1,
    });
    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "info",
        "COMMERCIAL_INFO",
        "commercial-a",
      ),
    ).toBe(true);
    expect(
      administrator.admitSignal(
        "email",
        "support",
        "info",
        "SUPPORT_INFO",
        "support-a",
      ),
    ).toBe(true);
    expect(
      administrator.admitSignal(
        "email",
        "commercial",
        "info",
        "COMMERCIAL_INFO_2",
        "commercial-b",
      ),
    ).toBe(false);
    expect(
      administrator.admitSignal(
        "email",
        "support",
        "info",
        "SUPPORT_INFO_2",
        "support-b",
      ),
    ).toBe(false);
  });

  it("runs coordinator control directives ahead of ordinary queued work", async () => {
    const administrator = new ManagerAdministrator({ globalConcurrency: 1 });
    const order: string[] = [];
    let release!: () => void;
    const held = administrator.runImmediate(
      "email",
      "commercial",
      "delivery",
      ["delivery"],
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const ordinary = administrator.enqueue(
      "resource",
      "commercial",
      "cleanup",
      ["cleanup"],
      async () => order.push("ordinary"),
      "normal",
      "maintenance",
    );
    const control = administrator.enqueueControlDirective(
      "manager-coordinator",
      "security",
      "commercial",
      "instruction",
      "prioritize-security-review",
      ["security-events"],
      "high",
      async () => order.push("control"),
    );

    release();
    await Promise.all([held, ordinary, control]);
    expect(order).toEqual(["control", "ordinary"]);
  });

  it("keeps scope conflicts active on the high-priority channel", async () => {
    const administrator = new ManagerAdministrator();
    let release!: () => void;
    let directiveRan = false;
    const held = administrator.runImmediate(
      "email",
      "commercial",
      "delivery",
      ["shared-control-scope"],
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const directive = administrator.enqueueControlDirective(
      "manager-coordinator",
      "resource",
      "commercial",
      "order",
      "coordinate-recovery",
      ["shared-control-scope"],
      "critical",
      async () => {
        directiveRan = true;
      },
    );

    expect(directiveRan).toBe(false);
    expect(administrator.getStatus().queuedOperations).toHaveLength(1);
    release();
    await Promise.all([held, directive]);
    expect(directiveRan).toBe(true);
  });

  it("rejects downgraded or untrusted control-channel traffic", async () => {
    const administrator = new ManagerAdministrator();
    await expect(
      administrator.enqueueControlDirective(
        "manager-coordinator",
        "resource",
        "commercial",
        "order",
        "ordinary-maintenance",
        ["maintenance"],
        "normal" as "high",
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerControlChannelPolicyError);
    await expect(
      administrator.enqueueControlDirective(
        "untrusted-endpoint" as "manager-coordinator",
        "resource",
        "commercial",
        "order",
        "urgent-maintenance",
        ["maintenance"],
        "high",
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(ManagerControlChannelPolicyError);
  });

  it("exposes policy and counters without task bodies or secret material", () => {
    const serialized = JSON.stringify(new ManagerAdministrator().getStatus());
    expect(serialized).toContain("traffic-priority-conflict-administrator");
    expect(serialized).toContain('"mutatesSecrets":false');
    expect(serialized).toContain(
      '"requestDirection":"manager-coordinator-to-core"',
    );
    expect(serialized).toContain('"bypassesConflictChecks":false');
    expect(serialized).toContain('"requestEncryptedInTransit":true');
    expect(serialized).not.toContain("fingerprint");
    expect(serialized).not.toContain("payload");
  });
});

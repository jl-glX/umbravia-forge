import { randomBytes } from "node:crypto";

export type ManagerId =
  | "account"
  | "security"
  | "resource"
  | "encryption"
  | "environment"
  | "email"
  | "notification"
  | "support";

export type ManagerTaskPriority = "critical" | "high" | "normal" | "low";
export type ManagerTrafficClass =
  "control" | "interactive" | "transactional" | "maintenance" | "observation";

export interface ActiveManagerOperation {
  id: string;
  manager: ManagerId;
  operation: string;
  scopes: string[];
  priority: ManagerTaskPriority;
  trafficClass: ManagerTrafficClass;
  startedAt: number;
}

interface QueuedManagerOperation<T = unknown> {
  id: string;
  manager: ManagerId;
  operation: string;
  scopes: string[];
  priority: ManagerTaskPriority;
  trafficClass: ManagerTrafficClass;
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class ManagerCoordinationConflictError extends Error {
  readonly status = 409;
  readonly statusCode = 409;

  constructor(public readonly conflictingOperation: ActiveManagerOperation) {
    super("A coordinated manager operation is already using this scope");
    this.name = "ManagerCoordinationConflictError";
  }
}

export class ManagerQueueCapacityError extends Error {
  readonly status = 503;
  readonly statusCode = 503;

  constructor(public readonly manager: ManagerId) {
    super("The manager operation queue has reached its safe capacity");
    this.name = "ManagerQueueCapacityError";
  }
}

export class ManagerQueueTimeoutError extends Error {
  readonly status = 503;
  readonly statusCode = 503;

  constructor(public readonly manager: ManagerId) {
    super("The manager operation expired before safe execution");
    this.name = "ManagerQueueTimeoutError";
  }
}

interface ManagerAdministratorOptions {
  globalConcurrency?: number;
  perManagerConcurrency?: number;
  globalQueueCapacity?: number;
  perManagerQueueCapacity?: number;
  maxQueueWaitMs?: number;
  priorityAgingMs?: number;
  signalDeduplicationMs?: number;
  lowPrioritySignalsPerMinute?: number;
  now?: () => number;
}

const PRIORITY_WEIGHT: Readonly<Record<ManagerTaskPriority, number>> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export class ManagerAdministrator {
  private readonly active = new Map<string, ActiveManagerOperation>();
  private readonly queue: QueuedManagerOperation[] = [];
  private readonly recentSignals = new Map<string, number>();
  private readonly lowPrioritySignalTimes: number[] = [];
  private readonly globalConcurrency: number;
  private readonly perManagerConcurrency: number;
  private readonly globalQueueCapacity: number;
  private readonly perManagerQueueCapacity: number;
  private readonly maxQueueWaitMs: number;
  private readonly priorityAgingMs: number;
  private readonly signalDeduplicationMs: number;
  private readonly lowPrioritySignalsPerMinute: number;
  private readonly now: () => number;
  private counters = {
    admittedOperations: 0,
    queuedOperations: 0,
    conflictRejections: 0,
    queueCapacityRejections: 0,
    queueTimeouts: 0,
    deduplicatedSignals: 0,
    rateLimitedSignals: 0,
  };

  constructor(options: ManagerAdministratorOptions = {}) {
    this.globalConcurrency = options.globalConcurrency ?? 8;
    this.perManagerConcurrency = options.perManagerConcurrency ?? 2;
    this.globalQueueCapacity = options.globalQueueCapacity ?? 100;
    this.perManagerQueueCapacity = options.perManagerQueueCapacity ?? 25;
    this.maxQueueWaitMs = options.maxQueueWaitMs ?? 30_000;
    this.priorityAgingMs = options.priorityAgingMs ?? 15_000;
    this.signalDeduplicationMs = options.signalDeduplicationMs ?? 5_000;
    this.lowPrioritySignalsPerMinute =
      options.lowPrioritySignalsPerMinute ?? 60;
    this.now = options.now ?? Date.now;
  }

  private normalizeOperation(
    manager: ManagerId,
    operation: string,
    scopes: string[],
    priority: ManagerTaskPriority,
    trafficClass: ManagerTrafficClass,
  ) {
    const normalizedOperation = operation.trim();
    const normalizedScopes = [
      ...new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
    ];
    if (!normalizedOperation)
      throw new Error("A coordinated manager operation requires a name");
    if (normalizedScopes.length === 0) {
      throw new Error(
        "A coordinated manager operation requires at least one scope",
      );
    }
    return {
      id: `manager-operation-${randomBytes(8).toString("hex")}`,
      manager,
      operation: normalizedOperation,
      scopes: normalizedScopes,
      priority,
      trafficClass,
    };
  }

  private findConflict(scopes: string[]) {
    return [...this.active.values()].find((active) =>
      active.scopes.some((scope) => scopes.includes(scope)),
    );
  }

  private managerActiveCount(manager: ManagerId) {
    return [...this.active.values()].filter(
      (operation) => operation.manager === manager,
    ).length;
  }

  private canStart(manager: ManagerId, scopes: string[]) {
    return (
      this.active.size < this.globalConcurrency &&
      this.managerActiveCount(manager) < this.perManagerConcurrency &&
      !this.findConflict(scopes)
    );
  }

  private async execute<T>(
    operation: Omit<ActiveManagerOperation, "startedAt">,
    run: () => Promise<T>,
  ): Promise<T> {
    const active = { ...operation, startedAt: this.now() };
    this.active.set(active.id, active);
    this.counters.admittedOperations += 1;
    try {
      return await run();
    } finally {
      this.active.delete(active.id);
      this.drainQueue();
    }
  }

  runImmediate<T>(
    manager: ManagerId,
    operation: string,
    scopes: string[],
    run: () => Promise<T>,
    priority: ManagerTaskPriority = "normal",
    trafficClass: ManagerTrafficClass = "interactive",
  ): Promise<T> {
    const normalized = this.normalizeOperation(
      manager,
      operation,
      scopes,
      priority,
      trafficClass,
    );
    const conflict = this.findConflict(normalized.scopes);
    if (conflict) {
      this.counters.conflictRejections += 1;
      throw new ManagerCoordinationConflictError(conflict);
    }
    if (!this.canStart(manager, normalized.scopes)) {
      this.counters.queueCapacityRejections += 1;
      throw new ManagerQueueCapacityError(manager);
    }
    return this.execute(normalized, run);
  }

  enqueue<T>(
    manager: ManagerId,
    operation: string,
    scopes: string[],
    run: () => Promise<T>,
    priority: ManagerTaskPriority = "normal",
    trafficClass: ManagerTrafficClass = "maintenance",
  ): Promise<T> {
    const normalized = this.normalizeOperation(
      manager,
      operation,
      scopes,
      priority,
      trafficClass,
    );
    if (this.canStart(manager, normalized.scopes)) {
      return this.execute(normalized, run);
    }
    const managerQueued = this.queue.filter(
      (item) => item.manager === manager,
    ).length;
    if (
      this.queue.length >= this.globalQueueCapacity ||
      managerQueued >= this.perManagerQueueCapacity
    ) {
      this.counters.queueCapacityRejections += 1;
      throw new ManagerQueueCapacityError(manager);
    }
    this.counters.queuedOperations += 1;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex((item) => item.id === normalized.id);
        if (index >= 0) this.queue.splice(index, 1);
        this.counters.queueTimeouts += 1;
        reject(new ManagerQueueTimeoutError(manager));
      }, this.maxQueueWaitMs);
      this.queue.push({
        ...normalized,
        enqueuedAt: this.now(),
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    const now = this.now();
    const ordered = [...this.queue].sort((left, right) => {
      const leftAging = Math.floor(
        (now - left.enqueuedAt) / this.priorityAgingMs,
      );
      const rightAging = Math.floor(
        (now - right.enqueuedAt) / this.priorityAgingMs,
      );
      const weight =
        PRIORITY_WEIGHT[right.priority] +
        rightAging -
        (PRIORITY_WEIGHT[left.priority] + leftAging);
      return weight || left.enqueuedAt - right.enqueuedAt;
    });
    for (const candidate of ordered) {
      if (!this.canStart(candidate.manager, candidate.scopes)) continue;
      const index = this.queue.findIndex((item) => item.id === candidate.id);
      if (index < 0) continue;
      this.queue.splice(index, 1);
      clearTimeout(candidate.timeout);
      void this.execute(candidate, candidate.run).then(
        candidate.resolve,
        candidate.reject,
      );
    }
  }

  admitSignal(
    source: ManagerId,
    severity: "info" | "warning" | "critical",
    code: string,
    fingerprint: string,
  ): boolean {
    const now = this.now();
    const key = `${source}:${severity}:${code}:${fingerprint}`;
    const previous = this.recentSignals.get(key);
    if (
      severity !== "critical" &&
      previous !== undefined &&
      now - previous < this.signalDeduplicationMs
    ) {
      this.counters.deduplicatedSignals += 1;
      return false;
    }
    this.recentSignals.set(key, now);
    if (severity === "info") {
      const cutoff = now - 60_000;
      while (
        this.lowPrioritySignalTimes.length > 0 &&
        this.lowPrioritySignalTimes[0] < cutoff
      ) {
        this.lowPrioritySignalTimes.shift();
      }
      if (
        this.lowPrioritySignalTimes.length >= this.lowPrioritySignalsPerMinute
      ) {
        this.counters.rateLimitedSignals += 1;
        return false;
      }
      this.lowPrioritySignalTimes.push(now);
    }
    this.recentSignals.set(key, now);
    for (const [candidate, createdAt] of this.recentSignals) {
      if (createdAt < now - this.signalDeduplicationMs) {
        this.recentSignals.delete(candidate);
      }
    }
    return true;
  }

  getStatus() {
    return {
      administrator: {
        role: "traffic-priority-conflict-administrator" as const,
        executesDomainWork: false as const,
        changesManagerConfiguration: false as const,
        mutatesSecrets: false as const,
      },
      policy: {
        globalConcurrency: this.globalConcurrency,
        perManagerConcurrency: this.perManagerConcurrency,
        globalQueueCapacity: this.globalQueueCapacity,
        perManagerQueueCapacity: this.perManagerQueueCapacity,
        maxQueueWaitMs: this.maxQueueWaitMs,
        priorityAgingMs: this.priorityAgingMs,
        conflictModel: "exclusive-scope" as const,
        criticalSignalsAreNeverRateLimited: true as const,
      },
      activeOperations: [...this.active.values()].map((item) => ({
        ...item,
        scopes: [...item.scopes],
      })),
      queuedOperations: this.queue.map((item) => ({
        id: item.id,
        manager: item.manager,
        operation: item.operation,
        scopes: [...item.scopes],
        priority: item.priority,
        trafficClass: item.trafficClass,
        enqueuedAt: item.enqueuedAt,
      })),
      counters: { ...this.counters },
    };
  }
}

export const managerAdministrator = new ManagerAdministrator();

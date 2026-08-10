import { performance } from "node:perf_hooks";
import { sql } from "kysely";
import {
  databaseProvider,
  db,
  reconcileBookingIntegrity,
} from "../db/client.js";
import { cleanupStaleRuntimeRecords } from "../lib/runtime-registry.js";
import { auditSourceHygiene } from "./source-hygiene.js";
import { runEnvironmentReadinessAudit } from "./environment-manager.js";
import { maintainEmailDeliveryQueue } from "./email-delivery.js";
import { auditSupportSla } from "./support.js";
import { purgeExpiredOpaqueE2eeAttachments } from "./e2ee-attachments.js";
import {
  getManagerCoordinationStatus,
  ManagerCoordinationConflictError,
  publishManagerSignal,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";

type TaskPriority = "critical" | "normal" | "low";
type TaskState = "idle" | "running" | "paused" | "error";

interface ManagedTaskDefinition {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  priority: TaskPriority;
  enabledByDefault: boolean;
  run: () => Promise<ManagedTaskResult | number | void>;
}

interface ManagedTaskResult {
  count: number;
  summary: string;
  findings?: string[];
}

interface ManagedTaskRuntime {
  definition: ManagedTaskDefinition;
  enabled: boolean;
  state: TaskState;
  timer: NodeJS.Timeout | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastDurationMs: number | null;
  lastResultCount: number | null;
  lastSummary: string | null;
  lastFindings: string[];
  runCount: number;
  errorCount: number;
  lastError: string | null;
  currentRun: Promise<void> | null;
}

type RuntimeCheckPhase =
  "manager-start" | "task-start" | "task-finish" | "manager-stop";

interface RuntimeCheckStatus {
  phase: RuntimeCheckPhase;
  taskId: string | null;
  checkedAt: number;
  staleRecordsRemoved: number;
}

export interface ManagedTaskStatus {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  priority: TaskPriority;
  enabled: boolean;
  state: TaskState;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastDurationMs: number | null;
  lastResultCount: number | null;
  lastSummary: string | null;
  lastFindings: string[];
  runCount: number;
  errorCount: number;
  lastError: string | null;
}

const tasks = new Map<string, ManagedTaskRuntime>();
let started = false;
let startInProgress: Promise<void> | null = null;
let runtimeCheckCount = 0;
let staleRuntimeRecordsRemoved = 0;
let lastRuntimeCheck: RuntimeCheckStatus | null = null;

const taskCoordinationScopes: Record<string, string[]> = {
  "expired-auth-cleanup": ["authentication-records"],
  "expired-e2ee-attachment-cleanup": ["e2ee-attachment-records"],
  "deleted-account-residual-cleanup": ["account-records"],
  "booking-integrity-cleanup": ["booking-records"],
  "project-runtime-cleanup": ["runtime-records"],
  "source-hygiene-audit": ["source-tree"],
  "sqlite-query-planner": ["database-maintenance"],
  "environment-readiness-audit": ["database-maintenance"],
  "email-delivery-maintenance": ["notification-delivery"],
  "support-sla-audit": ["support-records", "notification-delivery"],
};

function runtimeCheckIntervalMs(): number {
  const configured = Number.parseInt(
    process.env.RESOURCE_RUNTIME_CHECK_INTERVAL_MS ?? "300000",
    10,
  );
  if (!Number.isFinite(configured)) return 300_000;
  return Math.min(Math.max(configured, 30_000), 3_600_000);
}

async function checkResidualBackgroundProcesses(
  phase: RuntimeCheckPhase,
  taskId: string | null = null,
): Promise<RuntimeCheckStatus> {
  const removed = await cleanupStaleRuntimeRecords();
  const result = {
    phase,
    taskId,
    checkedAt: Date.now(),
    staleRecordsRemoved: removed,
  } satisfies RuntimeCheckStatus;

  runtimeCheckCount += 1;
  staleRuntimeRecordsRemoved += removed;
  lastRuntimeCheck = result;
  return result;
}

function serializeTask(task: ManagedTaskRuntime): ManagedTaskStatus {
  return {
    id: task.definition.id,
    name: task.definition.name,
    description: task.definition.description,
    intervalMs: task.definition.intervalMs,
    priority: task.definition.priority,
    enabled: task.enabled,
    state: task.state,
    lastRunAt: task.lastRunAt,
    nextRunAt: task.nextRunAt,
    lastDurationMs: task.lastDurationMs,
    lastResultCount: task.lastResultCount,
    lastSummary: task.lastSummary,
    lastFindings: task.lastFindings,
    runCount: task.runCount,
    errorCount: task.errorCount,
    lastError: task.lastError,
  };
}

function schedule(task: ManagedTaskRuntime): void {
  if (!started || !task.enabled || task.state === "running") return;

  if (task.timer) clearTimeout(task.timer);
  task.nextRunAt = Date.now() + task.definition.intervalMs;
  task.timer = setTimeout(() => {
    task.timer = null;
    void runManagedTask(task.definition.id).catch((error: unknown) => {
      console.error(
        `Managed task ${task.definition.id} failed:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    });
  }, task.definition.intervalMs);
  task.timer.unref();
}

function registerTask(definition: ManagedTaskDefinition): void {
  if (tasks.has(definition.id)) {
    throw new Error(`Managed task already registered: ${definition.id}`);
  }
  tasks.set(definition.id, {
    definition,
    enabled: definition.enabledByDefault,
    state: definition.enabledByDefault ? "idle" : "paused",
    timer: null,
    lastRunAt: null,
    nextRunAt: null,
    lastDurationMs: null,
    lastResultCount: null,
    lastSummary: null,
    lastFindings: [],
    runCount: 0,
    errorCount: 0,
    lastError: null,
    currentRun: null,
  });
}

async function cleanupExpiredAuthenticationData(): Promise<number> {
  const now = Date.now();
  const revokedSessionRetention = now - 7 * 24 * 60 * 60 * 1000;

  const results = await Promise.all([
    db
      .deleteFrom("sessions")
      .where((expression) =>
        expression.or([
          expression("expiresAt", "<", now),
          expression("revokedAt", "<", revokedSessionRetention),
        ]),
      )
      .executeTakeFirst(),
    db
      .deleteFrom("authChallenges")
      .where("expiresAt", "<", now)
      .executeTakeFirst(),
    db
      .deleteFrom("webauthnChallenges")
      .where("expiresAt", "<", now)
      .executeTakeFirst(),
    db
      .deleteFrom("emailVerificationChallenges")
      .where("expiresAt", "<", now)
      .executeTakeFirst(),
    db
      .deleteFrom("accountRecoveryChallenges")
      .where("expiresAt", "<", now)
      .executeTakeFirst(),
    db
      .deleteFrom("antiAutomationChallenges")
      .where("expiresAt", "<", now)
      .executeTakeFirst(),
  ]);

  return results.reduce(
    (total, result) => total + Number(result.numDeletedRows),
    0,
  );
}

async function optimizeSqlitePlanner(): Promise<void> {
  await sql`PRAGMA optimize`.execute(db);
}

registerTask({
  id: "expired-auth-cleanup",
  name: "Expired authentication cleanup",
  description:
    "Removes expired login sessions and completed authentication challenges.",
  intervalMs: 30 * 60 * 1000,
  priority: "normal",
  enabledByDefault: true,
  run: cleanupExpiredAuthenticationData,
});

registerTask({
  id: "expired-e2ee-attachment-cleanup",
  name: "Expired E2EE attachment cleanup",
  description:
    "Removes expired opaque E2EE attachment payloads and metadata without decrypting their contents.",
  intervalMs: 30 * 60 * 1000,
  priority: "normal",
  enabledByDefault: true,
  run: async () => {
    const count = await purgeExpiredOpaqueE2eeAttachments();
    return {
      count,
      summary: `${count} expired opaque E2EE attachment(s) removed.`,
    };
  },
});

registerTask({
  id: "email-delivery-maintenance",
  name: "Transactional email delivery",
  description:
    "Retries queued transactional messages, recovers stale claims and purges terminal delivery records after 30 days.",
  intervalMs: 60 * 1000,
  priority: "critical",
  enabledByDefault: true,
  run: maintainEmailDeliveryQueue,
});

registerTask({
  id: "support-sla-audit",
  name: "Forge Support SLA audit",
  description:
    "Detects support tickets that have exceeded their first-response or resolution target without changing their state automatically.",
  intervalMs: 15 * 60 * 1000,
  priority: "normal",
  enabledByDefault: true,
  run: auditSupportSla,
});

registerTask({
  id: "deleted-account-residual-cleanup",
  name: "Deleted account residual cleanup",
  description:
    "Removes technical records whose account no longer exists; it does not decide when an account should be closed.",
  intervalMs: 6 * 60 * 60 * 1000,
  priority: "normal",
  enabledByDefault: true,
  run: async () => {
    const tables = [
      "sessions",
      "authChallenges",
      "webauthnChallenges",
      "emailVerificationChallenges",
      "accountRecoveryChallenges",
    ] as const;
    let count = 0;
    for (const table of tables) {
      const result = await sql`
        DELETE FROM ${sql.table(table)}
        WHERE ${sql.ref(`${table}.userId`)} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ${sql.table("users")}
            WHERE ${sql.ref("users.id")} = ${sql.ref(`${table}.userId`)}
          )
      `.execute(db);
      count += Number(result.numAffectedRows ?? 0);
    }
    return {
      count,
      summary: `${count} orphaned deleted-account record(s) removed.`,
    };
  },
});

registerTask({
  id: "booking-integrity-cleanup",
  name: "Booking integrity cleanup",
  description:
    "Reconciles unambiguous duplicate active bookings and stale waitlist entries.",
  intervalMs: 60 * 60 * 1000,
  priority: "critical",
  enabledByDefault: true,
  run: async () => {
    const result = await reconcileBookingIntegrity();
    const count = result.duplicateBookings + result.staleWaitlistEntries;
    return {
      count,
      summary: `${result.duplicateBookings} duplicate booking(s) and ${result.staleWaitlistEntries} stale waitlist entrie(s) reconciled.`,
    };
  },
});

registerTask({
  id: "project-runtime-cleanup",
  name: "Project runtime cleanup",
  description:
    "Removes stale Umbravia Forge runtime records without touching unrelated operating-system processes.",
  intervalMs: runtimeCheckIntervalMs(),
  priority: "normal",
  enabledByDefault: true,
  run: async () => {
    const count = await cleanupStaleRuntimeRecords();
    return {
      count,
      summary: `${count} stale project runtime record(s) removed.`,
    };
  },
});

registerTask({
  id: "source-hygiene-audit",
  name: "Source hygiene audit",
  description:
    "Reports exact duplicate files, empty source files and obsolete-looking artifacts without deleting source code.",
  intervalMs: 24 * 60 * 60 * 1000,
  priority: "low",
  enabledByDefault: false,
  run: async () => {
    const audit = await auditSourceHygiene();
    return {
      count: audit.findings.length,
      summary: `${audit.inspectedFiles} source file(s) inspected; ${audit.findings.length} finding(s).`,
      findings: audit.findings,
    };
  },
});

registerTask({
  id: "environment-readiness-audit",
  name: "Managed environment readiness audit",
  description:
    "Checks isolated SQLite environments and their readiness for a reviewed PostgreSQL promotion.",
  intervalMs: 6 * 60 * 60 * 1000,
  priority: "normal",
  enabledByDefault: true,
  run: runEnvironmentReadinessAudit,
});

if (databaseProvider === "sqlite") {
  registerTask({
    id: "sqlite-query-planner",
    name: "SQLite query planner optimization",
    description:
      "Lets SQLite refresh lightweight planner statistics when the database needs it.",
    intervalMs: 6 * 60 * 60 * 1000,
    priority: "low",
    enabledByDefault: true,
    run: optimizeSqlitePlanner,
  });
}

export async function startResourceManager(): Promise<void> {
  if (started) return;
  if (startInProgress) return startInProgress;
  started = true;
  const start = checkResidualBackgroundProcesses("manager-start")
    .then(() => {
      if (!started) return;
      for (const task of tasks.values()) schedule(task);
    })
    .catch((error: unknown) => {
      started = false;
      throw error;
    })
    .finally(() => {
      if (startInProgress === start) startInProgress = null;
    });
  startInProgress = start;
  await start;
}

export async function stopResourceManager(): Promise<void> {
  started = false;
  if (startInProgress) await startInProgress.catch(() => undefined);
  for (const task of tasks.values()) {
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    task.nextRunAt = null;
    if (task.state !== "running") {
      task.state = task.enabled ? "idle" : "paused";
    }
  }

  await Promise.allSettled(
    [...tasks.values()]
      .map((task) => task.currentRun)
      .filter((run): run is Promise<void> => run !== null),
  );
  await checkResidualBackgroundProcesses("manager-stop");
}

export async function runManagedTask(
  taskId: string,
): Promise<ManagedTaskStatus> {
  const task = tasks.get(taskId);
  if (!task) throw new Error("Managed task not found");
  if (task.state === "running")
    throw new Error("Managed task is already running");

  if (task.timer) clearTimeout(task.timer);
  task.timer = null;
  task.nextRunAt = null;
  task.state = "running";
  task.lastError = null;
  task.lastResultCount = null;
  task.lastSummary = null;
  task.lastFindings = [];
  const startedAt = performance.now();

  const execution = (async () => {
    try {
      await checkResidualBackgroundProcesses("task-start", taskId);
      const result = await withCoordinatedManagerOperation(
        "resource",
        taskId,
        taskCoordinationScopes[taskId] ?? [`resource-task:${taskId}`],
        task.definition.run,
      );
      task.lastResultCount =
        typeof result === "number"
          ? result
          : result && typeof result === "object"
            ? result.count
            : null;
      task.lastSummary =
        result && typeof result === "object" ? result.summary : null;
      task.lastFindings =
        result && typeof result === "object" ? (result.findings ?? []) : [];
      task.lastError = null;
      task.state = task.enabled ? "idle" : "paused";
      task.runCount += 1;
    } catch (error) {
      if (error instanceof ManagerCoordinationConflictError) {
        task.lastSummary = `Deferred because ${error.conflictingOperation.manager} is running ${error.conflictingOperation.operation}.`;
        task.state = task.enabled ? "idle" : "paused";
        publishManagerSignal(
          "resource",
          "info",
          "RESOURCE_TASK_DEFERRED",
          `${taskId} deferred for coordinated access.`,
        );
        throw error;
      }
      task.errorCount += 1;
      task.lastError =
        error instanceof Error ? error.message : "Unknown task error";
      task.state = "error";
      publishManagerSignal(
        "resource",
        "warning",
        "RESOURCE_TASK_FAILED",
        `${taskId}: ${task.lastError}`,
      );
      throw error;
    } finally {
      try {
        await checkResidualBackgroundProcesses("task-finish", taskId);
      } catch (error) {
        task.errorCount += 1;
        const residualError = `Residual check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        task.lastError = task.lastError
          ? `${task.lastError}; ${residualError}`
          : residualError;
        task.state = "error";
      }
      task.lastRunAt = Date.now();
      task.lastDurationMs = Math.round(performance.now() - startedAt);
      schedule(task);
    }
  })();

  task.currentRun = execution;
  try {
    await execution;
  } finally {
    if (task.currentRun === execution) task.currentRun = null;
  }

  return serializeTask(task);
}

export function setManagedTaskEnabled(
  taskId: string,
  enabled: boolean,
): ManagedTaskStatus {
  const task = tasks.get(taskId);
  if (!task) throw new Error("Managed task not found");
  if (!enabled && task.definition.priority === "critical") {
    throw new Error("Critical managed tasks cannot be paused");
  }

  task.enabled = enabled;
  if (!enabled) {
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    task.nextRunAt = null;
    if (task.state !== "running") task.state = "paused";
  } else {
    if (task.state !== "running") task.state = "idle";
    schedule(task);
  }

  return serializeTask(task);
}

export function getResourceManagerStatus() {
  const memory = process.memoryUsage();
  return {
    started,
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
      nodeVersion: process.version,
      pid: process.pid,
    },
    residualProcessChecks: {
      totalChecks: runtimeCheckCount,
      staleRecordsRemoved: staleRuntimeRecordsRemoved,
      lastCheck: lastRuntimeCheck,
    },
    coordination: getManagerCoordinationStatus(),
    tasks: [...tasks.values()].map(serializeTask),
  };
}

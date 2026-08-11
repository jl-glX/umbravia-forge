import { evaluateDueInactivityDeletions } from "./account-lifecycle.js";
import { evaluateDueCommercialTrialCleanups } from "./commercial-trial.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let currentRun: Promise<{ evaluated: number; scheduled: number }> | null = null;
let lastRunAt: number | null = null;
let lastResult: { evaluated: number; scheduled: number } | null = null;
let lastError: string | null = null;

function intervalMs(): number {
  const configured = Number.parseInt(
    process.env.ACCOUNT_LIFECYCLE_REVIEW_INTERVAL_MS ??
      String(DEFAULT_INTERVAL_MS),
    10,
  );
  if (!Number.isFinite(configured)) return DEFAULT_INTERVAL_MS;
  return Math.min(Math.max(configured, 60_000), 24 * 60 * 60 * 1000);
}

export function runAccountLifecycleReview() {
  if (currentRun) return currentRun;
  const execution = Promise.all([
    evaluateDueInactivityDeletions(),
    evaluateDueCommercialTrialCleanups(),
  ])
    .then(([accountResult, commercialTrialCleanup]) => ({
      ...accountResult,
      commercialTrialCleanup,
    }))
    .then((result) => {
      lastResult = result;
      lastError = null;
      lastRunAt = Date.now();
      return result;
    })
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : "Unknown error";
      lastRunAt = Date.now();
      throw error;
    })
    .finally(() => {
      if (currentRun === execution) currentRun = null;
    });
  currentRun = execution;
  return execution;
}

function scheduleReview(): void {
  void runAccountLifecycleReview().catch((error: unknown) => {
    console.error(
      "Account lifecycle review failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  });
}

export async function startAccountLifecycleScheduler(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runAccountLifecycleReview();
    if (!running) return;
    timer = setInterval(scheduleReview, intervalMs());
    timer.unref();
  } catch (error) {
    running = false;
    throw error;
  }
}

export async function stopAccountLifecycleScheduler(): Promise<void> {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (currentRun) await currentRun.catch(() => undefined);
}

export function getAccountLifecycleSchedulerStatus() {
  return {
    running,
    runInProgress: currentRun !== null,
    lastRunAt,
    lastResult,
    lastError,
    intervalMs: intervalMs(),
  };
}

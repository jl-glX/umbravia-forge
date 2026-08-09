import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

function resolveWorkerCount(): number {
  const requested = Number.parseInt(
    process.env.UMBRAVIA_VITEST_WORKERS ?? "",
    10,
  );
  if (requested === 1 || requested === 2) {
    return requested;
  }

  return Math.max(1, Math.min(2, availableParallelism()));
}

const workerCount = resolveWorkerCount();

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    globalSetup: ["./scripts/testing/vitest-resource-guard.ts"],
    // Worker threads preserve isolation without leaving child Node processes
    // behind when Windows or the terminal interrupts the supervised run.
    pool: "threads",
    isolate: true,
    fileParallelism: true,
    maxWorkers: workerCount,
    maxConcurrency: 1,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    sequence: {
      concurrent: false,
    },
  },
});

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
    // Two isolated processes provide a bounded speed-up while keeping native
    // SQLite modules, environment variables and module state separated.
    pool: "forks",
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

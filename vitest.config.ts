import { defineConfig } from "vitest/config";

function resolveWorkerCount(): number {
  const requested = Number.parseInt(
    process.env.UMBRAVIA_VITEST_WORKERS ?? "",
    10,
  );
  if (requested === 1 || requested === 2) {
    return requested;
  }

  // Keep developer validation deterministic on every operating system. CI
  // receives a second worker through its standard environment marker.
  return process.env.CI ? 2 : 1;
}

const workerCount = resolveWorkerCount();

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
      "cloudflare/**/*.test.ts",
    ],
    globalSetup: ["./scripts/testing/vitest-resource-guard.ts"],
    // Worker threads preserve isolation without leaving child Node processes
    // behind when the terminal interrupts the supervised run.
    pool: "threads",
    isolate: true,
    fileParallelism: false,
    maxWorkers: workerCount,
    maxConcurrency: 1,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    sequence: {
      concurrent: false,
    },
  },
});

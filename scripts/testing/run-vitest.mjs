import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const mode = process.argv[2];
if (!new Set(["run", "watch"]).has(mode)) {
  throw new Error("Vitest supervisor requires run or watch mode");
}

const projectRoot = process.cwd();
const supervisorLockPath = path.join(
  tmpdir(),
  `umbravia-forge-vitest-supervisor-${createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12)}.lock`,
);
const viteTemporaryDirectory = path.join(
  projectRoot,
  "node_modules",
  ".vite-temp",
);

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readSupervisorLock() {
  try {
    return JSON.parse(await readFile(supervisorLockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { invalid: true };
  }
}

async function acquireSupervisorLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();

    try {
      const handle = await open(supervisorLockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token, projectRoot }),
        "utf8",
      );
      await handle.close();

      return async () => {
        const currentLock = await readSupervisorLock();
        if (currentLock?.token === token) {
          await rm(supervisorLockPath, { force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const currentLock = await readSupervisorLock();
      if (currentLock?.pid && isProcessAlive(currentLock.pid)) {
        throw new Error(
          `Ya hay una sesión gestionada de Vitest activa (PID ${currentLock.pid}).`,
          { cause: error },
        );
      }

      await rm(supervisorLockPath, { force: true });
    }
  }

  throw new Error("No se pudo adquirir el bloqueo del supervisor de Vitest.");
}

async function cleanViteTemporaryDirectory() {
  await rm(viteTemporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 125,
  });
}

const releaseSupervisorLock = await acquireSupervisorLock();

try {
  // Vite transpiles the TypeScript config into this disposable directory.
  // Removing it avoids stale file handles without touching test results.
  await cleanViteTemporaryDirectory();
} catch (error) {
  await releaseSupervisorLock();
  throw error;
}

const vitestEntry = path.join(
  projectRoot,
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const vitestArguments = [
  vitestEntry,
  ...(mode === "run" ? ["run"] : []),
  "--config",
  "vitest.config.ts",
  ...(mode === "watch" ? ["--watch"] : []),
  ...process.argv.slice(3),
];
const ownsProcessGroup = process.platform !== "win32";

const child = spawn(process.execPath, vitestArguments, {
  cwd: projectRoot,
  env: {
    ...process.env,
    UMBRAVIA_VITEST_MANAGED: "true",
  },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
  // POSIX process groups let the supervisor terminate every descendant. On
  // Windows Vitest uses worker threads, so the owned child remains the only
  // operating-system process that needs to be stopped.
  detached: ownsProcessGroup,
});

let shutdownSignal;
let forcedShutdown;
let supervisorReleased = false;

async function releaseSupervisorOnce() {
  if (supervisorReleased) return;
  supervisorReleased = true;
  await releaseSupervisorLock();
}

function signalOwnedVitest(signal) {
  if (ownsProcessGroup && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}

function stopOwnedVitest(signal) {
  if (shutdownSignal || child.exitCode !== null) return;
  shutdownSignal = signal;
  signalOwnedVitest(signal === "SIGINT" ? "SIGINT" : "SIGTERM");
  forcedShutdown = setTimeout(() => {
    if (child.exitCode === null) {
      signalOwnedVitest("SIGKILL");
    }
  }, 10_000);
}

const handledSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of handledSignals) {
  process.once(signal, () => stopOwnedVitest(signal));
}

child.once("error", async (error) => {
  await releaseSupervisorOnce();
  console.error("No se pudo iniciar la sesión gestionada de Vitest:", error);
  process.exitCode = 1;
});

child.once("exit", async (code, signal) => {
  if (forcedShutdown) clearTimeout(forcedShutdown);
  for (const handledSignal of handledSignals) {
    process.removeAllListeners(handledSignal);
  }
  await releaseSupervisorOnce();

  if (shutdownSignal === "SIGINT") {
    process.exitCode = 130;
  } else if (shutdownSignal || signal) {
    process.exitCode = 143;
  } else {
    process.exitCode = code ?? 1;
  }
});

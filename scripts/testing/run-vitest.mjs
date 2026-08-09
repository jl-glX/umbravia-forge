import { spawn } from "node:child_process";
import path from "node:path";

const mode = process.argv[2];
if (!new Set(["run", "watch"]).has(mode)) {
  throw new Error("Vitest supervisor requires run or watch mode");
}

const projectRoot = process.cwd();
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

child.once("error", (error) => {
  console.error("No se pudo iniciar la sesión gestionada de Vitest:", error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (forcedShutdown) clearTimeout(forcedShutdown);
  for (const handledSignal of handledSignals) {
    process.removeAllListeners(handledSignal);
  }

  if (shutdownSignal === "SIGINT") {
    process.exitCode = 130;
  } else if (shutdownSignal || signal) {
    process.exitCode = 143;
  } else {
    process.exitCode = code ?? 1;
  }
});

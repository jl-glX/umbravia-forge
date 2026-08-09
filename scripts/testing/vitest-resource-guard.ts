import { randomUUID } from "node:crypto";
import { open, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DIRECTORY_PREFIXES = ["umbravia-forge-", "umbravia-"] as const;
const LOCK_FILE_NAME = "umbravia-forge-vitest.lock";
const DEFAULT_STALE_AGE_MS = 30 * 60 * 1_000;

interface LockRecord {
  pid: number;
  token: string;
  createdAt: string;
}

export interface CleanupOptions {
  root?: string;
  minimumAgeMs?: number;
  now?: number;
}

export interface CleanupReport {
  removed: string[];
  failed: Array<{ path: string; reason: string }>;
}

function isRecognizedTestDirectory(name: string): boolean {
  return TEST_DIRECTORY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

async function listRecognizedTestDirectories(
  root: string,
): Promise<Set<string>> {
  const entries = await readdir(root, { withFileTypes: true });
  return new Set(
    entries
      .filter(
        (entry) => entry.isDirectory() && isRecognizedTestDirectory(entry.name),
      )
      .map((entry) => entry.name),
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cleanupStaleVitestDirectories(
  options: CleanupOptions = {},
): Promise<CleanupReport> {
  const root = options.root ?? tmpdir();
  const minimumAgeMs = options.minimumAgeMs ?? DEFAULT_STALE_AGE_MS;
  const now = options.now ?? Date.now();
  const report: CleanupReport = { removed: [], failed: [] };
  const directories = await listRecognizedTestDirectories(root);

  for (const name of directories) {
    const target = path.join(root, name);
    try {
      const metadata = await stat(target);
      if (now - metadata.mtimeMs < minimumAgeMs) {
        continue;
      }

      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      report.removed.push(target);
    } catch (error) {
      report.failed.push({ path: target, reason: describeError(error) });
    }
  }

  return report;
}

export async function cleanupDirectoriesCreatedAfterSnapshot(
  baseline: ReadonlySet<string>,
  root = tmpdir(),
): Promise<CleanupReport> {
  const report: CleanupReport = { removed: [], failed: [] };
  const directories = await listRecognizedTestDirectories(root);

  for (const name of directories) {
    if (baseline.has(name)) {
      continue;
    }

    const target = path.join(root, name);
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 3 });
      report.removed.push(target);
    } catch (error) {
      report.failed.push({ path: target, reason: describeError(error) });
    }
  }

  return report;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockRecord(lockPath: string): Promise<LockRecord | null> {
  try {
    const candidate = JSON.parse(
      await readFile(lockPath, "utf8"),
    ) as Partial<LockRecord>;
    if (
      typeof candidate.pid !== "number" ||
      typeof candidate.token !== "string" ||
      typeof candidate.createdAt !== "string"
    ) {
      return null;
    }
    return candidate as LockRecord;
  } catch {
    return null;
  }
}

export async function acquireVitestRunLock(
  root = tmpdir(),
): Promise<() => Promise<void>> {
  const lockPath = path.join(root, LOCK_FILE_NAME);
  const record: LockRecord = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.close();

      return async () => {
        const current = await readLockRecord(lockPath);
        if (current?.token === record.token) {
          await rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }

      const existing = await readLockRecord(lockPath);
      if (existing && isProcessAlive(existing.pid)) {
        throw new Error(
          `Ya hay una ejecución de Vitest activa (PID ${existing.pid}). ` +
            "Espera a que termine antes de iniciar otra.",
          { cause: error },
        );
      }

      await rm(lockPath, { force: true });
    }
  }

  throw new Error("No se pudo adquirir el bloqueo exclusivo de Vitest.");
}

function reportCleanup(label: string, report: CleanupReport): void {
  if (report.removed.length > 0) {
    console.info(`${label}: ${report.removed.length} recurso(s) retirado(s).`);
  }
  for (const failure of report.failed) {
    console.warn(
      `${label}: no se pudo limpiar ${failure.path}: ${failure.reason}`,
    );
  }
}

export default async function setupVitestResourceGuard(): Promise<
  () => Promise<void>
> {
  const root = tmpdir();
  const releaseLock = await acquireVitestRunLock(root);

  try {
    reportCleanup(
      "Limpieza previa de Vitest",
      await cleanupStaleVitestDirectories({ root }),
    );
    const baseline = await listRecognizedTestDirectories(root);

    return async () => {
      try {
        reportCleanup(
          "Limpieza final de Vitest",
          await cleanupDirectoriesCreatedAfterSnapshot(baseline, root),
        );
      } finally {
        await releaseLock();
      }
    };
  } catch (error) {
    await releaseLock();
    throw error;
  }
}

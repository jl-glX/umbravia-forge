import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import Database from "better-sqlite3";
import { parse as parseEnvironment } from "dotenv";
import pg from "pg";

const CAPABILITIES_RELATIVE_PATH = path.join(
  "deploy",
  "release-capabilities.json",
);
const LOCALE_TABLES = [
  "users",
  "emailDeliveries",
  "commercialTrials",
  "administratorSignupProvisioning",
  "umfSupportAccessRequests",
];
const LEGACY_RELEASE_CAPABILITIES = new Map([
  ["da5466706a0026f018f8b211b352c793eb7a1cfd", ["es", "en", "de", "de-CH"]],
]);
const EXIT_SAFE = 0;
const EXIT_INCOMPATIBLE = 2;
const EXIT_INDETERMINATE = 3;

class PreflightFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "PreflightFailure";
    this.code = code;
  }
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function normalizeLocale(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new PreflightFailure("INVENTORY_INVALID_COUNT");
  }
  return count;
}

function addIncompatibleCount(
  target,
  candidateLocales,
  targetLocales,
  source,
  locale,
  count,
) {
  const normalizedLocale = normalizeLocale(locale);
  if (!normalizedLocale || !candidateLocales.has(normalizedLocale)) {
    throw new PreflightFailure("INVENTORY_UNKNOWN_LOCALE");
  }
  if (targetLocales.has(normalizedLocale)) return;
  const key = `${source}:${normalizedLocale}`;
  target.set(key, (target.get(key) ?? 0) + normalizeCount(count));
}

function validateCapabilities(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.supportedLocales) ||
    value.supportedLocales.length === 0
  ) {
    throw new PreflightFailure("RELEASE_CAPABILITIES_INVALID");
  }
  const locales = value.supportedLocales;
  if (
    locales.some(
      (locale) =>
        typeof locale !== "string" ||
        !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(locale),
    ) ||
    new Set(locales).size !== locales.length
  ) {
    throw new PreflightFailure("RELEASE_CAPABILITIES_INVALID");
  }
  return { schemaVersion: 1, supportedLocales: [...locales] };
}

async function readReleaseCapabilities(releaseRoot) {
  const capabilitiesPath = path.join(releaseRoot, CAPABILITIES_RELATIVE_PATH);
  const metadata = await lstat(capabilitiesPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new PreflightFailure("RELEASE_CAPABILITIES_INVALID");
  }
  const source = await readFile(capabilitiesPath, "utf8");
  return validateCapabilities(JSON.parse(source));
}

async function readExactCommitMarker(releaseRoot, fileName, expectedCommit) {
  const markerPath = path.join(releaseRoot, fileName);
  const metadata = await lstat(markerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new PreflightFailure("LEGACY_TARGET_IDENTITY_INVALID");
  }
  const marker = (await readFile(markerPath, "utf8")).trim();
  if (marker !== expectedCommit) {
    throw new PreflightFailure("LEGACY_TARGET_IDENTITY_INVALID");
  }
}

async function readTargetCapabilities(releaseRoot, legacyTargetCommit) {
  if (!legacyTargetCommit) {
    return readReleaseCapabilities(releaseRoot);
  }
  const supportedLocales = LEGACY_RELEASE_CAPABILITIES.get(legacyTargetCommit);
  if (!supportedLocales || path.basename(releaseRoot) !== legacyTargetCommit) {
    throw new PreflightFailure("LEGACY_TARGET_IDENTITY_INVALID");
  }
  try {
    await lstat(path.join(releaseRoot, CAPABILITIES_RELATIVE_PATH));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await Promise.all([
      readExactCommitMarker(
        releaseRoot,
        ".umbravia-release-commit",
        legacyTargetCommit,
      ),
      readExactCommitMarker(
        releaseRoot,
        ".umbravia-release-complete",
        legacyTargetCommit,
      ),
    ]);
    return validateCapabilities({
      schemaVersion: 1,
      supportedLocales,
    });
  }
  throw new PreflightFailure("LEGACY_TARGET_CAPABILITIES_PRESENT");
}

function resolveFromRelease(releaseRoot, configuredPath) {
  return path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(releaseRoot, configuredPath);
}

async function resolvePersistentPaths(environment, releaseRoot, provider) {
  const configuredDataDirectory = environment.DATA_DIRECTORY?.trim() || "data";
  const dataDirectory = resolveFromRelease(
    releaseRoot,
    configuredDataDirectory,
  );
  const configuredEnvironmentRoot = environment.ENVIRONMENT_DATA_ROOT?.trim();
  const environmentRoot = configuredEnvironmentRoot
    ? resolveFromRelease(releaseRoot, configuredEnvironmentRoot)
    : path.resolve(dataDirectory, "environments");
  const resolved = {
    environmentRoot: await realpath(environmentRoot),
  };
  if (provider === "sqlite") {
    resolved.databasePath = await realpath(
      path.join(dataDirectory, "database.sqlite"),
    );
  }
  return resolved;
}

function assertStablePersistentPaths(candidatePaths, targetPaths, provider) {
  if (candidatePaths.environmentRoot !== targetPaths.environmentRoot) {
    throw new PreflightFailure("ENVIRONMENT_ROOT_DIVERGES");
  }
  if (
    provider === "sqlite" &&
    candidatePaths.databasePath !== targetPaths.databasePath
  ) {
    throw new PreflightFailure("DATABASE_PATH_DIVERGES");
  }
}

function inspectSqlite(
  databasePath,
  candidateLocales,
  targetLocales,
  findings,
) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma("query_only = ON");
    if (Number(database.pragma("query_only", { simple: true })) !== 1) {
      throw new PreflightFailure("SQLITE_NOT_QUERY_ONLY");
    }
    database.exec("BEGIN");
    for (const table of LOCALE_TABLES) {
      const rows = database
        .prepare(
          `SELECT locale, COUNT(*) AS count FROM "${table}" GROUP BY locale`,
        )
        .all();
      for (const row of rows) {
        addIncompatibleCount(
          findings,
          candidateLocales,
          targetLocales,
          table,
          row.locale,
          row.count,
        );
      }
    }
  } finally {
    if (database.inTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

async function inspectPostgres(
  environment,
  candidateLocales,
  targetLocales,
  findings,
  createClient,
) {
  if (!environment.DATABASE_URL) {
    throw new PreflightFailure("POSTGRES_CONFIGURATION_INCOMPLETE");
  }
  const client = createClient({
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: positiveInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
      60_000,
    ),
    statement_timeout: 15_000,
    application_name: "umbravia-forge-rollback-preflight",
    ssl:
      environment.DATABASE_SSL === "false"
        ? false
        : {
            minVersion: "TLSv1.2",
            rejectUnauthorized:
              environment.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
          },
  });
  let transactionStarted = false;
  await client.connect();
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionStarted = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    for (const table of LOCALE_TABLES) {
      const result = await client.query(
        `SELECT locale, COUNT(*)::int AS count FROM "${table}" GROUP BY locale`,
      );
      for (const row of result.rows) {
        addIncompatibleCount(
          findings,
          candidateLocales,
          targetLocales,
          table,
          row.locale,
          row.count,
        );
      }
    }
  } finally {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    await client.end();
  }
}

async function inspectManagedEnvironments(
  environmentRoot,
  candidateLocales,
  targetLocales,
  findings,
) {
  const entries = await readdir(environmentRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new PreflightFailure("ENVIRONMENT_ENTRY_UNSUPPORTED");
    }
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(
        path.join(environmentRoot, entry.name, "environment.json"),
        "utf8",
      ),
    );
    if (!normalizeLocale(manifest.locale)) {
      throw new PreflightFailure("ENVIRONMENT_LOCALE_INVALID");
    }
    addIncompatibleCount(
      findings,
      candidateLocales,
      targetLocales,
      "environmentManifests",
      manifest.locale,
      1,
    );
  }
}

function serializeFindings(findings) {
  return [...findings.entries()]
    .map(([key, count]) => {
      const separator = key.lastIndexOf(":");
      return {
        source: key.slice(0, separator),
        locale: key.slice(separator + 1),
        count,
      };
    })
    .sort((left, right) =>
      `${left.source}:${left.locale}`.localeCompare(
        `${right.source}:${right.locale}`,
        "en",
      ),
    );
}

function indeterminate(reason) {
  return {
    status: "indeterminate",
    exitCode: EXIT_INDETERMINATE,
    reason,
    findings: [],
  };
}

export async function inspectLocaleRollbackSafety({
  environment,
  candidateRelease,
  targetRelease,
  legacyTargetCommit,
  createPostgresClient = (configuration) => new pg.Client(configuration),
}) {
  try {
    const [candidateRoot, targetRoot] = await Promise.all([
      realpath(candidateRelease),
      realpath(targetRelease),
    ]);
    const [candidateCapabilities, targetCapabilities] = await Promise.all([
      readReleaseCapabilities(candidateRoot),
      readTargetCapabilities(targetRoot, legacyTargetCommit),
    ]);
    const candidateLocales = new Set(candidateCapabilities.supportedLocales);
    if (
      targetCapabilities.supportedLocales.some(
        (locale) => !candidateLocales.has(locale),
      )
    ) {
      throw new PreflightFailure("LOCALE_CAPABILITY_REGRESSION");
    }

    const configuredProvider =
      environment.DATABASE_PROVIDER?.trim().toLowerCase();
    if (
      configuredProvider &&
      configuredProvider !== "sqlite" &&
      configuredProvider !== "postgresql"
    ) {
      throw new PreflightFailure("DATABASE_PROVIDER_INVALID");
    }
    const provider =
      configuredProvider ??
      (environment.DATABASE_URL ? "postgresql" : "sqlite");
    const [candidatePaths, targetPaths] = await Promise.all([
      resolvePersistentPaths(environment, candidateRoot, provider),
      resolvePersistentPaths(environment, targetRoot, provider),
    ]);
    assertStablePersistentPaths(candidatePaths, targetPaths, provider);

    const targetLocales = new Set(targetCapabilities.supportedLocales);
    const findings = new Map();
    if (provider === "postgresql") {
      await inspectPostgres(
        environment,
        candidateLocales,
        targetLocales,
        findings,
        createPostgresClient,
      );
    } else {
      inspectSqlite(
        targetPaths.databasePath,
        candidateLocales,
        targetLocales,
        findings,
      );
    }
    await inspectManagedEnvironments(
      targetPaths.environmentRoot,
      candidateLocales,
      targetLocales,
      findings,
    );
    const serializedFindings = serializeFindings(findings);
    return serializedFindings.length === 0
      ? {
          status: "safe",
          exitCode: EXIT_SAFE,
          provider,
          targetLocales: [...targetCapabilities.supportedLocales],
          findings: [],
        }
      : {
          status: "blocked",
          exitCode: EXIT_INCOMPATIBLE,
          provider,
          targetLocales: [...targetCapabilities.supportedLocales],
          findings: serializedFindings,
        };
  } catch (error) {
    return indeterminate(
      error instanceof PreflightFailure ? error.code : "INVENTORY_INCOMPLETE",
    );
  }
}

function parseArguments(argv) {
  const values = new Map();
  const allowedArguments = new Set([
    "--environment-file",
    "--candidate-release",
    "--target-release",
    "--legacy-target-commit",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowedArguments.has(name) || !value || value.startsWith("--")) {
      throw new PreflightFailure("ARGUMENTS_INVALID");
    }
    if (values.has(name)) {
      throw new PreflightFailure("ARGUMENTS_INVALID");
    }
    values.set(name, value);
  }
  const environmentFile = values.get("--environment-file");
  const candidateRelease = values.get("--candidate-release");
  const targetRelease = values.get("--target-release");
  const legacyTargetCommit = values.get("--legacy-target-commit");
  if (
    (values.size !== 3 && values.size !== 4) ||
    !environmentFile ||
    !candidateRelease ||
    !targetRelease
  ) {
    throw new PreflightFailure("ARGUMENTS_INVALID");
  }
  return {
    environmentFile,
    candidateRelease,
    targetRelease,
    legacyTargetCommit,
  };
}

async function main() {
  let result;
  try {
    const {
      environmentFile,
      candidateRelease,
      targetRelease,
      legacyTargetCommit,
    } = parseArguments(process.argv.slice(2));
    if (!existsSync(environmentFile)) {
      throw new PreflightFailure("ENVIRONMENT_FILE_UNAVAILABLE");
    }
    const environment = parseEnvironment(
      await readFile(path.resolve(environmentFile), "utf8"),
    );
    result = await inspectLocaleRollbackSafety({
      environment,
      candidateRelease,
      targetRelease,
      legacyTargetCommit,
    });
  } catch (error) {
    result = indeterminate(
      error instanceof PreflightFailure ? error.code : "PREFLIGHT_FAILED",
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}

export {
  CAPABILITIES_RELATIVE_PATH,
  EXIT_INCOMPATIBLE,
  EXIT_INDETERMINATE,
  EXIT_SAFE,
  LEGACY_RELEASE_CAPABILITIES,
  LOCALE_TABLES,
};

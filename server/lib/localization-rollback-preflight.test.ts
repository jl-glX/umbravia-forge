import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const helperPath = path.resolve("deploy", "check-locale-rollback-safety.mjs");
const localeTables = [
  "users",
  "emailDeliveries",
  "commercialTrials",
  "administratorSignupProvisioning",
  "umfSupportAccessRequests",
] as const;
const currentLocales = [
  "es",
  "en",
  "de",
  "de-CH",
  "fr",
  "it",
  "gl",
  "ca",
  "ca-valencia",
  "eu",
  "oc-aranes",
] as const;
const legacyLocales = ["es", "en", "de", "de-CH"] as const;
const knownLegacyCommit = "da5466706a0026f018f8b211b352c793eb7a1cfd";

const temporaryDirectories: string[] = [];

async function createRelease(
  root: string,
  name: string,
  supportedLocales: readonly string[],
) {
  const release = path.join(root, name);
  await mkdir(path.join(release, "deploy"), { recursive: true });
  await writeFile(
    path.join(release, "deploy", "release-capabilities.json"),
    `${JSON.stringify({ schemaVersion: 1, supportedLocales }, null, 2)}\n`,
    "utf8",
  );
  return release;
}

function createDatabase(databasePath: string, locale = "es") {
  const database = new Database(databasePath);
  try {
    for (const table of localeTables) {
      database.exec(
        `CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, locale TEXT, payloadEncrypted BLOB)`,
      );
      database
        .prepare(
          `INSERT INTO "${table}" (locale, payloadEncrypted) VALUES (?, ?)`,
        )
        .run(locale, Buffer.from("encrypted-sentinel"));
    }
  } finally {
    database.close();
  }
}

function portablePath(value: string) {
  return value.split(path.sep).join("/");
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "umbravia-rollback-"));
  temporaryDirectories.push(root);
  const dataDirectory = path.join(root, "persistent-data");
  const environmentRoot = path.join(root, "managed-environments");
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(path.join(environmentRoot, "demo"), { recursive: true });
  const databasePath = path.join(dataDirectory, "database.sqlite");
  const manifestPath = path.join(environmentRoot, "demo", "environment.json");
  createDatabase(databasePath);
  await writeFile(manifestPath, '{"locale":"es"}\n', "utf8");

  const candidateRelease = await createRelease(
    root,
    "candidate",
    currentLocales,
  );
  const targetRelease = await createRelease(root, "target", legacyLocales);
  const environmentFile = path.join(root, "application.env");
  await writeFile(
    environmentFile,
    [
      "DATABASE_PROVIDER=sqlite",
      `DATA_DIRECTORY=${portablePath(dataDirectory)}`,
      `ENVIRONMENT_DATA_ROOT=${portablePath(environmentRoot)}`,
      "DATABASE_URL=postgresql://must-not-be-used.invalid/secret",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    candidateRelease,
    dataDirectory,
    databasePath,
    environmentFile,
    environmentRoot,
    manifestPath,
    root,
    targetRelease,
  };
}

async function runPreflight(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  extraArguments: string[] = [],
) {
  return execFileAsync(process.execPath, [
    helperPath,
    "--environment-file",
    fixture.environmentFile,
    "--candidate-release",
    fixture.candidateRelease,
    "--target-release",
    fixture.targetRelease,
    ...extraArguments,
  ]);
}

async function createKnownLegacyTarget(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  { includeCapabilities = false } = {},
) {
  await rm(fixture.targetRelease, { recursive: true, force: true });
  const targetRelease = includeCapabilities
    ? await createRelease(fixture.root, knownLegacyCommit, legacyLocales)
    : path.join(fixture.root, knownLegacyCommit);
  await mkdir(path.join(targetRelease, "deploy"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(targetRelease, ".umbravia-release-commit"),
      `${knownLegacyCommit}\n`,
      "utf8",
    ),
    writeFile(
      path.join(targetRelease, ".umbravia-release-complete"),
      `${knownLegacyCommit}\n`,
      "utf8",
    ),
  ]);
  return { ...fixture, targetRelease };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("localization rollback preflight", () => {
  it("accepts a complete legacy-only inventory without modifying persistent data", async () => {
    const fixture = await createFixture();
    const [databaseBefore, manifestBefore] = await Promise.all([
      readFile(fixture.databasePath),
      readFile(fixture.manifestPath),
    ]);

    const result = await runPreflight(fixture);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "safe",
      exitCode: 0,
      provider: "sqlite",
      targetLocales: legacyLocales,
      findings: [],
    });
    await expect(readFile(fixture.databasePath)).resolves.toEqual(
      databaseBefore,
    );
    await expect(readFile(fixture.manifestPath)).resolves.toEqual(
      manifestBefore,
    );
  });

  it("blocks every persisted source that uses a locale absent from the target", async () => {
    const fixture = await createFixture();
    const database = new Database(fixture.databasePath);
    try {
      for (const table of localeTables) {
        database.prepare(`UPDATE "${table}" SET locale = ?`).run("fr");
      }
    } finally {
      database.close();
    }
    await writeFile(fixture.manifestPath, '{"locale":"ca-valencia"}\n');

    await expect(runPreflight(fixture)).rejects.toMatchObject({
      code: 2,
      stderr: "",
    });
    try {
      await runPreflight(fixture);
      throw new Error("El preflight incompatible no ha fallado");
    } catch (error) {
      const output = JSON.parse(String((error as { stdout: string }).stdout));
      expect(output.status).toBe("blocked");
      expect(output.exitCode).toBe(2);
      expect(output.findings).toEqual([
        {
          source: "administratorSignupProvisioning",
          locale: "fr",
          count: 1,
        },
        { source: "commercialTrials", locale: "fr", count: 1 },
        { source: "emailDeliveries", locale: "fr", count: 1 },
        {
          source: "environmentManifests",
          locale: "ca-valencia",
          count: 1,
        },
        { source: "umfSupportAccessRequests", locale: "fr", count: 1 },
        { source: "users", locale: "fr", count: 1 },
      ]);
      expect(JSON.stringify(output)).not.toContain("encrypted-sentinel");
      expect(JSON.stringify(output)).not.toContain("DATABASE_URL");
    }
  });

  it("fails closed without echoing an unknown locale or a missing target marker", async () => {
    const fixture = await createFixture();
    const secretLocale = "private-tenant-value";
    await writeFile(
      fixture.manifestPath,
      `${JSON.stringify({ locale: secretLocale })}\n`,
    );

    try {
      await runPreflight(fixture);
      throw new Error("El inventario desconocido no ha fallado");
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      expect(failure.code).toBe(3);
      expect(failure.stderr).toBe("");
      expect(failure.stdout).not.toContain(secretLocale);
      expect(JSON.parse(failure.stdout)).toMatchObject({
        status: "indeterminate",
        exitCode: 3,
        reason: "INVENTORY_UNKNOWN_LOCALE",
        findings: [],
      });
    }

    await rm(
      path.join(fixture.targetRelease, "deploy", "release-capabilities.json"),
    );
    await expect(runPreflight(fixture)).rejects.toMatchObject({ code: 3 });

    await expect(
      execFileAsync(process.execPath, [
        helperPath,
        "--environment-file",
        fixture.environmentFile,
        "--candidate-release",
        fixture.candidateRelease,
        "--target-release",
        fixture.targetRelease,
        "--target-release",
        fixture.targetRelease,
      ]),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("audits the one known four-locale release only with its exact commit identity", async () => {
    const originalFixture = await createFixture();
    const fixture = await createKnownLegacyTarget(originalFixture);
    const [databaseBefore, manifestBefore] = await Promise.all([
      readFile(fixture.databasePath),
      readFile(fixture.manifestPath),
    ]);

    await expect(runPreflight(fixture)).rejects.toMatchObject({ code: 3 });
    const result = await runPreflight(fixture, [
      "--legacy-target-commit",
      knownLegacyCommit,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "safe",
      exitCode: 0,
      provider: "sqlite",
      targetLocales: legacyLocales,
      findings: [],
    });
    await expect(readFile(fixture.databasePath)).resolves.toEqual(
      databaseBefore,
    );
    await expect(readFile(fixture.manifestPath)).resolves.toEqual(
      manifestBefore,
    );
  });

  it("blocks incompatible data and any marker ambiguity in the legacy transition", async () => {
    const originalFixture = await createFixture();
    const fixture = await createKnownLegacyTarget(originalFixture);
    const database = new Database(fixture.databasePath);
    try {
      database.prepare('UPDATE "users" SET locale = ?').run("fr");
    } finally {
      database.close();
    }

    await expect(
      runPreflight(fixture, ["--legacy-target-commit", knownLegacyCommit]),
    ).rejects.toMatchObject({ code: 2 });

    const markedFixture = await createKnownLegacyTarget(await createFixture(), {
      includeCapabilities: true,
    });
    await expect(
      runPreflight(markedFixture, [
        "--legacy-target-commit",
        knownLegacyCommit,
      ]),
    ).rejects.toMatchObject({ code: 3 });
    await expect(
      runPreflight(fixture, [
        "--legacy-target-commit",
        "0000000000000000000000000000000000000000",
      ]),
    ).rejects.toMatchObject({ code: 3 });
  });
});

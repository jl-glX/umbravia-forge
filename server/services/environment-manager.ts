import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import {
  createSqliteEnvironmentDatabase,
  databaseProvider,
} from "../db/client.js";
import {
  buildSqliteToPostgresMigrationPlan,
  inspectSqliteDatabase,
} from "../db/database-bridge.js";
import { resolveDeploymentProfile } from "../lib/deployment-profile.js";
import { getManagedEmailDeploymentReadiness } from "./email-manager.js";
import {
  getManagerCoordinationStatus,
  publishManagerSignal,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";

export type ManagedEnvironmentKind = "commercial_mvp" | "customer_sandbox";
export type ManagedEnvironmentStatus =
  "ready" | "migration_review" | "migration_ready" | "migration_blocked";

interface ManagedEnvironmentManifest {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  kind: ManagedEnvironmentKind;
  status: ManagedEnvironmentStatus;
  locale: "es" | "en" | "de" | "de-CH";
  templateKey: string;
  databaseFile: "database.sqlite";
  createdAt: number;
  updatedAt: number;
}

export interface CreateManagedEnvironmentInput {
  name: string;
  slug: string;
  kind: ManagedEnvironmentKind;
  locale?: ManagedEnvironmentManifest["locale"];
  templateKey?: string;
}

function environmentRoot(): string {
  return path.resolve(
    process.env.ENVIRONMENT_DATA_ROOT ??
      path.join(process.env.DATA_DIRECTORY ?? "data", "environments"),
  );
}

function mutationsEnabled(): boolean {
  const configured = process.env.ENVIRONMENT_MANAGER_MUTATIONS_ENABLED;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(slug)) {
    throw new Error(
      "Environment slug must contain 3-48 lowercase letters, numbers or hyphens",
    );
  }
  return slug;
}

function environmentDirectory(slug: string): string {
  const root = environmentRoot();
  const directory = path.resolve(root, slug);
  if (path.dirname(directory) !== root) {
    throw new Error("Environment path escapes the managed root");
  }
  return directory;
}

function publicManifest(manifest: ManagedEnvironmentManifest) {
  return {
    id: manifest.id,
    slug: manifest.slug,
    name: manifest.name,
    kind: manifest.kind,
    status: manifest.status,
    locale: manifest.locale,
    templateKey: manifest.templateKey,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

async function readManifest(
  directory: string,
): Promise<ManagedEnvironmentManifest> {
  const raw = await readFile(path.join(directory, "environment.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<ManagedEnvironmentManifest>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.databaseFile !== "database.sqlite" ||
    typeof parsed.id !== "string" ||
    typeof parsed.name !== "string" ||
    typeof parsed.slug !== "string" ||
    normalizeSlug(parsed.slug) !== path.basename(directory) ||
    (parsed.kind !== "commercial_mvp" && parsed.kind !== "customer_sandbox") ||
    ![
      "ready",
      "migration_review",
      "migration_ready",
      "migration_blocked",
    ].includes(parsed.status ?? "") ||
    !["es", "en", "de", "de-CH"].includes(parsed.locale ?? "") ||
    typeof parsed.templateKey !== "string" ||
    typeof parsed.createdAt !== "number" ||
    typeof parsed.updatedAt !== "number"
  ) {
    throw new Error("Unsupported managed environment manifest");
  }
  return parsed as ManagedEnvironmentManifest;
}

async function findEnvironment(environmentId: string) {
  const entries = await listManagedEnvironmentManifests();
  const manifest = entries.find((entry) => entry.id === environmentId);
  if (!manifest) throw new Error("Managed environment not found");
  return {
    manifest,
    directory: environmentDirectory(manifest.slug),
  };
}

async function listManagedEnvironmentManifests() {
  const root = environmentRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const manifests: ManagedEnvironmentManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      manifests.push(await readManifest(path.join(root, entry.name)));
    } catch {
      publishManagerSignal(
        "environment",
        "warning",
        "ENVIRONMENT_MANIFEST_INVALID",
        `The managed environment ${entry.name} has an invalid manifest.`,
      );
    }
  }
  return manifests.sort((left, right) => right.createdAt - left.createdAt);
}

export async function listManagedEnvironments() {
  return (await listManagedEnvironmentManifests()).map(publicManifest);
}

export async function createManagedEnvironment(
  input: CreateManagedEnvironmentInput,
) {
  if (!mutationsEnabled()) {
    throw new Error("Managed environment creation is disabled");
  }
  const name = input.name.trim();
  if (name.length < 3 || name.length > 100) {
    throw new Error("Environment name must contain 3-100 characters");
  }
  const slug = normalizeSlug(input.slug);
  const templateKey = input.templateKey?.trim() || "blank";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(templateKey)) {
    throw new Error(
      "Environment template key must contain 1-64 lowercase letters, numbers, hyphens or underscores",
    );
  }
  const directory = environmentDirectory(slug);
  const databasePath = path.join(directory, "database.sqlite");
  const now = Date.now();
  const manifest: ManagedEnvironmentManifest = {
    schemaVersion: 1,
    id: `environment-${randomUUID()}`,
    slug,
    name,
    kind: input.kind,
    status: "ready",
    locale: input.locale ?? "es",
    templateKey,
    databaseFile: "database.sqlite",
    createdAt: now,
    updatedAt: now,
  };

  return withCoordinatedManagerOperation(
    "environment",
    "create-sqlite-environment",
    ["database-maintenance", `environment:${slug}`],
    async () => {
      await mkdir(environmentRoot(), { recursive: true });
      await mkdir(directory, { recursive: false });
      try {
        await createSqliteEnvironmentDatabase(databasePath);
        const environmentDatabase = new Database(databasePath);
        try {
          environmentDatabase
            .prepare(
              "UPDATE facilityProfiles SET name = ?, updatedAt = ? WHERE id = 'primary'",
            )
            .run(name, now);
        } finally {
          environmentDatabase.close();
        }
        await writeFile(
          path.join(directory, "environment.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
        publishManagerSignal(
          "environment",
          "info",
          "ENVIRONMENT_CREATED",
          `SQLite environment ${slug} is ready.`,
        );
        return publicManifest(manifest);
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    },
  );
}

export async function prepareEnvironmentMigration(environmentId: string) {
  return withCoordinatedManagerOperation(
    "environment",
    "prepare-postgresql-migration",
    ["database-maintenance", `environment:${environmentId}`],
    async () => {
      const { manifest, directory } = await findEnvironment(environmentId);
      const plan = buildSqliteToPostgresMigrationPlan(
        path.join(directory, manifest.databaseFile),
      );
      const status: ManagedEnvironmentStatus = plan.ready
        ? "migration_ready"
        : "migration_blocked";
      const updated = { ...manifest, status, updatedAt: Date.now() };
      await writeFile(
        path.join(directory, "environment.json"),
        `${JSON.stringify(updated, null, 2)}\n`,
        "utf8",
      );
      return {
        environment: publicManifest(updated),
        plan: {
          ready: plan.ready,
          targetProvider: plan.targetProvider,
          executionEnabled: plan.executionEnabled,
          missingTables: plan.missingTables,
          rowCounts: plan.rowCounts,
          groupCounts: plan.groupCounts,
          totalRows: plan.totalRows,
          containsSensitiveData: plan.containsSensitiveData,
          safeguards: plan.safeguards,
          excludedByDefault: plan.excludedByDefault,
        },
      };
    },
  );
}

export async function runEnvironmentReadinessAudit() {
  const manifests = await listManagedEnvironmentManifests();
  const findings: string[] = [];
  for (const manifest of manifests) {
    try {
      const inspection = inspectSqliteDatabase(
        path.join(environmentDirectory(manifest.slug), manifest.databaseFile),
      );
      if (!inspection.ready) {
        findings.push(
          `${manifest.slug}: missing ${inspection.missingTables.join(", ")}`,
        );
      }
    } catch (error) {
      findings.push(
        `${manifest.slug}: ${error instanceof Error ? error.message : "inspection failed"}`,
      );
    }
  }
  return {
    count: findings.length,
    summary: `${manifests.length} managed environment(s) inspected; ${findings.length} finding(s).`,
    findings,
  };
}

export async function getEnvironmentManagerOverview() {
  const profile = resolveDeploymentProfile(process.env);
  const environments = await listManagedEnvironments();
  return {
    generatedAt: Date.now(),
    activeDatabase: databaseProvider,
    primaryDatabase: "postgresql" as const,
    deploymentProfile: profile,
    communication: getManagedEmailDeploymentReadiness(),
    policy: {
      postgresql: ["staging", "production", "normal-hosted-environment"],
      sqlite: ["development", "test", "commercial_mvp", "customer_sandbox"],
    },
    mutationsEnabled: mutationsEnabled(),
    postgresqlTargetConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    migrationExecutionEnabled: false,
    migrationMode: "review-first" as const,
    environments,
    coordination: getManagerCoordinationStatus(),
  };
}

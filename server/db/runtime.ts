import {
  isProductionLike,
  resolveDeploymentProfile,
} from "../lib/deployment-profile.js";
import { authenticatedModernTlsOptions } from "../lib/transport-security.js";

export type DatabaseProvider = "sqlite" | "postgresql";

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function resolveDatabaseProvider(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseProvider {
  const configured = environment.DATABASE_PROVIDER?.trim().toLowerCase();
  const deploymentProfile = resolveDeploymentProfile(environment);
  if (configured && configured !== "sqlite" && configured !== "postgresql") {
    throw new Error(
      "DATABASE_PROVIDER must be either 'sqlite' or 'postgresql'",
    );
  }

  if (configured === "sqlite") {
    if (isProductionLike(deploymentProfile)) {
      throw new Error(
        "SQLite is not supported in production. Configure PostgreSQL with DATABASE_URL.",
      );
    }
    return "sqlite";
  }

  if (configured === "postgresql" || environment.DATABASE_URL) {
    if (!environment.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required when DATABASE_PROVIDER=postgresql",
      );
    }
    return "postgresql";
  }

  if (isProductionLike(deploymentProfile)) {
    throw new Error(
      "Production requires DATABASE_URL for PostgreSQL; refusing to start with local SQLite storage.",
    );
  }

  return "sqlite";
}

export function postgresPoolSettings(environment = process.env) {
  const rejectUnauthorized =
    environment.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

  return {
    connectionString: environment.DATABASE_URL,
    max: parsePositiveInteger(environment.DATABASE_POOL_MAX, 10, 50),
    idleTimeoutMillis: parsePositiveInteger(
      environment.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      300_000,
    ),
    connectionTimeoutMillis: parsePositiveInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
      60_000,
    ),
    ssl:
      environment.DATABASE_SSL === "false"
        ? false
        : {
            ...authenticatedModernTlsOptions(),
            rejectUnauthorized,
          },
    application_name: "umbravia-forge",
  } as const;
}

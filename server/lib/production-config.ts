import {
  isProductionLike,
  resolveDeploymentProfile,
  type DeploymentProfile,
} from "./deployment-profile.js";
import {
  resolveEmailDeliveryConfiguration,
  resolveEmailQueueEncryptionKey,
} from "../services/email-delivery.js";
import { emailVerificationIsEnabled } from "./account-verification-mode.js";
import { validatePrivateContentEncryptionConfiguration } from "./private-content-crypto.js";
import { resolveSupportEmailInboundConfiguration } from "./support-email-inbound.js";
import { validateManagerConnectionCryptoConfiguration } from "./manager-connection-crypto.js";

type ProductionConfiguration = {
  deploymentProfile: DeploymentProfile;
  clientOrigin: URL;
  webauthnOrigin: URL;
  webauthnRpId: string;
};

const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required in production`);
  return value;
}

function secureOrigin(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an origin without path, query or hash`);
  }
  return url;
}

function isLoopbackHost(value: string): boolean {
  return value === "127.0.0.1" || value === "::1";
}

function isLocalDatabaseHost(value: string): boolean {
  return value === "" || value === "localhost" || isLoopbackHost(value);
}

function requireSecureDatabaseTransport(
  environment: NodeJS.ProcessEnv,
  databaseUrl: string,
): void {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgresql:// or postgres:// scheme",
    );
  }

  if (isLocalDatabaseHost(parsed.hostname)) return;

  if (environment.DATABASE_SSL === "false") {
    throw new Error("Remote PostgreSQL connections must use TLS");
  }
  if (environment.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
    throw new Error("Remote PostgreSQL TLS must verify the server certificate");
  }
}

function requireMfaEncryptionKey(environment: NodeJS.ProcessEnv): string {
  const value = required(environment, "MFA_ENCRYPTION_KEY");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error(
      "MFA_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64",
    );
  }
  return value;
}

export function validateProductionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  activeDatabaseProvider?: "sqlite" | "postgresql",
): ProductionConfiguration | null {
  const deploymentProfile = resolveDeploymentProfile(environment);
  if (!isProductionLike(deploymentProfile)) return null;

  const clientOrigin = secureOrigin(
    required(environment, "CLIENT_ORIGIN"),
    "CLIENT_ORIGIN",
  );
  const webauthnOrigin = secureOrigin(
    required(environment, "WEBAUTHN_ORIGIN"),
    "WEBAUTHN_ORIGIN",
  );
  const webauthnRpId = required(environment, "WEBAUTHN_RP_ID");
  const databaseProvider = required(environment, "DATABASE_PROVIDER");
  const databaseUrl = required(environment, "DATABASE_URL");
  const turnstileSecret = required(environment, "TURNSTILE_SECRET_KEY");
  requireMfaEncryptionKey(environment);
  const emailVerificationEnabled = emailVerificationIsEnabled(environment);
  const emailDelivery = resolveEmailDeliveryConfiguration(environment);
  resolveEmailQueueEncryptionKey(environment);
  resolveSupportEmailInboundConfiguration(environment);
  validatePrivateContentEncryptionConfiguration(environment);
  validateManagerConnectionCryptoConfiguration(environment);
  const host = environment.HOST?.trim() || "127.0.0.1";

  if (!emailVerificationEnabled) {
    throw new Error("EMAIL_VERIFICATION_ENABLED must be true in production");
  }
  if (!emailDelivery) {
    throw new Error(
      "A valid email transport and EMAIL_FROM are required for email verification in production",
    );
  }

  if (!isLoopbackHost(host)) {
    throw new Error(
      "HOST must be a loopback address in production; expose the application through the reverse proxy",
    );
  }
  if (
    TURNSTILE_TEST_SECRETS.has(turnstileSecret) ||
    /replace|change|example/i.test(turnstileSecret)
  ) {
    throw new Error(
      "TURNSTILE_SECRET_KEY must be a real production secret, not a test key or placeholder",
    );
  }
  if (clientOrigin.origin !== webauthnOrigin.origin) {
    throw new Error(
      "CLIENT_ORIGIN and WEBAUTHN_ORIGIN must match for the initial deployment",
    );
  }
  if (
    webauthnOrigin.hostname !== webauthnRpId &&
    !webauthnOrigin.hostname.endsWith(`.${webauthnRpId}`)
  ) {
    throw new Error(
      "WEBAUTHN_RP_ID must match the deployed application domain",
    );
  }
  if (environment.SEED_DEMO_DATA === "true") {
    throw new Error("SEED_DEMO_DATA must remain false in production");
  }
  if (databaseProvider !== "postgresql") {
    throw new Error("DATABASE_PROVIDER must be postgresql in production");
  }
  requireSecureDatabaseTransport(environment, databaseUrl);
  if (
    activeDatabaseProvider !== undefined &&
    activeDatabaseProvider !== databaseProvider
  ) {
    throw new Error(
      `The active database provider is ${activeDatabaseProvider}, but production is configured for ${databaseProvider}`,
    );
  }

  return { deploymentProfile, clientOrigin, webauthnOrigin, webauthnRpId };
}

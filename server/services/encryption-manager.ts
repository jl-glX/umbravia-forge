import { getPrivateContentEncryptionStatus } from "../lib/private-content-crypto.js";
import { getManagerConnectionCryptoStatus } from "../lib/manager-connection-crypto.js";
import {
  isProductionLike,
  resolveDeploymentProfile,
} from "../lib/deployment-profile.js";
import {
  resolveEmailDeliveryConfiguration,
  resolveEmailQueueEncryptionKey,
} from "./email-delivery.js";
import {
  getManagerCoordinationStatus,
  publishManagerSignal,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";

export type EncryptionCapabilityState =
  "active" | "client_managed" | "external" | "disabled" | "invalid";

export interface EncryptionCapability {
  id:
    | "password_hashing"
    | "mfa_secrets"
    | "email_queue"
    | "private_content"
    | "manager_connections"
    | "e2ee_relay"
    | "encrypted_backups"
    | "transport_security";
  primitive: string;
  state: EncryptionCapabilityState;
  owner: "encryption" | "client" | "edge" | "deployment";
  keyMaterialExposed: false;
  issueCode: string | null;
}

export interface EncryptionManagerAudit {
  generatedAt: number;
  healthy: boolean;
  capabilities: EncryptionCapability[];
  findings: string[];
}

function isCanonicalBase64Key(value: string | undefined): boolean {
  const configured = value?.trim();
  if (!configured) return false;
  const decoded = Buffer.from(configured, "base64");
  return decoded.length === 32 && decoded.toString("base64") === configured;
}

function capability(
  id: EncryptionCapability["id"],
  primitive: string,
  state: EncryptionCapabilityState,
  owner: EncryptionCapability["owner"],
  issueCode: string | null = null,
): EncryptionCapability {
  return { id, primitive, state, owner, keyMaterialExposed: false, issueCode };
}

export function auditEncryptionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): EncryptionManagerAudit {
  const productionLike = isProductionLike(
    resolveDeploymentProfile(environment),
  );
  const capabilities: EncryptionCapability[] = [
    capability("password_hashing", "Argon2id", "active", "encryption"),
  ];

  if (isCanonicalBase64Key(environment.MFA_ENCRYPTION_KEY)) {
    capabilities.push(
      capability("mfa_secrets", "AES-256-GCM", "active", "encryption"),
    );
  } else if (environment.MFA_ENCRYPTION_KEY?.trim() || productionLike) {
    capabilities.push(
      capability(
        "mfa_secrets",
        "AES-256-GCM",
        "invalid",
        "encryption",
        "MFA_KEY_INVALID",
      ),
    );
  } else {
    capabilities.push(
      capability("mfa_secrets", "AES-256-GCM", "active", "encryption"),
    );
  }

  try {
    resolveEmailQueueEncryptionKey(environment);
    capabilities.push(
      capability("email_queue", "AES-256-GCM", "active", "encryption"),
    );
  } catch {
    capabilities.push(
      capability(
        "email_queue",
        "AES-256-GCM",
        "invalid",
        "encryption",
        "EMAIL_QUEUE_KEY_INVALID",
      ),
    );
  }

  try {
    const status = getPrivateContentEncryptionStatus(environment);
    capabilities.push(
      capability(
        "private_content",
        "XChaCha20-Poly1305",
        status.enabled ? "active" : "disabled",
        "encryption",
      ),
    );
  } catch {
    capabilities.push(
      capability(
        "private_content",
        "XChaCha20-Poly1305",
        "invalid",
        "encryption",
        "PRIVATE_CONTENT_CONFIGURATION_INVALID",
      ),
    );
  }

  try {
    getManagerConnectionCryptoStatus(environment);
    capabilities.push(
      capability(
        "manager_connections",
        "XChaCha20-Poly1305 authenticated envelopes",
        "active",
        "encryption",
      ),
    );
  } catch {
    capabilities.push(
      capability(
        "manager_connections",
        "XChaCha20-Poly1305 authenticated envelopes",
        "invalid",
        "encryption",
        "MANAGER_CONNECTION_KEY_INVALID",
      ),
    );
  }

  capabilities.push(
    capability(
      "e2ee_relay",
      "Signal-compatible opaque envelopes",
      "client_managed",
      "client",
    ),
  );

  const backupRecipient = environment.UMBRAVIA_BACKUP_AGE_RECIPIENT?.trim();
  capabilities.push(
    backupRecipient
      ? capability(
          "encrypted_backups",
          "age",
          /^(age1|age1pq1).+/.test(backupRecipient) ? "active" : "invalid",
          "deployment",
          /^(age1|age1pq1).+/.test(backupRecipient)
            ? null
            : "BACKUP_RECIPIENT_INVALID",
        )
      : capability("encrypted_backups", "age", "disabled", "deployment"),
  );

  let transportState: EncryptionCapabilityState = "external";
  let transportIssue: string | null = null;
  const origins = (environment.CLIENT_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    productionLike &&
    (origins.length === 0 ||
      origins.some((origin) => !origin.startsWith("https://")))
  ) {
    transportState = "invalid";
    transportIssue = "TRANSPORT_ORIGIN_NOT_HTTPS";
  }
  capabilities.push(
    capability(
      "transport_security",
      "TLS 1.3 at trusted edge",
      transportState,
      "edge",
      transportIssue,
    ),
  );

  try {
    const emailDelivery = resolveEmailDeliveryConfiguration(environment);
    if (productionLike && emailDelivery === null) {
      const emailQueue = capabilities.find((item) => item.id === "email_queue");
      if (emailQueue && emailQueue.issueCode === null) {
        emailQueue.state = "invalid";
        emailQueue.issueCode = "EMAIL_TRANSPORT_MISSING";
      }
    }
  } catch {
    const emailQueue = capabilities.find((item) => item.id === "email_queue");
    if (emailQueue && emailQueue.issueCode === null) {
      emailQueue.state = "invalid";
      emailQueue.issueCode = "EMAIL_TRANSPORT_CONFIGURATION_INVALID";
    }
  }

  const findings = capabilities
    .filter((item) => item.state === "invalid")
    .map((item) => item.issueCode)
    .filter((code): code is string => code !== null);
  return {
    generatedAt: Date.now(),
    healthy: findings.length === 0,
    capabilities,
    findings,
  };
}

export function getEncryptionManagerOverview() {
  const audit = auditEncryptionConfiguration();
  return {
    ...audit,
    policy: {
      rawKeyMaterialExposed: false as const,
      automaticKeyRotationEnabled: false as const,
      keyChangesRequireExplicitOperatorAction: true as const,
    },
    coordination: getManagerCoordinationStatus(),
  };
}

export function getAccountDataProtectionOverview(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const audit = auditEncryptionConfiguration(environment);
  const visible = new Set<EncryptionCapability["id"]>([
    "password_hashing",
    "private_content",
    "e2ee_relay",
    "transport_security",
  ]);
  const capabilities = audit.capabilities
    .filter((item) => visible.has(item.id))
    .map(({ id, primitive, state }) => ({ id, primitive, state }));
  return {
    healthy: capabilities.every((item) => item.state !== "invalid"),
    capabilities,
  };
}

export async function runEncryptionManagerAudit() {
  return withCoordinatedManagerOperation(
    "encryption",
    "configuration-audit",
    ["encryption-files"],
    async () => {
      const audit = auditEncryptionConfiguration();
      publishManagerSignal(
        "encryption",
        audit.healthy ? "info" : "critical",
        audit.healthy ? "ENCRYPTION_AUDIT_PASSED" : "ENCRYPTION_AUDIT_FAILED",
        audit.healthy
          ? "Encryption configuration audit passed."
          : `Encryption configuration audit found ${audit.findings.length} invalid capability configuration(s).`,
      );
      return audit;
    },
  );
}

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { db } from "../db/client.js";
import {
  isProductionLike,
  resolveDeploymentProfile,
} from "../lib/deployment-profile.js";
import {
  resolveSupportEmailInboundConfiguration,
  SupportEmailConfigurationError,
} from "../lib/support-email-inbound.js";
import {
  maintainEmailDeliveryQueue,
  resolveEmailDeliveryConfiguration,
  resolveEmailQueueEncryptionKey,
} from "./email-delivery.js";
import {
  getManagerCoordinationStatus,
  publishManagerSignal,
  transferManagerConnectionPayload,
  withPrioritizedManagerOperation,
  type ManagerId,
} from "./manager-coordinator.js";

type ReadinessState = "configured" | "disabled" | "missing" | "invalid";

export const EMAIL_HISTORY_SANITIZATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_HISTORY_SANITIZATION_EVENT = "email_delivery_history_sanitized";
const EMAIL_HISTORY_SANITIZATION_VERSION = 2;

interface EmailManagerReadiness {
  healthy: boolean;
  productionLike: boolean;
  outbound: {
    state: ReadinessState;
    mode: "direct_mx" | "local_mta" | "remote_relay" | "unconfigured";
    tls:
      | "local_transport"
      | "implicit"
      | "starttls"
      | "required_starttls"
      | "unconfigured";
    authenticated: boolean;
  };
  queueProtection: {
    state: "configured" | "development_fallback" | "missing" | "invalid";
  };
  inbound: {
    state: ReadinessState;
    provider: "cloudflare" | "unconfigured";
    supportAddressConfigured: boolean;
  };
  capabilities: {
    accountVerification: boolean;
    accountRecovery: boolean;
    supportNotifications: boolean;
    supportInbound: boolean;
    supportReplies: boolean;
  };
  confirmations: string[];
  alerts: string[];
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function getEmailManagerReadiness(
  environment: NodeJS.ProcessEnv = process.env,
): EmailManagerReadiness {
  const profile = resolveDeploymentProfile(environment);
  const productionLike = isProductionLike(profile);
  const confirmations: string[] = [];
  const alerts: string[] = [];

  let outbound: EmailManagerReadiness["outbound"] = {
    state: "missing",
    mode: "unconfigured",
    tls: "unconfigured",
    authenticated: false,
  };
  try {
    const configuration = resolveEmailDeliveryConfiguration(environment);
    if (configuration) {
      if (configuration.mode === "direct_mx") {
        outbound = {
          state: "configured",
          mode: "direct_mx",
          tls: "required_starttls",
          authenticated: false,
        };
        confirmations.push("direct_mx_transport_configured");
      } else {
        const local = isLoopbackHost(configuration.host);
        outbound = {
          state: "configured",
          mode: local ? "local_mta" : "remote_relay",
          tls: local
            ? "local_transport"
            : configuration.secure
              ? "implicit"
              : "starttls",
          authenticated: Boolean(configuration.user),
        };
      }
      confirmations.push("outbound_transport_configured");
    } else if (productionLike) {
      alerts.push("outbound_transport_missing");
    }
  } catch {
    outbound = { ...outbound, state: "invalid" };
    alerts.push("outbound_transport_invalid");
  }

  let queueProtection: EmailManagerReadiness["queueProtection"];
  try {
    resolveEmailQueueEncryptionKey(environment);
    queueProtection = {
      state: environment.EMAIL_QUEUE_ENCRYPTION_KEY?.trim()
        ? "configured"
        : "development_fallback",
    };
    confirmations.push("queue_protection_available");
  } catch {
    queueProtection = {
      state: environment.EMAIL_QUEUE_ENCRYPTION_KEY?.trim()
        ? "invalid"
        : "missing",
    };
    alerts.push("queue_protection_unavailable");
  }

  let inbound: EmailManagerReadiness["inbound"] = {
    state: "disabled",
    provider: "unconfigured",
    supportAddressConfigured: false,
  };
  try {
    const configuration = resolveSupportEmailInboundConfiguration(environment);
    if (configuration) {
      inbound = {
        state: "configured",
        provider: "cloudflare",
        supportAddressConfigured: true,
      };
      confirmations.push("support_inbound_configured");
    }
  } catch (error) {
    inbound = {
      state: "invalid",
      provider:
        environment.EMAIL_PUBLIC_INBOUND_PROVIDER?.trim().toLowerCase() ===
        "cloudflare"
          ? "cloudflare"
          : "unconfigured",
      supportAddressConfigured: Boolean(
        environment.SUPPORT_EMAIL_ADDRESS?.trim(),
      ),
    };
    alerts.push(
      error instanceof SupportEmailConfigurationError
        ? "support_inbound_invalid"
        : "support_inbound_unavailable",
    );
  }

  const outboundAvailable = outbound.state === "configured";
  const queueAvailable =
    queueProtection.state === "configured" ||
    (!productionLike && queueProtection.state === "development_fallback");
  const inboundAvailable = inbound.state === "configured";
  const healthy =
    (!productionLike || outboundAvailable) &&
    queueAvailable &&
    inbound.state !== "invalid";

  return {
    healthy,
    productionLike,
    outbound,
    queueProtection,
    inbound,
    capabilities: {
      accountVerification: outboundAvailable && queueAvailable,
      accountRecovery: outboundAvailable && queueAvailable,
      supportNotifications: outboundAvailable && queueAvailable,
      supportInbound: inboundAvailable,
      supportReplies: outboundAvailable && queueAvailable && inboundAvailable,
    },
    confirmations,
    alerts,
  };
}

export function getManagedEmailChannelCapabilities(
  consumer: Extract<ManagerId, "account" | "support">,
) {
  return transferManagerConnectionPayload(
    consumer,
    "email",
    "channel-readiness",
    getEmailManagerReadiness().capabilities,
  );
}

export function getManagedEmailDeploymentReadiness() {
  return transferManagerConnectionPayload(
    "environment",
    "email",
    "deployment-readiness",
    getEmailManagerReadiness(),
  );
}

function safeFailureCode(value: string | null): string {
  return value && /^[a-z0-9_]{1,80}$/.test(value) ? value : "delivery_failed";
}

export async function getEmailManagerOverview() {
  const readiness = getEmailManagerReadiness();
  const [statusRows, kindRows, oldestPending, recentFailures] =
    await Promise.all([
      db
        .selectFrom("emailDeliveries")
        .select(["status", sql<number>`count(*)`.as("count")])
        .groupBy("status")
        .execute(),
      db
        .selectFrom("emailDeliveries")
        .select(["kind", sql<number>`count(*)`.as("count")])
        .groupBy("kind")
        .execute(),
      db
        .selectFrom("emailDeliveries")
        .select("createdAt")
        .where("status", "in", ["queued", "retry", "processing"])
        .orderBy("createdAt", "asc")
        .executeTakeFirst(),
      db
        .selectFrom("emailDeliveries")
        .select(["id", "kind", "status", "attempts", "lastError", "updatedAt"])
        .where("status", "=", "failed")
        .orderBy("updatedAt", "desc")
        .limit(10)
        .execute(),
    ]);

  return {
    generatedAt: Date.now(),
    mode: "manage-confirm-alert" as const,
    readiness,
    queue: {
      byStatus: Object.fromEntries(
        statusRows.map((row) => [row.status, Number(row.count)]),
      ),
      byKind: Object.fromEntries(
        kindRows.map((row) => [row.kind, Number(row.count)]),
      ),
      oldestPendingAt: oldestPending?.createdAt ?? null,
      recentFailures: recentFailures.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        attempts: row.attempts,
        errorCode: safeFailureCode(row.lastError),
        updatedAt: row.updatedAt,
      })),
    },
    ownership: {
      manager: "email" as const,
      scheduledBy: "resource" as const,
      alertsDistributedBy: "coordinator" as const,
      secretValuesExposed: false as const,
      configurationMutationEnabled: false as const,
    },
    coordination: getManagerCoordinationStatus("commercial"),
  };
}

export async function runEmailManagerAudit() {
  return withPrioritizedManagerOperation(
    "email",
    "commercial",
    "email-readiness-audit",
    ["notification-delivery", "support-email-ingress"],
    "normal",
    "observation",
    async () => {
      const readiness = getEmailManagerReadiness();
      publishManagerSignal(
        "email",
        "commercial",
        readiness.healthy ? "info" : "warning",
        readiness.healthy
          ? "EMAIL_MANAGER_AUDIT_CONFIRMED"
          : "EMAIL_MANAGER_AUDIT_ALERT",
        readiness.healthy
          ? "The email manager confirmed that the configured channels are ready."
          : `The email manager found ${readiness.alerts.length} readiness alert(s).`,
      );
      return { checkedAt: Date.now(), ...readiness };
    },
  );
}

// The resource manager owns scheduling and already coordinates this scope.
// Keeping this function uncoordinated avoids a nested self-conflict.
export async function maintainManagedEmailQueue() {
  const command = transferManagerConnectionPayload(
    "resource",
    "email",
    "scheduled-maintenance",
    { operation: "maintain-email-queue" as const },
  );
  if (command.operation !== "maintain-email-queue") {
    throw new Error("The coordinated email maintenance command is invalid");
  }
  return maintainEmailDeliveryQueue();
}

export async function runEmailManagerMaintenance() {
  return withPrioritizedManagerOperation(
    "email",
    "commercial",
    "email-queue-maintenance",
    ["notification-delivery"],
    "high",
    "transactional",
    async () => {
      const result = await maintainEmailDeliveryQueue();
      publishManagerSignal(
        "email",
        "commercial",
        "info",
        "EMAIL_MANAGER_MAINTENANCE_CONFIRMED",
        "The email manager completed queue maintenance and reported its result.",
      );
      return { completedAt: Date.now(), ...result };
    },
  );
}

export async function getEmailHistorySanitizationDelayMs(
  now = Date.now(),
): Promise<number> {
  const lastRun = await db
    .selectFrom("securityEvents")
    .select(["createdAt", "metadata"])
    .where("type", "=", EMAIL_HISTORY_SANITIZATION_EVENT)
    .orderBy("createdAt", "desc")
    .executeTakeFirst();
  if (!lastRun) return 0;

  try {
    const metadata = JSON.parse(lastRun.metadata) as {
      sanitizationVersion?: number;
    };
    if (metadata.sanitizationVersion !== EMAIL_HISTORY_SANITIZATION_VERSION) {
      return 0;
    }
  } catch {
    return 0;
  }

  return Math.max(
    0,
    lastRun.createdAt + EMAIL_HISTORY_SANITIZATION_INTERVAL_MS - now,
  );
}

export async function sanitizeManagedEmailHistory(now = Date.now()): Promise<{
  count: number;
  summary: string;
}> {
  const command = transferManagerConnectionPayload(
    "resource",
    "email",
    "scheduled-maintenance",
    { operation: "sanitize-terminal-email-history" as const },
  );
  if (command.operation !== "sanitize-terminal-email-history") {
    throw new Error("The coordinated email sanitization command is invalid");
  }

  const result = await db.transaction().execute(async (transaction) => {
    const sanitized = await transaction
      .updateTable("emailDeliveries")
      .set({
        userId: null,
        recipient: "",
        locale: "",
        payloadEncrypted: "",
        nextAttemptAt: 0,
        messageId: null,
        expiresAt: 0,
      })
      .where("status", "in", ["sent", "failed", "superseded"])
      .where((expression) =>
        expression.or([
          expression("userId", "is not", null),
          expression("recipient", "!=", ""),
          expression("locale", "!=", ""),
          expression("payloadEncrypted", "!=", ""),
          expression("nextAttemptAt", "!=", 0),
          expression("messageId", "is not", null),
          expression("expiresAt", "!=", 0),
        ]),
      )
      .executeTakeFirst();
    const count = Number(sanitized.numUpdatedRows);
    await transaction
      .insertInto("securityEvents")
      .values({
        id: `email-history-sanitization-${randomUUID()}`,
        userId: null,
        type: EMAIL_HISTORY_SANITIZATION_EVENT,
        createdAt: now,
        metadata: JSON.stringify({
          sanitizedRecords: count,
          intervalDays: 30,
          sanitizationVersion: EMAIL_HISTORY_SANITIZATION_VERSION,
        }),
      })
      .execute();
    return count;
  });

  publishManagerSignal(
    "email",
    "commercial",
    "info",
    "EMAIL_HISTORY_SANITIZATION_CONFIRMED",
    `${result} terminal email record(s) were stripped of recipient, encrypted content and identifying delivery metadata.`,
  );
  return {
    count: result,
    summary: `${result} terminal email record(s) sanitized; the next review is due in 30 days.`,
  };
}

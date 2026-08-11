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
  withCoordinatedManagerOperation,
  type ManagerId,
} from "./manager-coordinator.js";

type ReadinessState = "configured" | "disabled" | "missing" | "invalid";

interface EmailManagerReadiness {
  healthy: boolean;
  productionLike: boolean;
  outbound: {
    state: ReadinessState;
    mode: "local_mta" | "remote_relay" | "unconfigured";
    tls: "local_transport" | "implicit" | "starttls" | "unconfigured";
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
    coordination: getManagerCoordinationStatus(),
  };
}

export async function runEmailManagerAudit() {
  return withCoordinatedManagerOperation(
    "email",
    "email-readiness-audit",
    ["notification-delivery", "support-email-ingress"],
    async () => {
      const readiness = getEmailManagerReadiness();
      publishManagerSignal(
        "email",
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
  return withCoordinatedManagerOperation(
    "email",
    "email-queue-maintenance",
    ["notification-delivery"],
    async () => {
      const result = await maintainEmailDeliveryQueue();
      publishManagerSignal(
        "email",
        "info",
        "EMAIL_MANAGER_MAINTENANCE_CONFIRMED",
        "The email manager completed queue maintenance and reported its result.",
      );
      return { completedAt: Date.now(), ...result };
    },
  );
}

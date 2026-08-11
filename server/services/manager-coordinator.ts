import { randomBytes } from "node:crypto";
import {
  getManagerConnectionCryptoStatus,
  protectManagerConnectionPayload,
  revealManagerConnectionPayload,
} from "../lib/manager-connection-crypto.js";

export type ManagerId =
  | "account"
  | "security"
  | "resource"
  | "encryption"
  | "environment"
  | "email"
  | "notification"
  | "support";
export type ManagerSignalSeverity = "info" | "warning" | "critical";
export type ProtectedManagerScope = "security-files" | "encryption-files";
export type ManagerConnectionCapability =
  "channel-readiness" | "deployment-readiness" | "scheduled-maintenance";

interface ActiveManagerOperation {
  id: string;
  manager: ManagerId;
  operation: string;
  scopes: string[];
  startedAt: number;
}

interface ManagerSignal {
  id: string;
  source: ManagerId;
  severity: ManagerSignalSeverity;
  code: string;
  messageEncrypted: string;
  createdAt: number;
}

const activeOperations = new Map<string, ActiveManagerOperation>();
const signals: ManagerSignal[] = [];
const MAX_SIGNALS = 50;
const MAX_SIGNAL_MESSAGE_LENGTH = 500;
const protectedScopeOwners: Readonly<Record<ProtectedManagerScope, ManagerId>> =
  {
    "security-files": "security",
    "encryption-files": "encryption",
  };
const forbiddenScopes = new Set([
  "sensitive-files",
  "secret-values",
  "raw-key-material",
]);

const managedConnections = [
  {
    consumer: "account",
    provider: "email",
    capability: "channel-readiness",
    mode: "read-only",
    scopes: ["notification-delivery"],
  },
  {
    consumer: "support",
    provider: "email",
    capability: "channel-readiness",
    mode: "read-only",
    scopes: ["notification-delivery", "support-email-ingress"],
  },
  {
    consumer: "environment",
    provider: "email",
    capability: "deployment-readiness",
    mode: "read-only",
    scopes: ["notification-delivery", "support-email-ingress"],
  },
  {
    consumer: "resource",
    provider: "email",
    capability: "scheduled-maintenance",
    mode: "delegated-run",
    scopes: ["notification-delivery"],
  },
] as const satisfies readonly {
  consumer: ManagerId;
  provider: ManagerId;
  capability: ManagerConnectionCapability;
  mode: "read-only" | "delegated-run";
  scopes: readonly string[];
}[];

export class ManagerCoordinationConflictError extends Error {
  readonly status = 409;
  readonly statusCode = 409;

  constructor(public readonly conflictingOperation: ActiveManagerOperation) {
    super("A coordinated manager operation is already using this scope");
    this.name = "ManagerCoordinationConflictError";
  }
}

export class ManagerAccessPolicyError extends Error {
  readonly status = 403;
  readonly statusCode = 403;
  readonly code = "MANAGER_ACCESS_DENIED";

  constructor(
    public readonly manager: ManagerId,
    public readonly scope: string,
  ) {
    super("The manager is not authorized to use this protected scope");
    this.name = "ManagerAccessPolicyError";
  }
}

export class ManagerConnectionPolicyError extends Error {
  readonly status = 403;
  readonly statusCode = 403;
  readonly code = "MANAGER_CONNECTION_DENIED";

  constructor(
    public readonly consumer: ManagerId,
    public readonly provider: ManagerId,
    public readonly capability: ManagerConnectionCapability,
  ) {
    super("The requested manager connection is not registered");
    this.name = "ManagerConnectionPolicyError";
  }
}

export function requireManagerConnection(
  consumer: ManagerId,
  provider: ManagerId,
  capability: ManagerConnectionCapability,
) {
  const connection = managedConnections.find(
    (candidate) =>
      candidate.consumer === consumer &&
      candidate.provider === provider &&
      candidate.capability === capability,
  );
  if (!connection) {
    throw new ManagerConnectionPolicyError(consumer, provider, capability);
  }
  assertManagerScopeAccess(consumer, [...connection.scopes]);
  assertManagerScopeAccess(provider, [...connection.scopes]);
  return {
    ...connection,
    scopes: [...connection.scopes],
    compatible: true as const,
  };
}

export function transferManagerConnectionPayload<T>(
  consumer: ManagerId,
  provider: ManagerId,
  capability: ManagerConnectionCapability,
  payload: T,
): T {
  requireManagerConnection(consumer, provider, capability);
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("A manager connection payload must be JSON serializable");
  }
  const context = `manager-connection:${consumer}:${provider}:${capability}`;
  const envelope = protectManagerConnectionPayload(
    Buffer.from(serialized, "utf8"),
    context,
  );
  return JSON.parse(
    revealManagerConnectionPayload(envelope, context).toString("utf8"),
  ) as T;
}

function assertManagerScopeAccess(manager: ManagerId, scopes: string[]): void {
  for (const scope of scopes) {
    if (
      forbiddenScopes.has(scope) ||
      scope.startsWith("file:") ||
      scope.includes("/") ||
      scope.includes("\\")
    ) {
      throw new ManagerAccessPolicyError(manager, scope);
    }
    const owner = protectedScopeOwners[scope as ProtectedManagerScope];
    if (owner && owner !== manager) {
      throw new ManagerAccessPolicyError(manager, scope);
    }
  }
}

function sanitizeManagerSignalMessage(message: string): string {
  return message
    .replace(
      /-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:secret|password|token|api[-_ ]?key|private[-_ ]?key|encryption[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED]",
    )
    .replace(/[\r\n]+/g, " ")
    .slice(0, MAX_SIGNAL_MESSAGE_LENGTH);
}

export function publishManagerSignal(
  source: ManagerId,
  severity: ManagerSignalSeverity,
  code: string,
  message: string,
): void {
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(code)) {
    throw new Error("Manager signal codes must be stable public identifiers");
  }
  const id = `manager-signal-${randomBytes(8).toString("hex")}`;
  const sanitizedMessage = sanitizeManagerSignalMessage(message);
  signals.unshift({
    id,
    source,
    severity,
    code,
    messageEncrypted: protectManagerConnectionPayload(
      Buffer.from(sanitizedMessage, "utf8"),
      `manager-signal:${source}:${id}`,
    ),
    createdAt: Date.now(),
  });
  if (signals.length > MAX_SIGNALS) signals.length = MAX_SIGNALS;
}

export async function withCoordinatedManagerOperation<T>(
  manager: ManagerId,
  operation: string,
  scopes: string[],
  run: () => Promise<T>,
): Promise<T> {
  const normalizedOperation = operation.trim();
  const normalizedScopes = [
    ...new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  ];
  if (!normalizedOperation) {
    throw new Error("A coordinated manager operation requires a name");
  }
  if (normalizedScopes.length === 0) {
    throw new Error(
      "A coordinated manager operation requires at least one scope",
    );
  }
  assertManagerScopeAccess(manager, normalizedScopes);
  const conflict = [...activeOperations.values()].find((active) =>
    active.scopes.some((scope) => normalizedScopes.includes(scope)),
  );
  if (conflict) throw new ManagerCoordinationConflictError(conflict);

  const active: ActiveManagerOperation = {
    id: `manager-operation-${randomBytes(8).toString("hex")}`,
    manager,
    operation: normalizedOperation,
    scopes: normalizedScopes,
    startedAt: Date.now(),
  };
  activeOperations.set(active.id, active);
  try {
    return await run();
  } finally {
    activeOperations.delete(active.id);
  }
}

export function getManagerCoordinationStatus() {
  return {
    mode: "shared-runtime" as const,
    managers: [
      "account",
      "security",
      "resource",
      "encryption",
      "environment",
      "email",
      "notification",
      "support",
    ] as const,
    activeOperations: [...activeOperations.values()].map((operation) => ({
      ...operation,
      scopes: [...operation.scopes],
    })),
    recentSignals: signals.slice(0, 20).map((signal) => {
      let message = "Encrypted manager signal unavailable.";
      try {
        message = revealManagerConnectionPayload(
          signal.messageEncrypted,
          `manager-signal:${signal.source}:${signal.id}`,
        ).toString("utf8");
      } catch {
        // A removed rotation key must not expose the encrypted envelope.
      }
      return {
        id: signal.id,
        source: signal.source,
        severity: signal.severity,
        code: signal.code,
        message,
        createdAt: signal.createdAt,
      };
    }),
    connections: managedConnections.map((connection) => ({
      ...connection,
      scopes: [...connection.scopes],
      compatible: true as const,
    })),
    accessPolicy: {
      defaultSensitiveFileAccess: "denied" as const,
      rawSecretExposure: "denied" as const,
      protectedScopes: { ...protectedScopeOwners },
      keyChangesRequireExplicitOperatorAction: true as const,
    },
    connectionProtection: {
      ...getManagerConnectionCryptoStatus(),
      payloadsEncryptedInTransit: true as const,
      signalMessagesEncryptedAtRest: true as const,
    },
  };
}

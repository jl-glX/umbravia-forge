import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import type { CorporateManagerProfileId } from "../db/types.js";
import {
  recordSecurityEvent,
  type SecurityEventType,
} from "./security-events.js";
import { getManagerCoordinationStatus } from "./manager-coordinator.js";
import { getCryptographicMaterialReplacementOverview } from "./cryptographic-material-replacement-manager.js";
import { isPlatformOperator } from "./facility-context.js";

export const MANAGER_TERMINAL_CREDENTIAL_DURATION_MS = 5 * 60 * 1000;
export const MANAGER_TERMINAL_SESSION_DURATION_MS = 30 * 60 * 1000;
export const MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const MANAGER_TERMINAL_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const MANAGER_TERMINAL_HEARTBEAT_TIMEOUT_MS = 90 * 1000;
export type ManagerTerminalAccessMode = "internal" | "external";

export type CorporateConsoleProfileId =
  | "umbravia-forge"
  | CorporateManagerProfileId
  | "manager-cryptographic-material-replacement";

export interface CorporateConsoleAccess {
  enabled: boolean;
  authorityProfileId: CorporateConsoleProfileId | null;
  profileIds: CorporateManagerProfileId[];
  priority: number | null;
}

interface CorporateConsoleProfile {
  id: CorporateConsoleProfileId;
  label: string;
  priority: number;
  assignable: boolean;
  parentId: CorporateConsoleProfileId | null;
  managerId?: string;
  virtualPath: string;
}

export const corporateConsoleProfiles: readonly CorporateConsoleProfile[] = [
  {
    id: "umbravia-forge",
    label: "umbravia-forge",
    priority: 0,
    assignable: false,
    parentId: null,
    virtualPath: "/umbravia-forge",
  },
  {
    id: "manager-core",
    label: "Nucleo de gestores",
    priority: 1,
    assignable: true,
    parentId: "umbravia-forge",
    virtualPath: "/umbravia-forge/manager-core",
  },
  {
    id: "manager-coordinator",
    label: "Coordinador de gestores",
    priority: 2,
    assignable: true,
    parentId: "manager-core",
    virtualPath: "/umbravia-forge/manager-core/manager-coordinator",
  },
  {
    id: "manager-flow-administrator",
    label: "Administrador de flujo del nucleo",
    priority: 3,
    assignable: true,
    parentId: "manager-coordinator",
    virtualPath:
      "/umbravia-forge/manager-core/manager-coordinator/manager-flow-administrator",
  },
  ...(
    [
      ["manager-account", "Gestor de cuentas", "account"],
      ["manager-security", "Gestor de seguridad", "security"],
      ["manager-resource", "Gestor de recursos", "resource"],
      ["manager-encryption", "Gestor de cifrado", "encryption"],
      ["manager-environment", "Gestor de entornos", "environment"],
      ["manager-email", "Gestor de correo", "email"],
      ["manager-notification", "Gestor de notificaciones", "notification"],
      ["manager-support", "Gestor de soporte", "support"],
    ] as const
  ).map(([id, label, managerId]) => ({
    id,
    label,
    priority: 4,
    assignable: true,
    parentId: "manager-flow-administrator" as const,
    managerId,
    virtualPath: `/umbravia-forge/manager-core/manager-coordinator/manager-flow-administrator/${id}`,
  })),
  {
    id: "manager-cryptographic-material-replacement",
    label: "Gestor auxiliar de sustitucion de material criptografico",
    priority: 4,
    assignable: false,
    parentId: "manager-encryption",
    managerId: "encryption",
    virtualPath:
      "/umbravia-forge/manager-core/manager-coordinator/manager-flow-administrator/manager-encryption/manager-cryptographic-material-replacement",
  },
] as const;

const assignmentProfileIds = new Set<CorporateManagerProfileId>(
  corporateConsoleProfiles
    .filter((profile) => profile.assignable)
    .map((profile) => profile.id as CorporateManagerProfileId),
);

export class ManagerConsolePolicyError extends Error {
  readonly status = 403;
  readonly statusCode = 403;
  readonly code = "MANAGER_CONSOLE_DENIED";

  constructor(message = "Corporate manager console access is denied") {
    super(message);
    this.name = "ManagerConsolePolicyError";
  }
}

export class ManagerConsoleCommandError extends Error {
  readonly status = 400;
  readonly statusCode = 400;
  readonly code = "MANAGER_CONSOLE_COMMAND_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ManagerConsoleCommandError";
  }
}

export class ManagerTerminalCredentialError extends Error {
  readonly status = 401;
  readonly statusCode = 401;
  readonly code = "MANAGER_TERMINAL_CREDENTIAL_INVALID";

  constructor(message = "The terminal credential is invalid or expired") {
    super(message);
    this.name = "ManagerTerminalCredentialError";
  }
}

function hashTerminalToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function issueManagerTerminalCredential(input: {
  userId: string;
  platformOperator?: boolean;
  accessMode: ManagerTerminalAccessMode;
}) {
  const access = await getCorporateConsoleAccess(
    input.userId,
    input.platformOperator,
  );
  if (!access.enabled) throw new ManagerConsolePolicyError();

  const now = Date.now();
  const internal = input.accessMode === "internal";
  const credential = `${internal ? "ufi" : "ufx"}_${randomBytes(24).toString("base64url")}`;
  const credentialHash = hashTerminalToken(credential);
  await db
    .updateTable("managerTerminalAccess")
    .set({ revokedAt: now })
    .where("userId", "=", input.userId)
    .where("accessMode", "=", input.accessMode)
    .where("revokedAt", "is", null)
    .execute();
  await db
    .insertInto("managerTerminalAccess")
    .values({
      id: `manager-terminal-${randomBytes(12).toString("hex")}`,
      userId: input.userId,
      accessMode: input.accessMode,
      credentialHash,
      terminalSessionHash: internal ? credentialHash : null,
      createdAt: now,
      expiresAt: internal
        ? null
        : now + MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      consumedAt: internal ? now : null,
      terminalSessionExpiresAt: null,
      revokedAt: null,
    })
    .execute();
  await recordSecurityEvent(
    "manager_terminal_credential_issued" as SecurityEventType,
    input.userId,
    {
      accessMode: input.accessMode,
      expiresAt: internal ? 0 : now + MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
    },
  );
  return {
    credential,
    accessMode: input.accessMode,
    expiresAt: internal ? null : now + MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
    idleTimeoutMs: internal ? MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS : null,
    singleUse: !internal,
  };
}

export async function exchangeManagerTerminalCredential(
  credential: string,
  requestedChannel: ManagerTerminalAccessMode,
) {
  const normalized = credential.trim();
  if (/^ufi_[A-Za-z0-9_-]{32}$/.test(normalized)) {
    if (requestedChannel !== "internal") {
      throw new ManagerTerminalCredentialError();
    }
    const identity = await authenticateManagerTerminalSession(
      normalized,
      "internal",
    );
    const access = await getCorporateConsoleAccess(
      identity.userId,
      identity.platformOperator,
    );
    return {
      terminalSessionToken: normalized,
      accessMode: "internal" as const,
      expiresAt: null,
      idleTimeoutMs: MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS,
      prompt: `${access.authorityProfileId}@umbravia-forge:$`,
    };
  }
  if (
    requestedChannel !== "external" ||
    !/^ufx_[A-Za-z0-9_-]{32}$/.test(normalized)
  ) {
    throw new ManagerTerminalCredentialError();
  }
  const now = Date.now();
  const credentialHash = hashTerminalToken(normalized);
  const terminalSessionToken = `ufs_${randomBytes(32).toString("base64url")}`;
  const terminalSessionHash = hashTerminalToken(terminalSessionToken);

  const record = await db.transaction().execute(async (transaction) => {
    const candidate = await transaction
      .selectFrom("managerTerminalAccess")
      .innerJoin("users", "users.id", "managerTerminalAccess.userId")
      .select([
        "managerTerminalAccess.id",
        "managerTerminalAccess.userId",
        "users.accountStatus",
      ])
      .where("managerTerminalAccess.accessMode", "=", "external")
      .where("managerTerminalAccess.credentialHash", "=", credentialHash)
      .where("managerTerminalAccess.consumedAt", "is", null)
      .where("managerTerminalAccess.revokedAt", "is", null)
      .where("managerTerminalAccess.expiresAt", ">", now)
      .executeTakeFirst();
    if (!candidate || candidate.accountStatus !== "active") return null;
    const updated = await transaction
      .updateTable("managerTerminalAccess")
      .set({
        consumedAt: now,
        terminalSessionHash,
        lastActivityAt: now,
        lastHeartbeatAt: now,
        terminalSessionExpiresAt: now + MANAGER_TERMINAL_SESSION_DURATION_MS,
      })
      .where("id", "=", candidate.id)
      .where("consumedAt", "is", null)
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1 ? candidate : null;
  });
  if (!record) throw new ManagerTerminalCredentialError();

  const platformOperator = await isPlatformOperator(record.userId);
  const access = await getCorporateConsoleAccess(
    record.userId,
    platformOperator,
  );
  if (!access.enabled) throw new ManagerTerminalCredentialError();
  await recordSecurityEvent(
    "manager_terminal_session_opened" as SecurityEventType,
    record.userId,
    {
      expiresAt: now + MANAGER_TERMINAL_SESSION_DURATION_MS,
    },
  );
  return {
    terminalSessionToken,
    accessMode: "external" as const,
    expiresAt: now + MANAGER_TERMINAL_SESSION_DURATION_MS,
    idleTimeoutMs: null,
    prompt: `${access.authorityProfileId}@umbravia-forge:$`,
  };
}

export async function authenticateManagerTerminalSession(
  terminalSessionToken: string,
  requestedChannel: ManagerTerminalAccessMode,
  activity: "user" | "heartbeat" = "user",
) {
  const normalized = terminalSessionToken.trim();
  const internal = /^ufi_[A-Za-z0-9_-]{32}$/.test(normalized);
  const external = /^ufs_[A-Za-z0-9_-]{43}$/.test(normalized);
  if (
    (!internal && !external) ||
    (internal && requestedChannel !== "internal") ||
    (external && requestedChannel !== "external")
  ) {
    throw new ManagerTerminalCredentialError();
  }
  const now = Date.now();
  let query = db
    .selectFrom("managerTerminalAccess")
    .innerJoin("users", "users.id", "managerTerminalAccess.userId")
    .select([
      "managerTerminalAccess.userId",
      "managerTerminalAccess.id",
      "managerTerminalAccess.accessMode",
      "managerTerminalAccess.lastActivityAt",
      "managerTerminalAccess.lastHeartbeatAt",
      "users.accountStatus",
    ])
    .where("managerTerminalAccess.accessMode", "=", requestedChannel)
    .where("managerTerminalAccess.consumedAt", "is not", null)
    .where("managerTerminalAccess.revokedAt", "is", null)
    .where(
      "managerTerminalAccess.lastHeartbeatAt",
      ">",
      now - MANAGER_TERMINAL_HEARTBEAT_TIMEOUT_MS,
    );
  query = internal
    ? query
        .where(
          "managerTerminalAccess.credentialHash",
          "=",
          hashTerminalToken(normalized),
        )
        .where(
          "managerTerminalAccess.lastActivityAt",
          ">",
          now - MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS,
        )
    : query
        .where(
          "managerTerminalAccess.terminalSessionHash",
          "=",
          hashTerminalToken(normalized),
        )
        .where("managerTerminalAccess.terminalSessionExpiresAt", ">", now);
  const record = await query.executeTakeFirst();
  if (!record) {
    const tokenHash = hashTerminalToken(normalized);
    let revokeQuery = db
      .updateTable("managerTerminalAccess")
      .set({ revokedAt: now })
      .where("accessMode", "=", requestedChannel)
      .where("revokedAt", "is", null);
    revokeQuery = internal
      ? revokeQuery.where("credentialHash", "=", tokenHash)
      : revokeQuery.where("terminalSessionHash", "=", tokenHash);
    await revokeQuery.execute();
    throw new ManagerTerminalCredentialError();
  }
  if (record.accountStatus !== "active") {
    await db
      .updateTable("managerTerminalAccess")
      .set({ revokedAt: now })
      .where("id", "=", record.id)
      .execute();
    throw new ManagerTerminalCredentialError();
  }
  const platformOperator = await isPlatformOperator(record.userId);
  const access = await getCorporateConsoleAccess(
    record.userId,
    platformOperator,
  );
  if (!access.enabled) {
    await db
      .updateTable("managerTerminalAccess")
      .set({ revokedAt: now })
      .where("id", "=", record.id)
      .execute();
    throw new ManagerTerminalCredentialError();
  }
  await db
    .updateTable("managerTerminalAccess")
    .set({
      lastActivityAt: activity === "user" ? now : record.lastActivityAt,
      lastHeartbeatAt: now,
    })
    .where("id", "=", record.id)
    .execute();
  return { userId: record.userId, platformOperator };
}

export function authenticateManagerTerminalHeartbeat(
  terminalSessionToken: string,
  requestedChannel: ManagerTerminalAccessMode,
) {
  return authenticateManagerTerminalSession(
    terminalSessionToken,
    requestedChannel,
    "heartbeat",
  );
}

export async function closeManagerTerminalSession(
  terminalSessionToken: string,
  requestedChannel: ManagerTerminalAccessMode,
) {
  const normalized = terminalSessionToken.trim();
  const internal = /^ufi_[A-Za-z0-9_-]{32}$/.test(normalized);
  const external = /^ufs_[A-Za-z0-9_-]{43}$/.test(normalized);
  if (
    (!internal && !external) ||
    (internal && requestedChannel !== "internal") ||
    (external && requestedChannel !== "external")
  ) {
    throw new ManagerTerminalCredentialError();
  }
  const tokenHash = hashTerminalToken(normalized);
  let query = db
    .updateTable("managerTerminalAccess")
    .set({ revokedAt: Date.now() })
    .where("accessMode", "=", requestedChannel)
    .where("revokedAt", "is", null);
  query = internal
    ? query.where("credentialHash", "=", tokenHash)
    : query.where("terminalSessionHash", "=", tokenHash);
  const result = await query.returning("userId").executeTakeFirst();
  if (!result) throw new ManagerTerminalCredentialError();
  await recordSecurityEvent(
    "manager_terminal_session_closed" as SecurityEventType,
    result.userId,
    {
      accessMode: requestedChannel,
    },
  );
}

function profileById(id: CorporateConsoleProfileId) {
  return corporateConsoleProfiles.find((profile) => profile.id === id);
}

export async function getCorporateConsoleAccess(
  userId: string,
  platformOperator = false,
): Promise<CorporateConsoleAccess> {
  if (platformOperator) {
    return {
      enabled: true,
      authorityProfileId: "umbravia-forge",
      profileIds: [],
      priority: 0,
    };
  }
  const assignments = await db
    .selectFrom("corporateRoleAssignments")
    .select("profileId")
    .where("userId", "=", userId)
    .where("status", "=", "active")
    .execute();
  const profileIds = assignments.map((assignment) => assignment.profileId);
  const authority = profileIds
    .map((id) => profileById(id))
    .filter((profile): profile is CorporateConsoleProfile => Boolean(profile))
    .sort((left, right) => left.priority - right.priority)[0];
  return {
    enabled: Boolean(authority),
    authorityProfileId: authority?.id ?? null,
    profileIds,
    priority: authority?.priority ?? null,
  };
}

function canViewProfile(
  access: CorporateConsoleAccess,
  profile: CorporateConsoleProfile,
) {
  if (!access.enabled || access.priority === null) return false;
  if (access.priority === 0) return true;
  if (profile.id === "umbravia-forge") return true;
  if (access.priority <= 3) return profile.priority >= access.priority;
  if (access.profileIds.includes(profile.id as CorporateManagerProfileId)) {
    return true;
  }
  return (
    profile.id === "manager-cryptographic-material-replacement" &&
    access.profileIds.includes("manager-encryption")
  );
}

function assertCanManageProfile(
  access: CorporateConsoleAccess,
  profileId: string,
): asserts profileId is CorporateManagerProfileId {
  if (!assignmentProfileIds.has(profileId as CorporateManagerProfileId)) {
    throw new ManagerConsolePolicyError(
      "The requested corporate profile is not assignable",
    );
  }
  const profile = profileById(profileId as CorporateManagerProfileId)!;
  if (
    !access.enabled ||
    access.priority === null ||
    access.priority >= profile.priority
  ) {
    throw new ManagerConsolePolicyError(
      "The active profile cannot manage an equal or higher priority",
    );
  }
}

function assertSafeCommand(command: string) {
  const normalized = command.trim();
  if (!normalized || normalized.length > 240) {
    throw new ManagerConsoleCommandError("Command length is invalid");
  }
  if (
    /[|;&<>`\r\n]/.test(normalized) ||
    normalized.includes("$(") ||
    /(^|\s)(?:[A-Za-z]:\\|\\\\|\/(?:etc|proc|sys|dev|var|home|root)(?:\/|\s|$))/i.test(
      normalized,
    )
  ) {
    throw new ManagerConsoleCommandError(
      "Pipes, redirects, chaining and real system paths are not available",
    );
  }
  return normalized;
}

function visibleProfiles(access: CorporateConsoleAccess) {
  return corporateConsoleProfiles.filter((profile) =>
    canViewProfile(access, profile),
  );
}

export async function getManagerConsoleOverview(
  userId: string,
  platformOperator = false,
) {
  const access = await getCorporateConsoleAccess(userId, platformOperator);
  if (!access.enabled) throw new ManagerConsolePolicyError();
  const profiles = visibleProfiles(access);
  return {
    shell: "umbravia-sh",
    mode: "virtual-linux-command-set" as const,
    operatingSystemAccess: false as const,
    access,
    profiles,
    allowedCommands: [
      "help",
      "whoami",
      "pwd",
      "ls",
      "tree",
      "ps",
      "systemctl status",
      "getent group",
      "usermod -aG <profile> <user-id>",
      "gpasswd -d <user-id> <profile>",
      "clear",
      "exit",
    ],
    prompt: `${access.authorityProfileId}@umbravia-forge:$`,
  };
}

async function assignProfile(
  actorUserId: string,
  access: CorporateConsoleAccess,
  targetUserId: string,
  profileId: string,
) {
  assertCanManageProfile(access, profileId);
  const target = await db
    .selectFrom("users")
    .select("id")
    .where("id", "=", targetUserId)
    .executeTakeFirst();
  if (!target)
    throw new ManagerConsoleCommandError("Target user was not found");
  const existing = await db
    .selectFrom("corporateRoleAssignments")
    .select("id")
    .where("userId", "=", targetUserId)
    .where("profileId", "=", profileId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) return `${targetUserId} already belongs to ${profileId}`;
  const now = Date.now();
  await db
    .insertInto("corporateRoleAssignments")
    .values({
      id: `corporate-role-${randomBytes(12).toString("hex")}`,
      userId: targetUserId,
      profileId,
      assignedByUserId: actorUserId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .execute();
  await recordSecurityEvent(
    "corporate_role_assigned" as SecurityEventType,
    targetUserId,
    {
      profileId,
      assignedByUserId: actorUserId,
    },
  );
  return `added ${targetUserId} to ${profileId}`;
}

async function revokeProfile(
  actorUserId: string,
  access: CorporateConsoleAccess,
  targetUserId: string,
  profileId: string,
) {
  assertCanManageProfile(access, profileId);
  const now = Date.now();
  const result = await db
    .updateTable("corporateRoleAssignments")
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where("userId", "=", targetUserId)
    .where("profileId", "=", profileId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    return `${targetUserId} is not an active member of ${profileId}`;
  }
  await recordSecurityEvent(
    "corporate_role_revoked" as SecurityEventType,
    targetUserId,
    {
      profileId,
      revokedByUserId: actorUserId,
    },
  );
  return `removed ${targetUserId} from ${profileId}`;
}

export async function executeManagerConsoleCommand(input: {
  actorUserId: string;
  platformOperator?: boolean;
  command: string;
  contextProfileId?: string;
}) {
  const access = await getCorporateConsoleAccess(
    input.actorUserId,
    input.platformOperator,
  );
  if (!access.enabled) throw new ManagerConsolePolicyError();
  const command = assertSafeCommand(input.command);
  const profiles = visibleProfiles(access);
  const requestedContext = input.contextProfileId?.trim();
  const context = requestedContext
    ? profiles.find((profile) => profile.id === requestedContext)
    : profileById(access.authorityProfileId!);
  if (!context) {
    throw new ManagerConsolePolicyError(
      "The selected console branch is outside the active profile scope",
    );
  }
  let lines: string[];
  if (command === "help") {
    lines = (
      await getManagerConsoleOverview(input.actorUserId, input.platformOperator)
    ).allowedCommands.filter((item) => item !== "clear");
  } else if (command === "whoami") {
    lines = [
      `user=${input.actorUserId}`,
      `authority=${access.authorityProfileId}`,
      `priority=${access.priority}`,
    ];
  } else if (command === "pwd") {
    lines = [context.virtualPath];
  } else if (command === "ls") {
    lines = profiles
      .filter((profile) => profile.parentId === context.id)
      .map((profile) => profile.id);
  } else if (command === "tree") {
    lines = profiles.map(
      (profile) =>
        `${"  ".repeat(profile.priority)}${profile.id}${profile.assignable ? "" : " [read-only]"}`,
    );
  } else if (command === "ps") {
    const status = getManagerCoordinationStatus();
    lines = [
      `active=${status.managerCore.activeOperations.length}`,
      `queued=${status.managerCore.queuedOperations.length}`,
      ...status.managerCore.activeOperations.map(
        (operation) =>
          `${operation.id} ${operation.manager} ${operation.operation} ${operation.priority}`,
      ),
    ];
  } else if (command === "systemctl status") {
    const status = getManagerCoordinationStatus();
    lines = [
      "manager-core.service active (virtual)",
      "manager-coordinator.service active (virtual)",
      "control-channel=active",
      `control-priorities=${status.managerCore.highPriorityChannel.allowedPriorities.join(",")}`,
      "operating-system-access=denied",
    ];
  } else if (command === "getent group") {
    const assignments = await db
      .selectFrom("corporateRoleAssignments")
      .select(["userId", "profileId"])
      .where("status", "=", "active")
      .where(
        "profileId",
        "in",
        profiles
          .filter((profile) => profile.assignable)
          .map((profile) => profile.id as CorporateManagerProfileId),
      )
      .orderBy("profileId")
      .orderBy("userId")
      .execute();
    lines = assignments.map(
      (assignment) => `${assignment.profileId}:x:${assignment.userId}`,
    );
  } else if (command.startsWith("usermod ")) {
    const match = /^usermod\s+-aG\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)$/.exec(
      command,
    );
    if (!match) {
      throw new ManagerConsoleCommandError(
        "Usage: usermod -aG <profile> <user-id>",
      );
    }
    lines = [
      await assignProfile(input.actorUserId, access, match[2], match[1]),
    ];
  } else if (command.startsWith("gpasswd ")) {
    const match = /^gpasswd\s+-d\s+([A-Za-z0-9-]+)\s+([a-z0-9-]+)$/.exec(
      command,
    );
    if (!match) {
      throw new ManagerConsoleCommandError(
        "Usage: gpasswd -d <user-id> <profile>",
      );
    }
    lines = [
      await revokeProfile(input.actorUserId, access, match[1], match[2]),
    ];
  } else {
    throw new ManagerConsoleCommandError(
      `umbravia-sh: command not found: ${command.split(/\s+/)[0]}`,
    );
  }
  if (context.id === "manager-cryptographic-material-replacement") {
    const auxiliary = getCryptographicMaterialReplacementOverview();
    lines.push(`authority=${auxiliary.authority}`);
    lines.push(`mode=${auxiliary.mode}`);
  }
  return {
    command,
    contextProfileId: context.id,
    executedAt: Date.now(),
    lines: lines.length ? lines : ["(empty)"],
  };
}

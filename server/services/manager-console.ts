import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import type { CorporateManagerProfileId } from "../db/types.js";
import {
  recordSecurityEvent,
  type SecurityEventType,
} from "./security-events.js";
import {
  getManagerCoordinationStatus,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";
import { getCryptographicMaterialReplacementOverview } from "./cryptographic-material-replacement-manager.js";
import { isPlatformOperator } from "./facility-context.js";
import {
  destroyManagerTerminalSandbox,
  executeIsolatedManagerTerminalCommand,
  getManagerTerminalExecutionStatus,
} from "./manager-terminal-executor.js";
import {
  formatSupportDiagnosticProbeReport,
  runSupportDiagnosticProbe,
  type SupportDiagnosticProbeCheck,
} from "./support-diagnostic-probe.js";

export const MANAGER_TERMINAL_CREDENTIAL_DURATION_MS = 5 * 60 * 1000;
export const MANAGER_TERMINAL_SESSION_DURATION_MS = 30 * 60 * 1000;
export const MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const MANAGER_TERMINAL_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const MANAGER_TERMINAL_HEARTBEAT_TIMEOUT_MS = 90 * 1000;
export type ManagerTerminalAccessMode = "internal" | "external";
export type ManagerInternalAppDistribution =
  "microsoft-store" | "mac-app-store";

export type CorporateConsoleProfileId =
  | "umbravia-forge"
  | CorporateManagerProfileId
  | "manager-cryptographic-material-replacement";

export interface CorporateConsoleAccess {
  enabled: boolean;
  authorityProfileId: CorporateConsoleProfileId | null;
  profileIds: CorporateManagerProfileId[];
  priority: number | null;
  temporaryProfileIds?: CorporateManagerProfileId[];
  companyHead?: boolean;
  automaticProfileIds?: CorporateManagerProfileId[];
}

export interface ManagerTerminalSessionIdentity {
  userId: string;
  platformOperator: boolean;
  accessId: string;
  accessMode: ManagerTerminalAccessMode;
  scopeProfileId: CorporateConsoleProfileId | null;
  allowTemporaryPermissions: boolean;
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

async function listActiveTemporaryPermissions(
  userId: string,
  options: {
    accessMode?: ManagerTerminalAccessMode;
    unitId?: string | null;
    includeAnyUnit?: boolean;
  } = {},
) {
  const now = Date.now();
  let query = db
    .selectFrom("managerTemporaryPermissions")
    .selectAll()
    .where("userId", "=", userId)
    .where("status", "=", "active")
    .where("startsAt", "<=", now)
    .where("expiresAt", ">", now);
  if (options.accessMode) {
    query = query.where("accessMode", "in", [options.accessMode, "any"]);
  }
  if (!options.includeAnyUnit) {
    query = options.unitId
      ? query.where((expression) =>
          expression.or([
            expression("unitId", "is", null),
            expression("unitId", "=", options.unitId!),
          ]),
        )
      : query.where("unitId", "is", null);
  }
  return query.execute();
}

function accessFromProfiles(
  base: CorporateConsoleAccess,
  temporaryProfileIds: CorporateManagerProfileId[],
): CorporateConsoleAccess {
  if (base.priority === 0) return base;
  const profileIds = [...new Set([...base.profileIds, ...temporaryProfileIds])];
  const authority = profileIds
    .map((id) => profileById(id))
    .filter((profile): profile is CorporateConsoleProfile => Boolean(profile))
    .sort((left, right) => left.priority - right.priority)[0];
  return {
    ...base,
    enabled: Boolean(authority),
    authorityProfileId: authority?.id ?? null,
    profileIds,
    priority: authority?.priority ?? null,
    temporaryProfileIds,
  };
}

function applyCredentialScope(
  access: CorporateConsoleAccess,
  scopeProfileId: CorporateConsoleProfileId | null,
): CorporateConsoleAccess {
  if (!scopeProfileId) return access;
  const scope = profileById(scopeProfileId);
  if (!scope || !canViewProfile(access, scope)) {
    return {
      enabled: false,
      authorityProfileId: null,
      profileIds: [],
      priority: null,
      temporaryProfileIds: [],
    };
  }
  return {
    ...access,
    authorityProfileId: scope.id,
    priority: scope.priority,
    profileIds:
      scope.priority === 4 && scope.assignable
        ? [scope.id as CorporateManagerProfileId]
        : access.profileIds,
  };
}

async function resolveTerminalAccess(input: {
  userId: string;
  platformOperator?: boolean;
  accessMode: ManagerTerminalAccessMode;
  unitId?: string | null;
  includeAnyUnit?: boolean;
  scopeProfileId?: CorporateConsoleProfileId | null;
  allowTemporaryPermissions?: boolean;
}) {
  const base = await getCorporateConsoleAccess(
    input.userId,
    input.platformOperator,
  );
  const temporaryPermissions = input.allowTemporaryPermissions
    ? await listActiveTemporaryPermissions(input.userId, {
        accessMode: input.accessMode,
        unitId: input.unitId,
        includeAnyUnit: input.includeAnyUnit,
      })
    : [];
  const access = accessFromProfiles(
    base,
    temporaryPermissions.map((permission) => permission.profileId),
  );
  return {
    access: applyCredentialScope(access, input.scopeProfileId ?? null),
    temporaryPermissions,
  };
}

export async function getManagerCredentialOptions(
  userId: string,
  platformOperator = false,
) {
  const base = await getCorporateConsoleAccess(userId, platformOperator);
  const temporaryPermissions = await listActiveTemporaryPermissions(userId, {
    includeAnyUnit: true,
  });
  const potential = accessFromProfiles(
    base,
    temporaryPermissions.map((permission) => permission.profileId),
  );
  if (!potential.enabled) throw new ManagerConsolePolicyError();
  return {
    access: base,
    scopeProfiles: visibleProfiles(potential),
    hasTemporaryPermissions: temporaryPermissions.length > 0,
  };
}

export async function issueManagerTerminalCredential(input: {
  userId: string;
  platformOperator?: boolean;
  accessMode: ManagerTerminalAccessMode;
  scopeProfileId?: CorporateConsoleProfileId;
  allowTemporaryPermissions?: boolean;
  trustedInternalClient?: {
    distribution: ManagerInternalAppDistribution;
    attestationVerified: true;
  };
}) {
  if (
    input.accessMode === "internal" &&
    input.trustedInternalClient?.attestationVerified !== true
  ) {
    throw new ManagerConsolePolicyError(
      "Internal access requires an attested corporate desktop app",
    );
  }
  const baseAccess = await getCorporateConsoleAccess(
    input.userId,
    input.platformOperator,
  );
  const resolved = await resolveTerminalAccess({
    userId: input.userId,
    platformOperator: input.platformOperator,
    accessMode: input.accessMode,
    includeAnyUnit: true,
    allowTemporaryPermissions: input.allowTemporaryPermissions,
  });
  if (!resolved.access.enabled) throw new ManagerConsolePolicyError();
  const scopeProfileId =
    input.scopeProfileId ??
    resolved.access.authorityProfileId ??
    baseAccess.authorityProfileId;
  if (
    !scopeProfileId ||
    !visibleProfiles(resolved.access).some(
      (profile) => profile.id === scopeProfileId,
    )
  ) {
    throw new ManagerConsolePolicyError(
      "The credential scope exceeds the currently effective authority",
    );
  }

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
      scopeProfileId,
      allowTemporaryPermissions: input.allowTemporaryPermissions ? 1 : 0,
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
      scopeProfileId,
      allowTemporaryPermissions: Boolean(input.allowTemporaryPermissions),
      ...(input.trustedInternalClient
        ? { distribution: input.trustedInternalClient.distribution }
        : {}),
    },
  );
  return {
    credential,
    accessMode: input.accessMode,
    expiresAt: internal ? null : now + MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
    idleTimeoutMs: internal ? MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS : null,
    singleUse: !internal,
    scopeProfileId,
    allowTemporaryPermissions: Boolean(input.allowTemporaryPermissions),
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
    const resolved = await resolveTerminalAccess({
      userId: identity.userId,
      platformOperator: identity.platformOperator,
      accessMode: identity.accessMode,
      includeAnyUnit: true,
      scopeProfileId: identity.scopeProfileId,
      allowTemporaryPermissions: identity.allowTemporaryPermissions,
    });
    return {
      terminalSessionToken: normalized,
      accessMode: "internal" as const,
      expiresAt: null,
      idleTimeoutMs: MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS,
      prompt: `${resolved.access.authorityProfileId}@umbravia-forge:$`,
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
        "managerTerminalAccess.scopeProfileId",
        "managerTerminalAccess.allowTemporaryPermissions",
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
  const resolved = await resolveTerminalAccess({
    userId: record.userId,
    platformOperator,
    accessMode: "external",
    includeAnyUnit: true,
    scopeProfileId: record.scopeProfileId,
    allowTemporaryPermissions: Boolean(record.allowTemporaryPermissions),
  });
  if (!resolved.access.enabled) throw new ManagerTerminalCredentialError();
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
    prompt: `${resolved.access.authorityProfileId}@umbravia-forge:$`,
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
      "managerTerminalAccess.scopeProfileId",
      "managerTerminalAccess.allowTemporaryPermissions",
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
  const resolved = await resolveTerminalAccess({
    userId: record.userId,
    platformOperator,
    accessMode: requestedChannel,
    includeAnyUnit: true,
    scopeProfileId: record.scopeProfileId,
    allowTemporaryPermissions: Boolean(record.allowTemporaryPermissions),
  });
  if (!resolved.access.enabled) {
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
  return {
    userId: record.userId,
    platformOperator,
    accessId: record.id,
    accessMode: requestedChannel,
    scopeProfileId: record.scopeProfileId,
    allowTemporaryPermissions: Boolean(record.allowTemporaryPermissions),
  } satisfies ManagerTerminalSessionIdentity;
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
  const result = await query.returning(["id", "userId"]).executeTakeFirst();
  if (!result) throw new ManagerTerminalCredentialError();
  const workspaceSecured = await destroyManagerTerminalSandbox(result.id);
  await recordSecurityEvent(
    "manager_terminal_session_closed" as SecurityEventType,
    result.userId,
    {
      accessMode: requestedChannel,
      workspaceSecured,
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
    const companyHead = await db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("userId", "=", userId)
      .where("position", "=", "platform_head")
      .where("status", "=", "active")
      .executeTakeFirst();
    if (companyHead) {
      const [assignments, pendingDelegations] = await Promise.all([
        db
          .selectFrom("corporateRoleAssignments")
          .innerJoin(
            "companyStaffProfiles",
            "companyStaffProfiles.userId",
            "corporateRoleAssignments.userId",
          )
          .select([
            "corporateRoleAssignments.userId",
            "corporateRoleAssignments.profileId",
          ])
          .where("corporateRoleAssignments.status", "=", "active")
          .where("companyStaffProfiles.status", "=", "active")
          .execute(),
        db
          .selectFrom("corporateRoleDelegations")
          .innerJoin(
            "companyStaffProfiles",
            "companyStaffProfiles.userId",
            "corporateRoleDelegations.recipientUserId",
          )
          .innerJoin(
            "umfSupportStaff",
            "umfSupportStaff.userId",
            "corporateRoleDelegations.recipientUserId",
          )
          .select("corporateRoleDelegations.profileId")
          .where("corporateRoleDelegations.status", "=", "pending")
          .where("companyStaffProfiles.status", "=", "active")
          .where("umfSupportStaff.status", "=", "active")
          .execute(),
      ]);
      const delegated = new Set([
        ...assignments.map((assignment) => assignment.profileId),
        ...pendingDelegations.map((delegation) => delegation.profileId),
      ]);
      const explicit = new Set(
        assignments
          .filter((assignment) => assignment.userId === userId)
          .map((assignment) => assignment.profileId),
      );
      const automaticProfileIds = [...assignmentProfileIds].filter(
        (profileId) => !delegated.has(profileId),
      );
      const profileIds = [...new Set([...automaticProfileIds, ...explicit])];
      const authority = profileIds
        .map((id) => profileById(id))
        .filter((profile): profile is CorporateConsoleProfile =>
          Boolean(profile),
        )
        .sort((left, right) => left.priority - right.priority)[0];
      return {
        enabled: Boolean(authority),
        authorityProfileId: authority?.id ?? null,
        profileIds,
        priority: authority?.priority ?? null,
        companyHead: true,
        automaticProfileIds,
      };
    }
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
  if (access.companyHead) {
    if (
      profile.id === "manager-cryptographic-material-replacement" &&
      access.profileIds.includes("manager-encryption")
    ) {
      return true;
    }
    return access.profileIds.includes(profile.id as CorporateManagerProfileId);
  }
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
  if (access.companyHead) return;
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

function visibleProfiles(access: CorporateConsoleAccess) {
  return corporateConsoleProfiles.filter((profile) =>
    canViewProfile(access, profile),
  );
}

async function visibleOrganizationalUnits(
  userId: string,
  access: CorporateConsoleAccess,
) {
  if (access.priority !== null && access.priority <= 3) {
    return db
      .selectFrom("managerOrganizationalUnits")
      .select(["id", "slug", "name", "kind", "parentUnitId"])
      .where("status", "=", "active")
      .orderBy("kind")
      .orderBy("name")
      .execute();
  }
  return db
    .selectFrom("managerOrganizationalUnits")
    .innerJoin(
      "managerOrganizationalMemberships",
      "managerOrganizationalMemberships.unitId",
      "managerOrganizationalUnits.id",
    )
    .select([
      "managerOrganizationalUnits.id",
      "managerOrganizationalUnits.slug",
      "managerOrganizationalUnits.name",
      "managerOrganizationalUnits.kind",
      "managerOrganizationalUnits.parentUnitId",
    ])
    .where("managerOrganizationalUnits.status", "=", "active")
    .where("managerOrganizationalMemberships.userId", "=", userId)
    .where("managerOrganizationalMemberships.status", "=", "active")
    .orderBy("managerOrganizationalUnits.kind")
    .orderBy("managerOrganizationalUnits.name")
    .execute();
}

async function requireVisibleUnit(
  userId: string,
  access: CorporateConsoleAccess,
  unitId: string | null | undefined,
) {
  if (!unitId) return null;
  const units = await visibleOrganizationalUnits(userId, access);
  const unit = units.find(
    (candidate) => candidate.id === unitId || candidate.slug === unitId,
  );
  if (!unit) {
    throw new ManagerConsolePolicyError(
      "The selected organizational unit is outside the active scope",
    );
  }
  return unit;
}

function assertCanManageUnits(access: CorporateConsoleAccess) {
  if (access.priority === null || access.priority > 3) {
    throw new ManagerConsolePolicyError(
      "The active profile cannot manage organizational units",
    );
  }
}

async function createOrganizationalUnit(input: {
  actorUserId: string;
  access: CorporateConsoleAccess;
  kind: "department" | "workgroup";
  slug: string;
  name: string;
  parentSlug?: string;
}) {
  assertCanManageUnits(input.access);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug)) {
    throw new ManagerConsoleCommandError(
      "Unit slugs must contain 2-63 lowercase letters, numbers or hyphens",
    );
  }
  const parent = input.parentSlug
    ? await db
        .selectFrom("managerOrganizationalUnits")
        .select("id")
        .where("slug", "=", input.parentSlug)
        .where("status", "=", "active")
        .executeTakeFirst()
    : null;
  if (input.parentSlug && !parent) {
    throw new ManagerConsoleCommandError("Parent unit was not found");
  }
  const now = Date.now();
  await db
    .insertInto("managerOrganizationalUnits")
    .values({
      id: `manager-unit-${randomBytes(12).toString("hex")}`,
      slug: input.slug,
      name: input.name.slice(0, 120),
      kind: input.kind,
      parentUnitId: parent?.id ?? null,
      status: "active",
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await recordSecurityEvent(
    "manager_organizational_unit_created" as SecurityEventType,
    input.actorUserId,
    {
      kind: input.kind,
      slug: input.slug,
      ...(input.parentSlug ? { parentSlug: input.parentSlug } : {}),
    },
  );
  return `created ${input.kind} ${input.slug}`;
}

async function changeOrganizationalMembership(input: {
  actorUserId: string;
  access: CorporateConsoleAccess;
  unitSlug: string;
  targetUserId: string;
  membershipRole?: "lead" | "member";
  revoke?: boolean;
}) {
  assertCanManageUnits(input.access);
  const unit = await db
    .selectFrom("managerOrganizationalUnits")
    .select("id")
    .where("slug", "=", input.unitSlug)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!unit) throw new ManagerConsoleCommandError("Unit was not found");
  const target = await db
    .selectFrom("users")
    .select("id")
    .where("id", "=", input.targetUserId)
    .executeTakeFirst();
  if (!target)
    throw new ManagerConsoleCommandError("Target user was not found");
  const now = Date.now();
  if (input.revoke) {
    await db
      .updateTable("managerOrganizationalMemberships")
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where("unitId", "=", unit.id)
      .where("userId", "=", input.targetUserId)
      .where("status", "=", "active")
      .execute();
  } else {
    const active = await db
      .selectFrom("managerOrganizationalMemberships")
      .select("id")
      .where("unitId", "=", unit.id)
      .where("userId", "=", input.targetUserId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!active) {
      await db
        .insertInto("managerOrganizationalMemberships")
        .values({
          id: `manager-membership-${randomBytes(12).toString("hex")}`,
          unitId: unit.id,
          userId: input.targetUserId,
          membershipRole: input.membershipRole ?? "member",
          assignedByUserId: input.actorUserId,
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .execute();
    }
  }
  await recordSecurityEvent(
    (input.revoke
      ? "manager_organizational_membership_revoked"
      : "manager_organizational_membership_assigned") as SecurityEventType,
    input.targetUserId,
    { unitSlug: input.unitSlug, actorUserId: input.actorUserId },
  );
  return `${input.revoke ? "removed" : "added"} ${input.targetUserId} ${input.revoke ? "from" : "to"} ${input.unitSlug}`;
}

async function grantTemporaryPermission(input: {
  actorUserId: string;
  access: CorporateConsoleAccess;
  targetUserId: string;
  profileId: string;
  durationMinutes: number;
  accessMode: "internal" | "external" | "any";
  unitSlug?: string;
}) {
  assertCanManageProfile(input.access, input.profileId);
  if (
    !Number.isSafeInteger(input.durationMinutes) ||
    input.durationMinutes < 5 ||
    input.durationMinutes > 10_080
  ) {
    throw new ManagerConsoleCommandError(
      "Temporary permission duration must be between 5 and 10080 minutes",
    );
  }
  const target = await db
    .selectFrom("users")
    .select("id")
    .where("id", "=", input.targetUserId)
    .executeTakeFirst();
  if (!target)
    throw new ManagerConsoleCommandError("Target user was not found");
  const unit = input.unitSlug
    ? await db
        .selectFrom("managerOrganizationalUnits")
        .select("id")
        .where("slug", "=", input.unitSlug)
        .where("status", "=", "active")
        .executeTakeFirst()
    : null;
  if (input.unitSlug && !unit) {
    throw new ManagerConsoleCommandError("Unit was not found");
  }
  const now = Date.now();
  const expiresAt = now + input.durationMinutes * 60_000;
  const id = `manager-permission-${randomBytes(12).toString("hex")}`;
  await db
    .insertInto("managerTemporaryPermissions")
    .values({
      id,
      userId: input.targetUserId,
      profileId: input.profileId,
      unitId: unit?.id ?? null,
      accessMode: input.accessMode,
      grantedByUserId: input.actorUserId,
      status: "active",
      startsAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .execute();
  await recordSecurityEvent(
    "manager_temporary_permission_granted" as SecurityEventType,
    input.targetUserId,
    {
      permissionId: id,
      profileId: input.profileId,
      ...(input.unitSlug ? { unitSlug: input.unitSlug } : {}),
      accessMode: input.accessMode,
      expiresAt,
      grantedByUserId: input.actorUserId,
    },
  );
  return `granted ${input.profileId} to ${input.targetUserId} until ${new Date(expiresAt).toISOString()}`;
}

async function revokeTemporaryPermission(input: {
  actorUserId: string;
  access: CorporateConsoleAccess;
  permissionId: string;
}) {
  assertCanManageUnits(input.access);
  const now = Date.now();
  const permission = await db
    .updateTable("managerTemporaryPermissions")
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where("id", "=", input.permissionId)
    .where("status", "=", "active")
    .returning(["userId", "profileId"])
    .executeTakeFirst();
  if (!permission) {
    throw new ManagerConsoleCommandError("Temporary permission was not found");
  }
  await recordSecurityEvent(
    "manager_temporary_permission_revoked" as SecurityEventType,
    permission.userId,
    {
      permissionId: input.permissionId,
      profileId: permission.profileId,
      revokedByUserId: input.actorUserId,
    },
  );
  return `revoked ${input.permissionId}`;
}

export async function getManagerConsoleOverview(
  identity: ManagerTerminalSessionIdentity,
  contextUnitId?: string | null,
) {
  const initial = await resolveTerminalAccess({
    userId: identity.userId,
    platformOperator: identity.platformOperator,
    accessMode: identity.accessMode,
    unitId: contextUnitId,
    includeAnyUnit: !contextUnitId,
    scopeProfileId: identity.scopeProfileId,
    allowTemporaryPermissions: identity.allowTemporaryPermissions,
  });
  const access = initial.access;
  if (!access.enabled) throw new ManagerConsolePolicyError();
  const profiles = visibleProfiles(access);
  const units = await visibleOrganizationalUnits(identity.userId, access);
  const execution = getManagerTerminalExecutionStatus();
  return {
    shell: "bash",
    mode: "isolated-linux-workspace" as const,
    operatingSystemAccess: "isolated-container-only" as const,
    access,
    profiles,
    units,
    execution,
    allowedCommands: [
      "Linux commands in the isolated workspace",
      "Windows aliases: dir, type, copy, move, del, erase, where, cls",
      "Samba clients: smbclient, smbget, nmblookup, samba-tool",
      "ufctl help",
      "ufctl whoami",
      "ufctl profiles",
      "ufctl units",
      "ufctl unit create <department|workgroup> <slug> <name> [parent:<slug>]",
      "ufctl unit add <slug> <user-id> <lead|member>",
      "ufctl unit remove <slug> <user-id>",
      "ufctl permission grant <profile> <user-id> <minutes> <internal|external|any> [unit:<slug>]",
      "ufctl permission revoke <permission-id>",
      ...(profiles.some((profile) => profile.id === "manager-support")
        ? ["ufctl diagnose probe [all|dns|tls|live|ready]"]
        : []),
      "use global|unit:<slug>|profile:<profile>",
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
  terminalIdentity: ManagerTerminalSessionIdentity;
  command: string;
  contextProfileId?: string;
  contextUnitId?: string | null;
}) {
  const identity = input.terminalIdentity;
  if (identity.userId !== input.actorUserId) {
    throw new ManagerConsolePolicyError(
      "The authenticated terminal identity does not match the actor",
    );
  }
  const resolved = await resolveTerminalAccess({
    userId: identity.userId,
    platformOperator: identity.platformOperator,
    accessMode: identity.accessMode,
    unitId: input.contextUnitId,
    includeAnyUnit: !input.contextUnitId,
    scopeProfileId: identity.scopeProfileId,
    allowTemporaryPermissions: identity.allowTemporaryPermissions,
  });
  const access = resolved.access;
  if (!access.enabled) throw new ManagerConsolePolicyError();
  const command = input.command.trim();
  if (!command || command.length > 16_384 || command.includes("\0")) {
    throw new ManagerConsoleCommandError("Command length is invalid");
  }
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
  const unit = await requireVisibleUnit(
    identity.userId,
    access,
    input.contextUnitId,
  );

  if (command.startsWith("use ")) {
    const requested = command.slice(4).trim();
    if (requested === "global") {
      return {
        command,
        contextProfileId: context.id,
        contextUnitId: null,
        nextContextProfileId: context.id,
        nextContextUnitId: null,
        executedAt: Date.now(),
        lines: ["context=global"],
      };
    }
    if (requested.startsWith("unit:")) {
      const requestedUnit = await requireVisibleUnit(
        identity.userId,
        access,
        requested.slice(5),
      );
      return {
        command,
        contextProfileId: context.id,
        contextUnitId: unit?.id ?? null,
        nextContextProfileId: context.id,
        nextContextUnitId: requestedUnit!.id,
        executedAt: Date.now(),
        lines: [`context=unit:${requestedUnit!.slug}`],
      };
    }
    if (requested.startsWith("profile:")) {
      const nextProfile = profiles.find(
        (profile) => profile.id === requested.slice(8),
      );
      if (!nextProfile) {
        throw new ManagerConsolePolicyError(
          "The selected console branch is outside the active profile scope",
        );
      }
      return {
        command,
        contextProfileId: context.id,
        contextUnitId: unit?.id ?? null,
        nextContextProfileId: nextProfile.id,
        nextContextUnitId: unit?.id ?? null,
        executedAt: Date.now(),
        lines: [`context=profile:${nextProfile.id}`],
      };
    }
    throw new ManagerConsoleCommandError(
      "Usage: use global|unit:<slug>|profile:<profile>",
    );
  }

  if (command === "ufctl" || command.startsWith("ufctl ")) {
    const corporateCommand = command.slice(5).trim() || "help";
    let lines: string[];
    if (corporateCommand === "help") {
      lines = (await getManagerConsoleOverview(identity, unit?.id))
        .allowedCommands;
    } else if (corporateCommand === "whoami") {
      lines = [
        `user=${identity.userId}`,
        `authority=${access.authorityProfileId}`,
        `priority=${access.priority}`,
        `credential-scope=${identity.scopeProfileId ?? "automatic"}`,
        `temporary-permissions=${identity.allowTemporaryPermissions ? "enabled" : "disabled"}`,
        `unit=${unit?.slug ?? "global"}`,
      ];
    } else if (corporateCommand === "profiles") {
      lines = profiles.map(
        (profile) =>
          `${profile.id} priority=${profile.priority} path=${profile.virtualPath}`,
      );
    } else if (corporateCommand === "units") {
      lines = (await visibleOrganizationalUnits(identity.userId, access)).map(
        (entry) =>
          `${entry.slug} kind=${entry.kind} name=${entry.name} parent=${entry.parentUnitId ?? "none"}`,
      );
    } else if (corporateCommand === "status") {
      const status = getManagerCoordinationStatus();
      const execution = getManagerTerminalExecutionStatus();
      lines = [
        `active=${status.managerCore.activeOperations.length}`,
        `queued=${status.managerCore.queuedOperations.length}`,
        `control-channel=active`,
        `sandbox=${execution.enabled ? "enabled" : "disabled"}`,
        `network=${execution.network}`,
        "host-filesystem=not-mounted",
        "secrets=not-mounted",
      ];
    } else if (corporateCommand.startsWith("diagnose probe")) {
      const match = /^diagnose probe(?:\s+(all|dns|tls|live|ready))?$/.exec(
        corporateCommand,
      );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl diagnose probe [all|dns|tls|live|ready]",
        );
      }
      if (context.id !== "manager-support") {
        throw new ManagerConsolePolicyError(
          "Diagnostic probes are only available in the support manager branch",
        );
      }
      const report = await withCoordinatedManagerOperation(
        "support",
        "diagnostic-probe",
        ["diagnostic-probe"],
        () =>
          runSupportDiagnosticProbe(
            (match[1] ?? "all") as SupportDiagnosticProbeCheck,
          ),
      );
      lines = formatSupportDiagnosticProbeReport(report);
    } else if (corporateCommand.startsWith("role add ")) {
      const match = /^role add\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)$/.exec(
        corporateCommand,
      );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl role add <profile> <user-id>",
        );
      }
      lines = [
        await assignProfile(identity.userId, access, match[2], match[1]),
      ];
    } else if (corporateCommand.startsWith("role remove ")) {
      const match = /^role remove\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)$/.exec(
        corporateCommand,
      );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl role remove <profile> <user-id>",
        );
      }
      lines = [
        await revokeProfile(identity.userId, access, match[2], match[1]),
      ];
    } else if (corporateCommand.startsWith("unit create ")) {
      const match =
        /^unit create\s+(department|workgroup)\s+([a-z0-9-]+)\s+(.+?)(?:\s+parent:([a-z0-9-]+))?$/.exec(
          corporateCommand,
        );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl unit create <department|workgroup> <slug> <name> [parent:<slug>]",
        );
      }
      lines = [
        await createOrganizationalUnit({
          actorUserId: identity.userId,
          access,
          kind: match[1] as "department" | "workgroup",
          slug: match[2],
          name: match[3],
          parentSlug: match[4],
        }),
      ];
    } else if (corporateCommand.startsWith("unit add ")) {
      const match =
        /^unit add\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)\s+(lead|member)$/.exec(
          corporateCommand,
        );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl unit add <slug> <user-id> <lead|member>",
        );
      }
      lines = [
        await changeOrganizationalMembership({
          actorUserId: identity.userId,
          access,
          unitSlug: match[1],
          targetUserId: match[2],
          membershipRole: match[3] as "lead" | "member",
        }),
      ];
    } else if (corporateCommand.startsWith("unit remove ")) {
      const match = /^unit remove\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)$/.exec(
        corporateCommand,
      );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl unit remove <slug> <user-id>",
        );
      }
      lines = [
        await changeOrganizationalMembership({
          actorUserId: identity.userId,
          access,
          unitSlug: match[1],
          targetUserId: match[2],
          revoke: true,
        }),
      ];
    } else if (corporateCommand.startsWith("permission grant ")) {
      const match =
        /^permission grant\s+([a-z0-9-]+)\s+([A-Za-z0-9-]+)\s+(\d+)\s+(internal|external|any)(?:\s+unit:([a-z0-9-]+))?$/.exec(
          corporateCommand,
        );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl permission grant <profile> <user-id> <minutes> <internal|external|any> [unit:<slug>]",
        );
      }
      lines = [
        await grantTemporaryPermission({
          actorUserId: identity.userId,
          access,
          profileId: match[1],
          targetUserId: match[2],
          durationMinutes: Number.parseInt(match[3], 10),
          accessMode: match[4] as "internal" | "external" | "any",
          unitSlug: match[5],
        }),
      ];
    } else if (corporateCommand.startsWith("permission revoke ")) {
      const match = /^permission revoke\s+([A-Za-z0-9-]+)$/.exec(
        corporateCommand,
      );
      if (!match) {
        throw new ManagerConsoleCommandError(
          "Usage: ufctl permission revoke <permission-id>",
        );
      }
      lines = [
        await revokeTemporaryPermission({
          actorUserId: identity.userId,
          access,
          permissionId: match[1],
        }),
      ];
    } else {
      throw new ManagerConsoleCommandError(
        `ufctl: unknown command: ${corporateCommand.split(/\s+/)[0]}`,
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
      ...(unit ? { contextUnitId: unit.id } : {}),
      executedAt: Date.now(),
      lines: lines.length ? lines : ["(empty)"],
    };
  }

  const execution = await executeIsolatedManagerTerminalCommand({
    accessId: identity.accessId,
    workspaceKey: unit
      ? `unit:${unit.id}`
      : `profile:${context.id}:user:${identity.userId}`,
    command,
  });
  await recordSecurityEvent(
    "manager_terminal_command_executed" as SecurityEventType,
    identity.userId,
    {
      accessId: identity.accessId,
      commandHash: createHash("sha256").update(command).digest("hex"),
      executable: command.split(/\s+/)[0],
      contextProfileId: context.id,
      ...(unit ? { contextUnitId: unit.id } : {}),
      exitCode: execution.exitCode,
      timedOut: execution.timedOut,
      truncated: execution.truncated,
    },
  );
  return {
    command: execution.command,
    contextProfileId: context.id,
    contextUnitId: unit?.id ?? null,
    executedAt: Date.now(),
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    truncated: execution.truncated,
    lines: execution.stdout
      ? execution.stdout.replace(/\r/g, "").split("\n")
      : [],
    errorLines: execution.stderr
      ? execution.stderr.replace(/\r/g, "").split("\n")
      : [],
  };
}

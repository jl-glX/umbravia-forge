import { db } from "../db/client.js";
import type { ManagerId } from "./manager-core.js";
import type { ManagerPlatformScope } from "./manager-core.js";
import { getManagerCoordinationStatus } from "./manager-coordinator.js";

export type InternalManagerAdministratorProfileId =
  | "manager-core"
  | "manager-coordinator"
  | "manager-flow-administrator"
  | "manager-account"
  | "manager-security"
  | "manager-resource"
  | "manager-encryption"
  | "manager-environment"
  | "manager-email"
  | "manager-notification"
  | "manager-support"
  | "manager-cryptographic-material-replacement";

export type InternalManagerAdministratorLocale = "es" | "en" | "de";

interface LocalizedAdministratorCopy {
  label: string;
  responsibility: string;
}

export interface InternalManagerAdministratorDefinition {
  profileId: InternalManagerAdministratorProfileId;
  runtimeManagerId: ManagerId | null;
  priority: number;
  copy: Record<InternalManagerAdministratorLocale, LocalizedAdministratorCopy>;
}

export interface InternalManagerAdministratorActor {
  userId: string;
  email: string;
  name: string;
  identityRealm: "commercial" | "corporate_support";
  platformScope: ManagerPlatformScope;
  authority: "commercial-platform-operator" | "support-platform-head";
}

export class InternalManagerAdministratorAccessError extends Error {
  readonly code = "INTERNAL_MANAGER_ADMINISTRATOR_ACCESS_DENIED";

  constructor() {
    super("A verified commercial platform operator is required");
    this.name = "InternalManagerAdministratorAccessError";
  }
}

export function authorizeLocalLinuxManagerAdministrator(input: {
  operatingSystem: NodeJS.Platform;
  effectiveUserId: number | null;
  linuxUser: string;
  allowedLinuxUsers: string | undefined;
  platformScope: ManagerPlatformScope;
}) {
  const linuxUser = input.linuxUser.trim();
  const allowedLinuxUsers = new Set(
    (input.allowedLinuxUsers ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    input.operatingSystem !== "linux" ||
    input.effectiveUserId === 0 ||
    linuxUser === "root" ||
    allowedLinuxUsers.size === 0 ||
    !allowedLinuxUsers.has(linuxUser)
  ) {
    throw new InternalManagerAdministratorAccessError();
  }
  return {
    channel: "local-linux-terminal" as const,
    linuxUser,
    platformScope: input.platformScope,
  };
}

const definitions = [
  {
    profileId: "manager-core",
    runtimeManagerId: null,
    priority: 1,
    copy: {
      es: {
        label: "Administrador interno del núcleo de gestores",
        responsibility: "Supervisa capacidad, prioridades, colas y conflictos.",
      },
      en: {
        label: "Internal manager-core administrator",
        responsibility: "Observes capacity, priorities, queues and conflicts.",
      },
      de: {
        label: "Interner Administrator des Manager-Kerns",
        responsibility:
          "Überwacht Kapazität, Prioritäten, Warteschlangen und Konflikte.",
      },
    },
  },
  {
    profileId: "manager-coordinator",
    runtimeManagerId: null,
    priority: 2,
    copy: {
      es: {
        label: "Administrador interno de coordinación",
        responsibility:
          "Supervisa conexiones, señales y acuses entre gestores.",
      },
      en: {
        label: "Internal coordination administrator",
        responsibility:
          "Observes manager connections, signals and acknowledgements.",
      },
      de: {
        label: "Interner Koordinationsadministrator",
        responsibility:
          "Überwacht Manager-Verbindungen, Signale und Bestätigungen.",
      },
    },
  },
  {
    profileId: "manager-flow-administrator",
    runtimeManagerId: null,
    priority: 3,
    copy: {
      es: {
        label: "Administrador interno de flujos",
        responsibility:
          "Observa el trabajo activo y en espera de todos los dominios.",
      },
      en: {
        label: "Internal flow administrator",
        responsibility: "Observes active and queued work across every domain.",
      },
      de: {
        label: "Interner Ablaufadministrator",
        responsibility:
          "Überwacht aktive und wartende Arbeit in allen Bereichen.",
      },
    },
  },
  ...(
    [
      ["manager-account", "account", "cuentas", "accounts", "Konten"],
      ["manager-security", "security", "seguridad", "security", "Sicherheit"],
      ["manager-resource", "resource", "recursos", "resources", "Ressourcen"],
      [
        "manager-encryption",
        "encryption",
        "cifrado",
        "encryption",
        "Verschlüsselung",
      ],
      [
        "manager-environment",
        "environment",
        "entornos",
        "environments",
        "Umgebungen",
      ],
      ["manager-email", "email", "correo", "email", "E-Mail"],
      [
        "manager-notification",
        "notification",
        "notificaciones",
        "notifications",
        "Benachrichtigungen",
      ],
      ["manager-support", "support", "soporte", "support", "Support"],
    ] as const
  ).map(([profileId, runtimeManagerId, esDomain, enDomain, deDomain]) => ({
    profileId,
    runtimeManagerId,
    priority: 4,
    copy: {
      es: {
        label: `Administrador interno de ${esDomain}`,
        responsibility: `Observa operaciones, señales y conexiones del gestor de ${esDomain}.`,
      },
      en: {
        label: `Internal ${enDomain} administrator`,
        responsibility: `Observes operations, signals and connections for the ${enDomain} manager.`,
      },
      de: {
        label: `Interner Administrator für ${deDomain}`,
        responsibility: `Überwacht Vorgänge, Signale und Verbindungen des Managers für ${deDomain}.`,
      },
    },
  })),
  {
    profileId: "manager-cryptographic-material-replacement",
    runtimeManagerId: "encryption",
    priority: 5,
    copy: {
      es: {
        label: "Administrador interno de sustitución criptográfica",
        responsibility:
          "Observa la preparación de sustituciones sin mostrar ni modificar material secreto.",
      },
      en: {
        label: "Internal cryptographic-replacement administrator",
        responsibility:
          "Observes replacement readiness without exposing or changing secret material.",
      },
      de: {
        label: "Interner Administrator für Kryptografieaustausch",
        responsibility:
          "Überwacht die Austauschbereitschaft, ohne geheimes Material anzuzeigen oder zu ändern.",
      },
    },
  },
] as const satisfies readonly InternalManagerAdministratorDefinition[];

export function listInternalManagerAdministrators() {
  return definitions.map((definition) => ({ ...definition }));
}

export async function resolveInternalManagerAdministratorActor(
  emailValue: string,
  platformScope: ManagerPlatformScope,
): Promise<InternalManagerAdministratorActor> {
  const email = emailValue.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InternalManagerAdministratorAccessError();
  }
  const actor =
    platformScope === "commercial"
      ? await db
          .selectFrom("users")
          .innerJoin(
            "platformOperators",
            "platformOperators.userId",
            "users.id",
          )
          .select([
            "users.id",
            "users.email",
            "users.name",
            "users.identityRealm",
          ])
          .where("users.email", "=", email)
          .where("users.identityRealm", "=", "commercial")
          .where("users.accountStatus", "=", "active")
          .where("users.emailVerifiedAt", "is not", null)
          .where("platformOperators.status", "=", "active")
          .executeTakeFirst()
      : await db
          .selectFrom("users")
          .innerJoin("umfSupportStaff", "umfSupportStaff.userId", "users.id")
          .innerJoin(
            "companyStaffProfiles",
            "companyStaffProfiles.userId",
            "users.id",
          )
          .select([
            "users.id",
            "users.email",
            "users.name",
            "users.identityRealm",
          ])
          .where("users.email", "=", email)
          .where("users.identityRealm", "=", "corporate_support")
          .where("users.accountStatus", "=", "active")
          .where("users.emailVerifiedAt", "is not", null)
          .where("umfSupportStaff.role", "=", "director")
          .where("umfSupportStaff.status", "=", "active")
          .where("companyStaffProfiles.position", "=", "platform_head")
          .where("companyStaffProfiles.status", "=", "active")
          .executeTakeFirst();
  if (!actor) {
    throw new InternalManagerAdministratorAccessError();
  }
  return {
    userId: actor.id,
    email: actor.email,
    name: actor.name,
    identityRealm: actor.identityRealm,
    platformScope,
    authority:
      platformScope === "commercial"
        ? "commercial-platform-operator"
        : "support-platform-head",
  };
}

export function getInternalManagerAdministratorInterface(
  actor: InternalManagerAdministratorActor,
  profileId: InternalManagerAdministratorProfileId,
  platformScope: ManagerPlatformScope,
  locale: InternalManagerAdministratorLocale = "es",
) {
  if (
    actor.platformScope !== platformScope ||
    (platformScope === "commercial" &&
      (actor.identityRealm !== "commercial" ||
        actor.authority !== "commercial-platform-operator")) ||
    (platformScope === "support" &&
      (actor.identityRealm !== "corporate_support" ||
        actor.authority !== "support-platform-head"))
  ) {
    throw new InternalManagerAdministratorAccessError();
  }
  const definition = definitions.find(
    (candidate) => candidate.profileId === profileId,
  );
  if (!definition) throw new InternalManagerAdministratorAccessError();

  const coordination = getManagerCoordinationStatus(platformScope);
  const managerId = definition.runtimeManagerId;
  const includeAllRuntime = managerId === null;
  return {
    administratorId: "shared-internal-manager-administrator" as const,
    platformScope,
    profileId: definition.profileId,
    label: definition.copy[locale].label,
    responsibility: definition.copy[locale].responsibility,
    priority: definition.priority,
    runtimeManagerId: managerId,
    interface: {
      channel: "local-linux-terminal" as const,
      mode: "observe-and-coordinate" as const,
      webAvailable: false as const,
      remoteApiAvailable: false as const,
    },
    boundaries: {
      managedIdentityRealms: ["commercial", "corporate_support"] as const,
      operatorAuthority: actor.authority,
      requiresScopeAuthority: true as const,
      webSessionAuthenticationEnabled: false as const,
      secretValuesExposed: false as const,
      secretMutationEnabled: false as const,
      hostCommandExecutionEnabled: false as const,
      domainMutationEnabled: false as const,
    },
    runtime: {
      activeOperations: coordination.activeOperations.filter(
        (operation) =>
          operation.platformScope === platformScope &&
          (includeAllRuntime || operation.manager === managerId),
      ),
      queuedOperations: coordination.managerCore.queuedOperations.filter(
        (operation) =>
          operation.platformScope === platformScope &&
          (includeAllRuntime || operation.manager === managerId),
      ),
      recentSignals: coordination.recentSignals.filter(
        (signal) =>
          signal.platformScope === platformScope &&
          (includeAllRuntime || signal.source === managerId),
      ),
      connections: coordination.connections.filter(
        (connection) =>
          includeAllRuntime ||
          connection.consumer === managerId ||
          connection.provider === managerId,
      ),
    },
  };
}

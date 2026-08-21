import "dotenv/config";
import { userInfo } from "node:os";
import { closeDatabase, initializeDatabase } from "../server/db/client.js";
import {
  getInternalManagerAdministratorInterface,
  listInternalManagerAdministrators,
  resolveInternalManagerAdministratorActor,
  type InternalManagerAdministratorLocale,
  type InternalManagerAdministratorProfileId,
} from "../server/services/internal-manager-administrators.js";
import type { ManagerPlatformScope } from "../server/services/manager-core.js";
import { authorizePlatformManagerAdminBeforeDatabase } from "./platform-manager-admin-gate.js";

const optionNames = new Set(["--email", "--locale", "--scope"]);

function option(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function positionalArguments(): string[] {
  const values: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if ([...optionNames].some((name) => value.startsWith(`${name}=`))) continue;
    if (optionNames.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) values.push(value);
  }
  return values;
}

function locale(): InternalManagerAdministratorLocale {
  const value = option("--locale") ?? "es";
  if (value === "es" || value === "en" || value === "de") return value;
  throw new Error("--locale debe ser es, en o de");
}

function platformScope(): ManagerPlatformScope {
  const value = option("--scope");
  if (value === "commercial" || value === "support") return value;
  throw new Error("--scope es obligatorio y debe ser commercial o support");
}

function printHelp() {
  console.log(
    [
      "Uso local Linux:",
      "  npm run platform:managers -- --email <cuenta-autorizada> --scope <commercial|support> overview",
      "  npm run platform:managers -- --email <cuenta-autorizada> --scope <commercial|support> profiles",
      "  npm run platform:managers -- --email <cuenta-autorizada> --scope <commercial|support> profile <perfil>",
      "Opcional: --locale es|en|de",
    ].join("\n"),
  );
}

const email = option("--email") ?? "";
const [command = "overview", profileId] = positionalArguments();
const selectedLocale = locale();
const selectedPlatformScope = platformScope();
const localContext = await authorizePlatformManagerAdminBeforeDatabase(
  {
    operatingSystem: process.platform,
    effectiveUserId:
      typeof process.getuid === "function" ? process.getuid() : null,
    linuxUser: userInfo().username,
    allowedLinuxUsers: process.env.UMF_MANAGER_ADMIN_LINUX_USERS,
    platformScope: selectedPlatformScope,
  },
  initializeDatabase,
);
try {
  const actor = await resolveInternalManagerAdministratorActor(
    email,
    selectedPlatformScope,
  );
  if (command === "overview") {
    const managerOverview = getInternalManagerAdministratorInterface(
      actor,
      "manager-core",
      selectedPlatformScope,
      selectedLocale,
    );
    console.log("Umbravia Forge · administradores internos · Linux local");
    console.log(
      JSON.stringify(
        {
          linuxUser: localContext.linuxUser,
          actor: actor.email,
          identityRealm: actor.identityRealm,
          authority: actor.authority,
          platformScope: selectedPlatformScope,
          managerAdministrator: "shared-internal-manager-administrator",
          managedScopes: ["commercial", "support"],
          managerProfiles: listInternalManagerAdministrators().length,
          activeOperations: managerOverview.runtime.activeOperations.length,
          queuedOperations: managerOverview.runtime.queuedOperations.length,
          recentSignals: managerOverview.runtime.recentSignals.length,
          webAdministration: false,
          remoteAdministrationApi: false,
        },
        null,
        2,
      ),
    );
  } else if (command === "profiles") {
    console.table(
      listInternalManagerAdministrators().map((definition) => ({
        profile: definition.profileId,
        priority: definition.priority,
        manager: definition.runtimeManagerId ?? "shared-runtime",
        label: definition.copy[selectedLocale].label,
      })),
    );
  } else if (command === "profile" && profileId) {
    console.log(
      JSON.stringify(
        getInternalManagerAdministratorInterface(
          actor,
          profileId as InternalManagerAdministratorProfileId,
          selectedPlatformScope,
          selectedLocale,
        ),
        null,
        2,
      ),
    );
  } else if (command === "help") {
    printHelp();
  } else {
    printHelp();
    throw new Error("Orden o perfil no reconocido");
  }
} finally {
  await closeDatabase();
}

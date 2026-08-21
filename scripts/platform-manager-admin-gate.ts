import { authorizeLocalLinuxManagerAdministrator } from "../server/services/internal-manager-administrators.js";
import type { ManagerPlatformScope } from "../server/services/manager-core.js";

export interface PlatformManagerAdminLocalRuntime {
  operatingSystem: NodeJS.Platform;
  effectiveUserId: number | null;
  linuxUser: string;
  allowedLinuxUsers: string | undefined;
  platformScope: ManagerPlatformScope;
}

export async function authorizePlatformManagerAdminBeforeDatabase(
  runtime: PlatformManagerAdminLocalRuntime,
  initializeDatabase: () => Promise<void>,
): Promise<ReturnType<typeof authorizeLocalLinuxManagerAdministrator>> {
  const localContext = authorizeLocalLinuxManagerAdministrator(runtime);
  await initializeDatabase();
  return localContext;
}

export type AppNavigationArea =
  | "home"
  | "classes"
  | "bookings"
  | "community"
  | "support"
  | "account"
  | "payments"
  | "timer"
  | "admin"
  | "trainer"
  | "analytics";

interface StoredAppNavigationHistory {
  version: 1;
  areas: Partial<Record<AppNavigationArea, string[]>>;
  forwardAreas?: Partial<Record<AppNavigationArea, string[]>>;
}

const STORAGE_PREFIX = "umbravia:app-navigation:v1";
const MAX_ROUTES_PER_AREA = 25;

const AREA_ROOTS: Record<AppNavigationArea, string> = {
  home: "/",
  classes: "/classes",
  bookings: "/my-bookings",
  community: "/community",
  support: "/support",
  account: "/account",
  payments: "/my-payments",
  timer: "/workout-timer",
  admin: "/admin-dashboard",
  trainer: "/trainer-dashboard",
  analytics: "/activity-dashboard",
};

function getArea(pathname: string): AppNavigationArea | null {
  if (pathname === "/") return "home";
  if (pathname === "/classes" || pathname.startsWith("/classes/")) {
    return "classes";
  }
  if (pathname === "/my-bookings") return "bookings";
  if (pathname === "/community" || pathname === "/moderation") {
    return "community";
  }
  if (pathname === "/support" || pathname === "/feedback") return "support";
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    return "account";
  }
  if (
    pathname === "/my-payments" ||
    pathname === "/billing" ||
    pathname === "/downloads"
  ) {
    return "payments";
  }
  if (pathname === "/workout-timer") return "timer";
  if (pathname === "/trainer-dashboard") return "trainer";
  if (
    pathname === "/activity-dashboard" ||
    pathname === "/trainer-analytics" ||
    pathname === "/admin-analytics"
  ) {
    return "analytics";
  }
  if (pathname === "/admin-dashboard" || pathname.startsWith("/admin/")) {
    return "admin";
  }
  return null;
}

function getAreaRoot(area: AppNavigationArea, pathname: string): string {
  if (area === "analytics") {
    return pathname;
  }
  if (area === "payments" && pathname === "/billing") {
    return "/billing";
  }
  return AREA_ROOTS[area];
}

function getStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readHistory(
  storage: Storage,
  userId: string,
): StoredAppNavigationHistory {
  try {
    const value = storage.getItem(getStorageKey(userId));
    if (!value) return { version: 1, areas: {} };
    const parsed = JSON.parse(value) as StoredAppNavigationHistory;
    if (parsed.version !== 1 || typeof parsed.areas !== "object") {
      return { version: 1, areas: {} };
    }
    return parsed;
  } catch {
    return { version: 1, areas: {} };
  }
}

function writeHistory(
  storage: Storage,
  userId: string,
  history: StoredAppNavigationHistory,
): void {
  try {
    storage.setItem(getStorageKey(userId), JSON.stringify(history));
  } catch {
    // La navegación sigue siendo funcional aunque el navegador bloquee storage.
  }
}

export function recordAppRoute(
  storage: Storage,
  userId: string,
  pathname: string,
): void {
  const area = getArea(pathname);
  if (!area) return;

  const history = readHistory(storage, userId);
  const areaRoutes = history.areas[area] ?? [];
  const forwardRoutes = history.forwardAreas?.[area] ?? [];
  const areaRoot = getAreaRoot(area, pathname);

  if (pathname === areaRoot && areaRoutes.at(-1) !== pathname) {
    history.areas[area] = [pathname];
    history.forwardAreas = { ...history.forwardAreas, [area]: [] };
  } else if (areaRoutes.at(-1) !== pathname) {
    history.areas[area] = [...areaRoutes, pathname].slice(-MAX_ROUTES_PER_AREA);
    if (forwardRoutes.at(-1) !== pathname) {
      history.forwardAreas = { ...history.forwardAreas, [area]: [] };
    }
  }

  writeHistory(storage, userId, history);
}

export function canNavigateForwardInsideArea(
  storage: Storage,
  userId: string,
  pathname: string,
): boolean {
  const area = getArea(pathname);
  if (!area) return false;
  const history = readHistory(storage, userId);
  const routes = history.areas[area] ?? [];
  const forwardRoutes = history.forwardAreas?.[area] ?? [];
  return routes.at(-1) === pathname && forwardRoutes.length > 0;
}

export function canNavigateBackInsideArea(
  storage: Storage,
  userId: string,
  pathname: string,
): boolean {
  const area = getArea(pathname);
  if (!area) return false;
  const routes = readHistory(storage, userId).areas[area] ?? [];
  return routes.length > 1 && routes.at(-1) === pathname;
}

export function consumeAppBackTarget(
  storage: Storage,
  userId: string,
  pathname: string,
): string | null {
  const area = getArea(pathname);
  if (!area) return null;

  const history = readHistory(storage, userId);
  const routes = history.areas[area] ?? [];
  if (routes.length <= 1 || routes.at(-1) !== pathname) return null;

  const currentRoute = routes.pop();
  history.areas[area] = routes;
  history.forwardAreas = {
    ...history.forwardAreas,
    [area]: currentRoute
      ? [...(history.forwardAreas?.[area] ?? []), currentRoute].slice(
          -MAX_ROUTES_PER_AREA,
        )
      : (history.forwardAreas?.[area] ?? []),
  };
  writeHistory(storage, userId, history);
  return routes.at(-1) ?? null;
}

export function consumeAppForwardTarget(
  storage: Storage,
  userId: string,
  pathname: string,
): string | null {
  const area = getArea(pathname);
  if (!area) return null;

  const history = readHistory(storage, userId);
  const routes = history.areas[area] ?? [];
  const forwardRoutes = history.forwardAreas?.[area] ?? [];
  if (routes.at(-1) !== pathname || forwardRoutes.length === 0) return null;

  const target = forwardRoutes.pop();
  if (!target) return null;
  history.areas[area] = [...routes, target].slice(-MAX_ROUTES_PER_AREA);
  history.forwardAreas = { ...history.forwardAreas, [area]: forwardRoutes };
  writeHistory(storage, userId, history);
  return target;
}

export function clearAppNavigationHistory(
  storage: Storage,
  userId: string,
): void {
  try {
    storage.removeItem(getStorageKey(userId));
  } catch {
    // No se bloquea el cierre de sesión si storage no está disponible.
  }
}

export function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

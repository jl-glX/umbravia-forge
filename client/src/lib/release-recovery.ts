const RELEASE_RELOAD_MARKER = "umbravia.release-reload";
export const RELEASE_RELOAD_WINDOW_MS = 60_000;

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

interface ReleaseReloadMarker {
  path: string;
  createdAt: number;
}

function readMarker(storage: StorageLike): ReleaseReloadMarker | null {
  try {
    const value = storage.getItem(RELEASE_RELOAD_MARKER);
    if (!value) return null;
    const marker = JSON.parse(value) as Partial<ReleaseReloadMarker>;
    if (
      typeof marker.path !== "string" ||
      typeof marker.createdAt !== "number"
    ) {
      return null;
    }
    return { path: marker.path, createdAt: marker.createdAt };
  } catch {
    return null;
  }
}

export function claimReleaseReload(
  storage: StorageLike,
  path: string,
  now = Date.now(),
): boolean {
  const marker = readMarker(storage);
  if (
    marker?.path === path &&
    now - marker.createdAt >= 0 &&
    now - marker.createdAt < RELEASE_RELOAD_WINDOW_MS
  ) {
    return false;
  }

  try {
    storage.setItem(
      RELEASE_RELOAD_MARKER,
      JSON.stringify({ path, createdAt: now } satisfies ReleaseReloadMarker),
    );
  } catch {
    // A disabled sessionStorage must not prevent the recovery reload.
  }
  return true;
}

export function clearReleaseReloadMarker(storage: StorageLike): void {
  try {
    storage.removeItem(RELEASE_RELOAD_MARKER);
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

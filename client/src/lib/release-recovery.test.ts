import { describe, expect, it } from "vitest";
import {
  claimReleaseReload,
  clearReleaseReloadMarker,
  RELEASE_RELOAD_WINDOW_MS,
} from "./release-recovery";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("release recovery", () => {
  it("allows one automatic reload for the current route", () => {
    const storage = createStorage();

    expect(claimReleaseReload(storage, "/support", 1_000)).toBe(true);
    expect(claimReleaseReload(storage, "/support", 1_001)).toBe(false);
  });

  it("allows recovery again after the guard window or on another route", () => {
    const storage = createStorage();

    expect(claimReleaseReload(storage, "/support", 1_000)).toBe(true);
    expect(claimReleaseReload(storage, "/classes", 1_001)).toBe(true);
    expect(
      claimReleaseReload(storage, "/classes", 1_001 + RELEASE_RELOAD_WINDOW_MS),
    ).toBe(true);
  });

  it("can clear the guard after a stable page load", () => {
    const storage = createStorage();

    expect(claimReleaseReload(storage, "/support", 1_000)).toBe(true);
    clearReleaseReloadMarker(storage);
    expect(claimReleaseReload(storage, "/support", 1_001)).toBe(true);
  });
});

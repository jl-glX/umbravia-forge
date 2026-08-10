import { describe, expect, it } from "vitest";
import {
  canNavigateBackInsideArea,
  clearAppNavigationHistory,
  consumeAppBackTarget,
  recordAppRoute,
} from "./app-navigation-history";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("app navigation history", () => {
  it("keeps navigation inside the current application area", () => {
    const storage = createStorage();
    recordAppRoute(storage, "user-1", "/classes");
    recordAppRoute(storage, "user-1", "/classes/42/session-content");

    expect(
      canNavigateBackInsideArea(
        storage,
        "user-1",
        "/classes/42/session-content",
      ),
    ).toBe(true);
    expect(
      consumeAppBackTarget(storage, "user-1", "/classes/42/session-content"),
    ).toBe("/classes");
  });

  it("does not mix history from different areas", () => {
    const storage = createStorage();
    recordAppRoute(storage, "user-1", "/classes");
    recordAppRoute(storage, "user-1", "/classes/42/session-content");
    recordAppRoute(storage, "user-1", "/community");

    expect(canNavigateBackInsideArea(storage, "user-1", "/community")).toBe(
      false,
    );
    expect(consumeAppBackTarget(storage, "user-1", "/community")).toBeNull();
  });

  it("does not record public routes or mix different accounts", () => {
    const storage = createStorage();
    recordAppRoute(storage, "user-1", "/login");
    recordAppRoute(storage, "user-1", "/classes");
    recordAppRoute(storage, "user-1", "/classes/42/session-content");

    expect(
      canNavigateBackInsideArea(
        storage,
        "user-2",
        "/classes/42/session-content",
      ),
    ).toBe(false);
    expect(consumeAppBackTarget(storage, "user-1", "/login")).toBeNull();
  });

  it("resets an area when its root is opened explicitly", () => {
    const storage = createStorage();
    recordAppRoute(storage, "user-1", "/classes");
    recordAppRoute(storage, "user-1", "/classes/42/session-content");
    recordAppRoute(storage, "user-1", "/classes");

    expect(canNavigateBackInsideArea(storage, "user-1", "/classes")).toBe(
      false,
    );
  });

  it("clears the current account history when its session ends", () => {
    const storage = createStorage();
    recordAppRoute(storage, "user-1", "/classes");
    recordAppRoute(storage, "user-1", "/classes/42/session-content");
    clearAppNavigationHistory(storage, "user-1");

    expect(
      canNavigateBackInsideArea(
        storage,
        "user-1",
        "/classes/42/session-content",
      ),
    ).toBe(false);
  });
});

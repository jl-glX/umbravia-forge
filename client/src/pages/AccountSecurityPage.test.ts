import { describe, expect, it } from "vitest";
import { sessionExpiryKind } from "../lib/sessionExpiry";

describe("account security session expiry copy", () => {
  it("labels the absolute lifetime when it expires before inactivity", () => {
    expect(
      sessionExpiryKind({
        idleExpiresAt: Date.UTC(2026, 7, 31),
        expiresAt: Date.UTC(2026, 7, 25),
      }),
    ).toBe("absolute");
  });

  it("labels inactivity when it is the first expiry boundary", () => {
    expect(
      sessionExpiryKind({
        idleExpiresAt: Date.UTC(2026, 7, 25),
        expiresAt: Date.UTC(2026, 8, 23),
      }),
    ).toBe("idle");
  });
});

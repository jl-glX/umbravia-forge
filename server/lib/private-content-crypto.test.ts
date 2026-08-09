import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isProtectedPrivateContent,
  protectPrivateBytes,
  protectPrivateText,
  revealPrivateBytes,
  revealPrivateText,
} from "./private-content-crypto.js";

describe("private content encryption", () => {
  afterEach(() => vi.unstubAllEnvs());

  function enableEncryption(): void {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      randomBytes(32).toString("base64url"),
    );
  }

  it("round-trips text with a random nonce and authenticated context", () => {
    enableEncryption();
    const first = protectPrivateText("contenido privado", "message:one");
    const second = protectPrivateText("contenido privado", "message:one");

    expect(first).not.toBe(second);
    expect(isProtectedPrivateContent(first)).toBe(true);
    expect(revealPrivateText(first, "message:one")).toBe("contenido privado");
    expect(() => revealPrivateText(first, "message:two")).toThrow(
      "authentication failed",
    );
  });

  it("round-trips binary attachments and rejects tampering", () => {
    enableEncryption();
    const original = Buffer.from([0, 1, 2, 3, 254, 255]);
    const protectedValue = protectPrivateBytes(original, "attachment:one");
    expect(protectedValue).not.toEqual(original);
    expect(revealPrivateBytes(protectedValue, "attachment:one")).toEqual(
      original,
    );

    const tampered = Buffer.from(protectedValue);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 1;
    expect(() => revealPrivateBytes(tampered, "attachment:one")).toThrow();
  });

  it("keeps legacy plaintext readable while encryption is disabled", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "false");
    expect(protectPrivateText("legacy", "message:legacy")).toBe("legacy");
    expect(revealPrivateText("legacy", "message:legacy")).toBe("legacy");
    expect(protectPrivateBytes(Buffer.from("legacy"), "file:legacy")).toEqual(
      Buffer.from("legacy"),
    );
  });

  it("fails closed when encryption is enabled without a valid key", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_KEY", "too-short");
    expect(() => protectPrivateText("secret", "message:one")).toThrow(
      "exactly 32 bytes",
    );
  });
});

import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPrivateContentEncryptionStatus,
  isProtectedPrivateContent,
  privateContentNeedsRewrap,
  protectPrivateBytes,
  protectPrivateText,
  rewrapPrivateText,
  revealPrivateBytes,
  revealPrivateText,
  validatePrivateContentEncryptionConfiguration,
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
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_KEY", "00".repeat(16));
    expect(() => protectPrivateText("secret", "message:one")).toThrow(
      "exactly 32 bytes",
    );
  });

  it("keeps xcp1 data readable while a versioned keyring writes xcp2", () => {
    const previousKey = randomBytes(32).toString("base64url");
    const activeKey = randomBytes(32).toString("base64url");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_KEY", previousKey);
    const legacy = protectPrivateText("mensaje anterior", "message:rotation");
    expect(legacy).toMatch(/^xcp1\./);

    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEYRING",
      `previous:${previousKey},current:${activeKey}`,
    );
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID", "current");

    expect(revealPrivateText(legacy, "message:rotation")).toBe(
      "mensaje anterior",
    );
    expect(privateContentNeedsRewrap(legacy)).toBe(true);
    const rewrapped = rewrapPrivateText(legacy, "message:rotation");
    expect(rewrapped).toMatch(/^xcp2\.current\./);
    expect(revealPrivateText(rewrapped, "message:rotation")).toBe(
      "mensaje anterior",
    );
    expect(privateContentNeedsRewrap(rewrapped)).toBe(false);
    expect(getPrivateContentEncryptionStatus()).toMatchObject({
      enabled: true,
      writeVersion: "xcp2",
      activeKeyId: "current",
      readableKeyIds: ["previous", "current"],
      legacyKeyConfigured: true,
    });
  });

  it("allows rotation without duplicating the legacy key in the keyring", () => {
    const previousKey = randomBytes(32).toString("base64url");
    const activeKey = randomBytes(32).toString("base64url");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_KEY", previousKey);
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_KEYRING", `current:${activeKey}`);
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID", "current");

    const status = getPrivateContentEncryptionStatus();
    expect(status.readableKeyIds).toEqual(["current", "legacy"]);
  });

  it("rejects an unknown active key before the server starts", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEYRING",
      `current:${randomBytes(32).toString("base64url")}`,
    );
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID", "missing");

    expect(() => validatePrivateContentEncryptionConfiguration()).toThrow(
      "does not exist",
    );
  });

  it("reserves the legacy identifier for the compatibility key", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEYRING",
      `legacy:${randomBytes(32).toString("base64url")}`,
    );
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID", "legacy");

    expect(() => validatePrivateContentEncryptionConfiguration()).toThrow(
      "legacy is reserved",
    );
  });

  it("rejects the same key material under different key identifiers", () => {
    const duplicatedKey = randomBytes(32).toString("base64url");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEYRING",
      `current:${duplicatedKey},duplicate:${duplicatedKey}`,
    );
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID", "current");

    expect(() => validatePrivateContentEncryptionConfiguration()).toThrow(
      "same key under more than one id",
    );
  });

  it("rejects malformed encodings even if Node could decode 32 bytes", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      `${randomBytes(32).toString("base64url")}!`,
    );

    expect(() => validatePrivateContentEncryptionConfiguration()).toThrow(
      "must be valid",
    );
  });

  it("does not decode an entire plaintext attachment just to inspect it", () => {
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "false");
    const plaintext = Buffer.alloc(2 * 1024 * 1024, 0xff);

    expect(isProtectedPrivateContent(plaintext)).toBe(false);
    expect(
      revealPrivateBytes(plaintext, "attachment:large").equals(plaintext),
    ).toBe(true);
  });
});

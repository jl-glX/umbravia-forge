import { createHash, randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getManagerConnectionCryptoStatus,
  protectManagerConnectionPayload,
  revealManagerConnectionPayload,
  validateManagerConnectionCryptoConfiguration,
} from "./manager-connection-crypto.js";

const context = "manager-connection:account:email:channel-readiness";

function createLegacyEnvelope(
  key: Buffer,
  plaintext: Buffer,
  envelopeContext: string,
): string {
  const version = "mcx1";
  const reference = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const nonce = randomBytes(24);
  const aad = Buffer.from(`${version}:${reference}:${envelopeContext}`, "utf8");
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return [
    version,
    reference,
    nonce.toString("base64url"),
    Buffer.from(ciphertext).toString("base64url"),
  ].join(".");
}

afterEach(() => vi.unstubAllEnvs());

describe("manager connection encryption", () => {
  it("authenticates the manager identities and capability", () => {
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    const plaintext = Buffer.from('{"ready":true}', "utf8");
    const envelope = protectManagerConnectionPayload(plaintext, context);

    expect(envelope).toMatch(/^mcg3\.legacy\./);
    expect(envelope).not.toContain(plaintext.toString("utf8"));
    expect(revealManagerConnectionPayload(envelope, context)).toEqual(
      plaintext,
    );
    expect(() =>
      revealManagerConnectionPayload(
        envelope,
        "manager-connection:support:email:channel-readiness",
      ),
    ).toThrow(/authentication failed/i);
  });

  it("rejects tampering", () => {
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    const envelope = protectManagerConnectionPayload(
      Buffer.from("private manager state"),
      context,
    );
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(() => revealManagerConnectionPayload(tampered, context)).toThrow();
  });

  it("keeps legacy XChaCha manager envelopes readable", () => {
    const key = randomBytes(32);
    vi.stubEnv("MANAGER_CONNECTION_ENCRYPTION_KEY", key.toString("base64"));
    const plaintext = Buffer.from("legacy manager state", "utf8");
    const envelope = createLegacyEnvelope(key, plaintext, context);

    expect(envelope).toMatch(/^mcx1\./);
    expect(revealManagerConnectionPayload(envelope, context)).toEqual(
      plaintext,
    );
  });

  it("supports a versioned keyring for controlled rotation", () => {
    const current = randomBytes(32).toString("base64");
    const next = randomBytes(32).toString("base64");
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEYRING",
      `current:${current},next:${next}`,
    );
    vi.stubEnv("MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID", "current");
    const envelope = protectManagerConnectionPayload(
      Buffer.from("coordinated"),
      context,
    );
    vi.stubEnv("MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID", "next");

    expect(revealManagerConnectionPayload(envelope, context).toString()).toBe(
      "coordinated",
    );
    expect(getManagerConnectionCryptoStatus()).toMatchObject({
      primitive: "AES-256-GCM",
      writeVersion: "mcg3",
      readableKeyCount: 2,
      keyMaterialExposed: false,
    });
  });

  it("requires an independent valid key in production", () => {
    const environment: NodeJS.ProcessEnv = {
      APP_ENV: "production",
      NODE_ENV: "production",
    };
    expect(() =>
      validateManagerConnectionCryptoConfiguration(environment),
    ).toThrow(/required in production/i);
    expect(() =>
      validateManagerConnectionCryptoConfiguration({
        ...environment,
        MANAGER_CONNECTION_ENCRYPTION_KEY: "invalid",
      }),
    ).toThrow(/32 random bytes|canonical base64/i);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const ENVELOPE_VERSION = "xcp1";
const NONCE_BYTES = 24;

export class PrivateContentCryptoError extends Error {}

function encryptionEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.PRIVATE_CONTENT_ENCRYPTION_ENABLED === "true";
}

function decodeKey(value: string): Uint8Array {
  const normalized = value.trim();
  let key: Buffer;
  if (/^[a-f\d]{64}$/i.test(normalized)) {
    key = Buffer.from(normalized, "hex");
  } else {
    const encoding =
      normalized.includes("-") || normalized.includes("_")
        ? "base64url"
        : "base64";
    key = Buffer.from(normalized, encoding);
  }
  if (key.length !== 32) {
    throw new PrivateContentCryptoError(
      "PRIVATE_CONTENT_ENCRYPTION_KEY must contain exactly 32 bytes",
    );
  }
  return key;
}

function activeKey(): Uint8Array {
  const value = process.env.PRIVATE_CONTENT_ENCRYPTION_KEY;
  if (!value) {
    throw new PrivateContentCryptoError(
      "PRIVATE_CONTENT_ENCRYPTION_KEY is required when private content encryption is enabled",
    );
  }
  return decodeKey(value);
}

export function validatePrivateContentEncryptionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!encryptionEnabled(environment)) return;
  const value = environment.PRIVATE_CONTENT_ENCRYPTION_KEY;
  if (!value) {
    throw new PrivateContentCryptoError(
      "PRIVATE_CONTENT_ENCRYPTION_KEY is required when private content encryption is enabled",
    );
  }
  decodeKey(value);
}

function fingerprint(key: Uint8Array): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function encodeEnvelope(plaintext: Uint8Array, context: string): string {
  const key = activeKey();
  const nonce = randomBytes(NONCE_BYTES);
  const aad = Buffer.from(`${ENVELOPE_VERSION}:${context}`, "utf8");
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return [
    ENVELOPE_VERSION,
    fingerprint(key),
    nonce.toString("base64url"),
    Buffer.from(ciphertext).toString("base64url"),
  ].join(".");
}

function decodeEnvelope(envelope: string, context: string): Buffer {
  const [version, storedFingerprint, nonceValue, ciphertextValue, extra] =
    envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !storedFingerprint ||
    !nonceValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new PrivateContentCryptoError("Private content envelope is invalid");
  }
  const key = activeKey();
  if (fingerprint(key) !== storedFingerprint) {
    throw new PrivateContentCryptoError(
      "Private content was encrypted with a different key",
    );
  }
  const nonce = Buffer.from(nonceValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (nonce.length !== NONCE_BYTES || ciphertext.length < 16) {
    throw new PrivateContentCryptoError("Private content envelope is invalid");
  }
  try {
    const aad = Buffer.from(`${ENVELOPE_VERSION}:${context}`, "utf8");
    return Buffer.from(xchacha20poly1305(key, nonce, aad).decrypt(ciphertext));
  } catch {
    throw new PrivateContentCryptoError(
      "Private content authentication failed",
    );
  }
}

export function isProtectedPrivateContent(value: string | Uint8Array): boolean {
  const prefix = `${ENVELOPE_VERSION}.`;
  return typeof value === "string"
    ? value.startsWith(prefix)
    : Buffer.from(value).subarray(0, prefix.length).toString("utf8") === prefix;
}

export function protectPrivateText(value: string, context: string): string {
  return encryptionEnabled()
    ? encodeEnvelope(Buffer.from(value, "utf8"), context)
    : value;
}

export function revealPrivateText(value: string, context: string): string {
  if (!isProtectedPrivateContent(value)) return value;
  return decodeEnvelope(value, context).toString("utf8");
}

export function protectPrivateBytes(
  value: Uint8Array,
  context: string,
): Buffer {
  return encryptionEnabled()
    ? Buffer.from(encodeEnvelope(value, context), "utf8")
    : Buffer.from(value);
}

export function revealPrivateBytes(value: Uint8Array, context: string): Buffer {
  if (!isProtectedPrivateContent(value)) return Buffer.from(value);
  return decodeEnvelope(Buffer.from(value).toString("utf8"), context);
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const LEGACY_ENVELOPE_VERSION = "xcp1";
const KEYRING_ENVELOPE_VERSION = "xcp2";
const AES_GCM_ENVELOPE_VERSION = "agc3";
const XCHACHA_NONCE_BYTES = 24;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface PrivateContentKey {
  id: string;
  key: Uint8Array;
  fingerprint: string;
}

interface PrivateContentKeyring {
  active: PrivateContentKey;
  keys: PrivateContentKey[];
  writeVersion: typeof AES_GCM_ENVELOPE_VERSION;
}

export interface PrivateContentEncryptionStatus {
  enabled: boolean;
  writeVersion: "plaintext" | "xcp1" | "xcp2" | "agc3";
  activeKeyId: string | null;
  readableKeyIds: string[];
  legacyKeyConfigured: boolean;
}

export class PrivateContentCryptoError extends Error {}

function encryptionEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.PRIVATE_CONTENT_ENCRYPTION_ENABLED === "true";
}

function decodeKey(value: string, variableName: string): Uint8Array {
  const normalized = value.trim();
  let key: Buffer;
  if (/^[a-f\d]{64}$/i.test(normalized)) {
    key = Buffer.from(normalized, "hex");
  } else {
    const encoding =
      normalized.includes("-") || normalized.includes("_")
        ? "base64url"
        : "base64";
    const encodedKeyPattern =
      encoding === "base64url"
        ? /^[A-Za-z0-9_-]+={0,2}$/
        : /^[A-Za-z0-9+/]+={0,2}$/;
    if (!encodedKeyPattern.test(normalized)) {
      throw new PrivateContentCryptoError(
        `${variableName} must be valid hexadecimal, base64, or base64url`,
      );
    }
    key = Buffer.from(normalized, encoding);
    const canonical = key.toString(encoding).replace(/=+$/u, "");
    if (canonical !== normalized.replace(/=+$/u, "")) {
      throw new PrivateContentCryptoError(
        `${variableName} must be valid hexadecimal, base64, or base64url`,
      );
    }
  }
  if (key.length !== 32) {
    throw new PrivateContentCryptoError(
      `${variableName} must contain exactly 32 bytes`,
    );
  }
  return key;
}

function fingerprint(key: Uint8Array): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function decodeBase64UrlSegment(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PrivateContentCryptoError("Private content envelope is invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new PrivateContentCryptoError("Private content envelope is invalid");
  }
  return decoded;
}

function parseVersionedKeys(
  environment: NodeJS.ProcessEnv,
): PrivateContentKey[] {
  const encoded = environment.PRIVATE_CONTENT_ENCRYPTION_KEYRING?.trim();
  if (!encoded) return [];

  const keys: PrivateContentKey[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const entry of encoded.split(",")) {
    const separator = entry.indexOf(":");
    const id = separator < 0 ? "" : entry.slice(0, separator).trim();
    const value = separator < 0 ? "" : entry.slice(separator + 1).trim();
    if (!KEY_ID_PATTERN.test(id) || !value) {
      throw new PrivateContentCryptoError(
        "PRIVATE_CONTENT_ENCRYPTION_KEYRING must use key-id:encoded-key entries separated by commas",
      );
    }
    if (id === "legacy") {
      throw new PrivateContentCryptoError(
        "PRIVATE_CONTENT_ENCRYPTION_KEYRING key id legacy is reserved for PRIVATE_CONTENT_ENCRYPTION_KEY",
      );
    }
    if (ids.has(id)) {
      throw new PrivateContentCryptoError(
        `PRIVATE_CONTENT_ENCRYPTION_KEYRING contains duplicate key id: ${id}`,
      );
    }
    const key = decodeKey(
      value,
      `PRIVATE_CONTENT_ENCRYPTION_KEYRING entry ${id}`,
    );
    const keyFingerprint = fingerprint(key);
    if (fingerprints.has(keyFingerprint)) {
      throw new PrivateContentCryptoError(
        "PRIVATE_CONTENT_ENCRYPTION_KEYRING contains the same key under more than one id",
      );
    }
    ids.add(id);
    fingerprints.add(keyFingerprint);
    keys.push({ id, key, fingerprint: keyFingerprint });
  }
  return keys;
}

function resolveKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): PrivateContentKeyring {
  const versionedKeys = parseVersionedKeys(environment);
  const legacyValue = environment.PRIVATE_CONTENT_ENCRYPTION_KEY?.trim();
  const legacyKey = legacyValue
    ? decodeKey(legacyValue, "PRIVATE_CONTENT_ENCRYPTION_KEY")
    : null;
  const legacyFingerprint = legacyKey ? fingerprint(legacyKey) : null;
  const keys = [...versionedKeys];

  if (
    legacyKey &&
    !keys.some((candidate) => candidate.fingerprint === legacyFingerprint)
  ) {
    keys.push({
      id: "legacy",
      key: legacyKey,
      fingerprint: legacyFingerprint as string,
    });
  }

  if (versionedKeys.length > 0) {
    const activeKeyId =
      environment.PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID?.trim();
    if (!activeKeyId) {
      throw new PrivateContentCryptoError(
        "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID is required when PRIVATE_CONTENT_ENCRYPTION_KEYRING is configured",
      );
    }
    const active = versionedKeys.find(
      (candidate) => candidate.id === activeKeyId,
    );
    if (!active) {
      throw new PrivateContentCryptoError(
        "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID does not exist in PRIVATE_CONTENT_ENCRYPTION_KEYRING",
      );
    }
    return { active, keys, writeVersion: AES_GCM_ENVELOPE_VERSION };
  }

  if (environment.PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID?.trim()) {
    throw new PrivateContentCryptoError(
      "PRIVATE_CONTENT_ENCRYPTION_KEYRING is required when PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID is configured",
    );
  }
  if (!legacyKey || !legacyFingerprint) {
    throw new PrivateContentCryptoError(
      "PRIVATE_CONTENT_ENCRYPTION_KEY or PRIVATE_CONTENT_ENCRYPTION_KEYRING is required when private content encryption is enabled",
    );
  }
  return {
    active: { id: "legacy", key: legacyKey, fingerprint: legacyFingerprint },
    keys,
    writeVersion: AES_GCM_ENVELOPE_VERSION,
  };
}

export function validatePrivateContentEncryptionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!encryptionEnabled(environment)) return;
  resolveKeyring(environment);
}

export function getPrivateContentEncryptionStatus(
  environment: NodeJS.ProcessEnv = process.env,
): PrivateContentEncryptionStatus {
  if (!encryptionEnabled(environment)) {
    return {
      enabled: false,
      writeVersion: "plaintext",
      activeKeyId: null,
      readableKeyIds: [],
      legacyKeyConfigured: Boolean(
        environment.PRIVATE_CONTENT_ENCRYPTION_KEY?.trim(),
      ),
    };
  }
  const keyring = resolveKeyring(environment);
  return {
    enabled: true,
    writeVersion: keyring.writeVersion,
    activeKeyId: keyring.active.id,
    readableKeyIds: keyring.keys.map((candidate) => candidate.id),
    legacyKeyConfigured: Boolean(
      environment.PRIVATE_CONTENT_ENCRYPTION_KEY?.trim(),
    ),
  };
}

function encodeEnvelope(plaintext: Uint8Array, context: string): string {
  const keyring = resolveKeyring();
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const aad = Buffer.from(
    `${AES_GCM_ENVELOPE_VERSION}:${keyring.active.id}:${context}`,
    "utf8",
  );
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(keyring.active.key),
    nonce,
    { authTagLength: AES_GCM_TAG_BYTES },
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const authenticatedCiphertext = Buffer.concat([
    ciphertext,
    cipher.getAuthTag(),
  ]);
  return [
    AES_GCM_ENVELOPE_VERSION,
    keyring.active.id,
    nonce.toString("base64url"),
    authenticatedCiphertext.toString("base64url"),
  ].join(".");
}

function decodeEnvelope(envelope: string, context: string): Buffer {
  const [version, keyReference, nonceValue, ciphertextValue, extra] =
    envelope.split(".");
  if (
    (version !== LEGACY_ENVELOPE_VERSION &&
      version !== KEYRING_ENVELOPE_VERSION &&
      version !== AES_GCM_ENVELOPE_VERSION) ||
    !keyReference ||
    !nonceValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new PrivateContentCryptoError("Private content envelope is invalid");
  }
  const keyring = resolveKeyring();
  const selected =
    version === LEGACY_ENVELOPE_VERSION
      ? keyring.keys.find((candidate) => candidate.fingerprint === keyReference)
      : keyring.keys.find((candidate) => candidate.id === keyReference);
  if (!selected) {
    throw new PrivateContentCryptoError(
      "Private content was encrypted with an unavailable key",
    );
  }
  const nonce = decodeBase64UrlSegment(nonceValue);
  const ciphertext = decodeBase64UrlSegment(ciphertextValue);
  try {
    if (version === AES_GCM_ENVELOPE_VERSION) {
      if (
        nonce.length !== AES_GCM_NONCE_BYTES ||
        ciphertext.length < AES_GCM_TAG_BYTES
      ) {
        throw new PrivateContentCryptoError(
          "Private content envelope is invalid",
        );
      }
      const aad = Buffer.from(
        `${AES_GCM_ENVELOPE_VERSION}:${keyReference}:${context}`,
        "utf8",
      );
      const tagOffset = ciphertext.length - AES_GCM_TAG_BYTES;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(selected.key),
        nonce,
        { authTagLength: AES_GCM_TAG_BYTES },
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(ciphertext.subarray(tagOffset));
      return Buffer.concat([
        decipher.update(ciphertext.subarray(0, tagOffset)),
        decipher.final(),
      ]);
    }
    if (nonce.length !== XCHACHA_NONCE_BYTES || ciphertext.length < 16) {
      throw new PrivateContentCryptoError(
        "Private content envelope is invalid",
      );
    }
    const aad = Buffer.from(
      version === LEGACY_ENVELOPE_VERSION
        ? `${LEGACY_ENVELOPE_VERSION}:${context}`
        : `${KEYRING_ENVELOPE_VERSION}:${keyReference}:${context}`,
      "utf8",
    );
    return Buffer.from(
      xchacha20poly1305(selected.key, nonce, aad).decrypt(ciphertext),
    );
  } catch {
    throw new PrivateContentCryptoError(
      "Private content authentication failed",
    );
  }
}

function detectEnvelopeVersion(
  value: string | Uint8Array,
):
  | typeof LEGACY_ENVELOPE_VERSION
  | typeof KEYRING_ENVELOPE_VERSION
  | typeof AES_GCM_ENVELOPE_VERSION
  | null {
  const prefix =
    typeof value === "string"
      ? value.slice(0, 5)
      : Buffer.from(value.subarray(0, 5)).toString("utf8");
  if (prefix === `${LEGACY_ENVELOPE_VERSION}.`) {
    return LEGACY_ENVELOPE_VERSION;
  }
  if (prefix === `${KEYRING_ENVELOPE_VERSION}.`) {
    return KEYRING_ENVELOPE_VERSION;
  }
  if (prefix === `${AES_GCM_ENVELOPE_VERSION}.`) {
    return AES_GCM_ENVELOPE_VERSION;
  }
  return null;
}

export function isProtectedPrivateContent(value: string | Uint8Array): boolean {
  return detectEnvelopeVersion(value) !== null;
}

export function privateContentNeedsRewrap(
  value: string | Uint8Array,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!encryptionEnabled(environment)) return false;
  const keyring = resolveKeyring(environment);
  const detectedVersion = detectEnvelopeVersion(value);
  if (!detectedVersion) return true;
  const text =
    typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  const [version, keyReference] = text.split(".");
  return (
    version !== keyring.writeVersion ||
    (version === AES_GCM_ENVELOPE_VERSION && keyReference !== keyring.active.id)
  );
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

export function rewrapPrivateText(value: string, context: string): string {
  if (!privateContentNeedsRewrap(value)) return value;
  return protectPrivateText(revealPrivateText(value, context), context);
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
  if (!detectEnvelopeVersion(value)) return Buffer.from(value);
  return decodeEnvelope(Buffer.from(value).toString("utf8"), context);
}

export function rewrapPrivateBytes(value: Uint8Array, context: string): Buffer {
  if (!privateContentNeedsRewrap(value)) return Buffer.from(value);
  return protectPrivateBytes(revealPrivateBytes(value, context), context);
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  isProductionLike,
  resolveDeploymentProfile,
} from "./deployment-profile.js";

const LEGACY_VERSION = "mcx1";
const KEYRING_VERSION = "mcx2";
const AES_GCM_VERSION = "mcg3";
const XCHACHA_NONCE_BYTES = 24;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONTEXT_PATTERN = /^[A-Za-z0-9:_-]{1,240}$/;

interface ConnectionKey {
  id: string;
  value: Uint8Array;
  fingerprint: string;
}

interface ConnectionKeyring {
  active: ConnectionKey;
  keys: ConnectionKey[];
  version: typeof AES_GCM_VERSION;
  developmentFallback: boolean;
}

export class ManagerConnectionCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagerConnectionCryptoError";
  }
}

function decodeKey(value: string, name: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new ManagerConnectionCryptoError(
      `${name} must be valid canonical base64`,
    );
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== normalized) {
    throw new ManagerConnectionCryptoError(
      `${name} must be exactly 32 random bytes encoded as base64`,
    );
  }
  return decoded;
}

function fingerprint(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseVersionedKeys(environment: NodeJS.ProcessEnv): ConnectionKey[] {
  const configured = environment.MANAGER_CONNECTION_ENCRYPTION_KEYRING?.trim();
  if (!configured) return [];
  const keys: ConnectionKey[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const entry of configured.split(",")) {
    const separator = entry.indexOf(":");
    const id = separator < 0 ? "" : entry.slice(0, separator).trim();
    const encoded = separator < 0 ? "" : entry.slice(separator + 1).trim();
    if (!KEY_ID_PATTERN.test(id) || !encoded) {
      throw new ManagerConnectionCryptoError(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING must use key-id:base64-key entries separated by commas",
      );
    }
    if (id === "legacy" || ids.has(id)) {
      throw new ManagerConnectionCryptoError(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING contains a reserved or duplicate key id",
      );
    }
    const value = decodeKey(
      encoded,
      `MANAGER_CONNECTION_ENCRYPTION_KEYRING entry ${id}`,
    );
    const keyFingerprint = fingerprint(value);
    if (fingerprints.has(keyFingerprint)) {
      throw new ManagerConnectionCryptoError(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING repeats key material under multiple ids",
      );
    }
    ids.add(id);
    fingerprints.add(keyFingerprint);
    keys.push({ id, value, fingerprint: keyFingerprint });
  }
  return keys;
}

function resolveKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): ConnectionKeyring {
  const versioned = parseVersionedKeys(environment);
  const legacyEncoded = environment.MANAGER_CONNECTION_ENCRYPTION_KEY?.trim();
  const legacyValue = legacyEncoded
    ? decodeKey(legacyEncoded, "MANAGER_CONNECTION_ENCRYPTION_KEY")
    : null;
  const keys = [...versioned];
  if (legacyValue) {
    const legacyFingerprint = fingerprint(legacyValue);
    if (!keys.some((key) => key.fingerprint === legacyFingerprint)) {
      keys.push({
        id: "legacy",
        value: legacyValue,
        fingerprint: legacyFingerprint,
      });
    }
  }

  if (versioned.length > 0) {
    const activeId =
      environment.MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID?.trim();
    const active = versioned.find((key) => key.id === activeId);
    if (!active) {
      throw new ManagerConnectionCryptoError(
        "MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID must select a configured keyring entry",
      );
    }
    return {
      active,
      keys,
      version: AES_GCM_VERSION,
      developmentFallback: false,
    };
  }

  if (environment.MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID?.trim()) {
    throw new ManagerConnectionCryptoError(
      "MANAGER_CONNECTION_ENCRYPTION_KEYRING is required when an active key id is configured",
    );
  }
  if (legacyValue) {
    const active = keys.find((key) => key.id === "legacy")!;
    return {
      active,
      keys,
      version: AES_GCM_VERSION,
      developmentFallback: false,
    };
  }

  const productionLike = isProductionLike(
    resolveDeploymentProfile(environment),
  );
  if (productionLike) {
    throw new ManagerConnectionCryptoError(
      "A manager connection encryption key is required in production",
    );
  }
  const developmentValue = createHash("sha256")
    .update("umbravia-forge-development-manager-connections")
    .digest();
  const active = {
    id: "development",
    value: developmentValue,
    fingerprint: fingerprint(developmentValue),
  };
  return {
    active,
    keys: [active],
    version: AES_GCM_VERSION,
    developmentFallback: true,
  };
}

function decodeSegment(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ManagerConnectionCryptoError(
      "Manager connection envelope is invalid",
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new ManagerConnectionCryptoError(
      "Manager connection envelope is invalid",
    );
  }
  return decoded;
}

function validateContext(context: string): void {
  if (!CONTEXT_PATTERN.test(context)) {
    throw new ManagerConnectionCryptoError(
      "Manager connection context is invalid",
    );
  }
}

export function protectManagerConnectionPayload(
  value: Uint8Array,
  context: string,
): string {
  validateContext(context);
  const keyring = resolveKeyring();
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const reference = keyring.active.id;
  const aad = Buffer.from(`${keyring.version}:${reference}:${context}`, "utf8");
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(keyring.active.value),
    nonce,
    { authTagLength: AES_GCM_TAG_BYTES },
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(value)),
    cipher.final(),
  ]);
  const authenticatedCiphertext = Buffer.concat([
    ciphertext,
    cipher.getAuthTag(),
  ]);
  return [
    keyring.version,
    reference,
    nonce.toString("base64url"),
    authenticatedCiphertext.toString("base64url"),
  ].join(".");
}

export function revealManagerConnectionPayload(
  envelope: string,
  context: string,
): Buffer {
  validateContext(context);
  const [version, reference, nonceValue, ciphertextValue, extra] =
    envelope.split(".");
  if (
    (version !== LEGACY_VERSION &&
      version !== KEYRING_VERSION &&
      version !== AES_GCM_VERSION) ||
    !reference ||
    !nonceValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new ManagerConnectionCryptoError(
      "Manager connection envelope is invalid",
    );
  }
  const keyring = resolveKeyring();
  const selected =
    version === LEGACY_VERSION
      ? keyring.keys.find((key) => key.fingerprint === reference)
      : keyring.keys.find((key) => key.id === reference);
  if (!selected) {
    throw new ManagerConnectionCryptoError(
      "Manager connection envelope requires an unavailable key",
    );
  }
  const nonce = decodeSegment(nonceValue);
  const ciphertext = decodeSegment(ciphertextValue);
  try {
    const aad = Buffer.from(`${version}:${reference}:${context}`, "utf8");
    if (version === AES_GCM_VERSION) {
      if (
        nonce.length !== AES_GCM_NONCE_BYTES ||
        ciphertext.length < AES_GCM_TAG_BYTES
      ) {
        throw new ManagerConnectionCryptoError(
          "Manager connection envelope is invalid",
        );
      }
      const tagOffset = ciphertext.length - AES_GCM_TAG_BYTES;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(selected.value),
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
      throw new ManagerConnectionCryptoError(
        "Manager connection envelope is invalid",
      );
    }
    return Buffer.from(
      xchacha20poly1305(selected.value, nonce, aad).decrypt(ciphertext),
    );
  } catch {
    throw new ManagerConnectionCryptoError(
      "Manager connection envelope authentication failed",
    );
  }
}

export function getManagerConnectionCryptoStatus(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const keyring = resolveKeyring(environment);
  return {
    enabled: true as const,
    primitive: "AES-256-GCM" as const,
    writeVersion: keyring.version,
    readableKeyCount: keyring.keys.length,
    developmentFallback: keyring.developmentFallback,
    keyMaterialExposed: false as const,
  };
}

export function validateManagerConnectionCryptoConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  resolveKeyring(environment);
}

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const envFile = process.argv[2];
if (!envFile) throw new Error("Falta la ruta del archivo de entorno");

const source = await readFile(envFile, "utf8");
const values = new Map();
for (const line of source.split(/\r?\n/u)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
  if (!match) continue;
  let value = match[2].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  values.set(match[1], value);
}

if (values.get("PRIVATE_CONTENT_ENCRYPTION_ENABLED") !== "true") {
  process.exit(2);
}

function decodeKey(encoded, label) {
  if (!encoded) throw new Error(`${label} esta vacia`);
  let key;
  if (/^[a-f\d]{64}$/iu.test(encoded)) {
    key = Buffer.from(encoded, "hex");
  } else {
    const encoding =
      encoded.includes("-") || encoded.includes("_") ? "base64url" : "base64";
    const encodedKeyPattern =
      encoding === "base64url"
        ? /^[A-Za-z0-9_-]+={0,2}$/u
        : /^[A-Za-z0-9+/]+={0,2}$/u;
    if (!encodedKeyPattern.test(encoded)) {
      throw new Error(`${label} no tiene una codificacion valida`);
    }
    key = Buffer.from(encoded, encoding);
    const canonical = key.toString(encoding).replace(/=+$/u, "");
    if (canonical !== encoded.replace(/=+$/u, "")) {
      throw new Error(`${label} no tiene una codificacion valida`);
    }
  }
  if (key.length !== 32) throw new Error(`${label} debe contener 32 bytes`);
  return key;
}

function verifyCipher(key, label) {
  const nonce = Buffer.alloc(24, 0);
  const plaintext = Buffer.from(`umbravia-linux-readiness:${label}`, "utf8");
  const cipher = xchacha20poly1305(key, nonce);
  const recovered = cipher.decrypt(cipher.encrypt(plaintext));
  if (!Buffer.from(recovered).equals(plaintext)) {
    throw new Error(`XChaCha20-Poly1305 no supera la prueba local: ${label}`);
  }
}

const legacyEncoded = values.get("PRIVATE_CONTENT_ENCRYPTION_KEY");
if (legacyEncoded) {
  verifyCipher(
    decodeKey(legacyEncoded, "PRIVATE_CONTENT_ENCRYPTION_KEY"),
    "legacy",
  );
}

const encodedKeyring = values.get("PRIVATE_CONTENT_ENCRYPTION_KEYRING");
const activeKeyId = values.get("PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID");
const versionedKeys = new Map();
const versionedFingerprints = new Set();
if (encodedKeyring) {
  for (const rawEntry of encodedKeyring.split(",")) {
    const separator = rawEntry.indexOf(":");
    const id = separator < 0 ? "" : rawEntry.slice(0, separator).trim();
    const encoded = separator < 0 ? "" : rawEntry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id) || !encoded) {
      throw new Error(
        "PRIVATE_CONTENT_ENCRYPTION_KEYRING debe usar id:clave separados por comas",
      );
    }
    if (id === "legacy") {
      throw new Error(
        "El identificador legacy esta reservado para PRIVATE_CONTENT_ENCRYPTION_KEY",
      );
    }
    if (versionedKeys.has(id)) {
      throw new Error(`Identificador de clave duplicado: ${id}`);
    }
    const key = decodeKey(encoded, `clave ${id}`);
    const keyFingerprint = createHash("sha256").update(key).digest("hex");
    if (versionedFingerprints.has(keyFingerprint)) {
      throw new Error(
        "PRIVATE_CONTENT_ENCRYPTION_KEYRING repite la misma clave bajo identificadores distintos",
      );
    }
    verifyCipher(key, id);
    versionedFingerprints.add(keyFingerprint);
    versionedKeys.set(id, key);
  }
  if (!activeKeyId || !versionedKeys.has(activeKeyId)) {
    throw new Error(
      "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID no identifica una clave disponible",
    );
  }
} else if (activeKeyId) {
  throw new Error(
    "PRIVATE_CONTENT_ENCRYPTION_KEYRING es obligatorio cuando se configura una clave activa",
  );
}

if (!legacyEncoded && versionedKeys.size === 0) {
  throw new Error(
    "Falta PRIVATE_CONTENT_ENCRYPTION_KEY o PRIVATE_CONTENT_ENCRYPTION_KEYRING",
  );
}

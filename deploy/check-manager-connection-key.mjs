import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

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

function decodeKey(encoded, label) {
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error(`${label} no tiene una codificacion base64 valida`);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error(`${label} debe contener exactamente 32 bytes`);
  }
  return key;
}

const fingerprints = new Set();
const legacyEncoded = values.get("MANAGER_CONNECTION_ENCRYPTION_KEY");
if (legacyEncoded) {
  fingerprints.add(
    createHash("sha256")
      .update(decodeKey(legacyEncoded, "MANAGER_CONNECTION_ENCRYPTION_KEY"))
      .digest("hex"),
  );
}

const encodedKeyring = values.get("MANAGER_CONNECTION_ENCRYPTION_KEYRING");
const activeKeyId = values.get("MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID");
const versionedKeys = new Set();
if (encodedKeyring) {
  for (const rawEntry of encodedKeyring.split(",")) {
    const separator = rawEntry.indexOf(":");
    const id = separator < 0 ? "" : rawEntry.slice(0, separator).trim();
    const encoded = separator < 0 ? "" : rawEntry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id) || !encoded) {
      throw new Error(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING debe usar id:clave separados por comas",
      );
    }
    if (id === "legacy" || versionedKeys.has(id)) {
      throw new Error(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING contiene un identificador reservado o duplicado",
      );
    }
    const fingerprint = createHash("sha256")
      .update(decodeKey(encoded, `clave ${id}`))
      .digest("hex");
    if (fingerprints.has(fingerprint)) {
      throw new Error(
        "MANAGER_CONNECTION_ENCRYPTION_KEYRING repite material de clave",
      );
    }
    fingerprints.add(fingerprint);
    versionedKeys.add(id);
  }
  if (!activeKeyId || !versionedKeys.has(activeKeyId)) {
    throw new Error(
      "MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID no identifica una clave disponible",
    );
  }
} else if (activeKeyId) {
  throw new Error(
    "MANAGER_CONNECTION_ENCRYPTION_KEYRING es obligatorio cuando se configura una clave activa",
  );
}

if (!legacyEncoded && versionedKeys.size === 0) {
  throw new Error(
    "Falta MANAGER_CONNECTION_ENCRYPTION_KEY o MANAGER_CONNECTION_ENCRYPTION_KEYRING",
  );
}

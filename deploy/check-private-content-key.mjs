import { Buffer } from "node:buffer";
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

const encoded = values.get("PRIVATE_CONTENT_ENCRYPTION_KEY");
if (!encoded) throw new Error("PRIVATE_CONTENT_ENCRYPTION_KEY esta vacia");

let key;
if (/^[a-f\d]{64}$/iu.test(encoded)) {
  key = Buffer.from(encoded, "hex");
} else {
  const encoding =
    encoded.includes("-") || encoded.includes("_") ? "base64url" : "base64";
  key = Buffer.from(encoded, encoding);
}
if (key.length !== 32) {
  throw new Error("PRIVATE_CONTENT_ENCRYPTION_KEY debe contener 32 bytes");
}

const nonce = Buffer.alloc(24, 0);
const plaintext = Buffer.from("umbravia-linux-readiness", "utf8");
const cipher = xchacha20poly1305(key, nonce);
const ciphertext = cipher.encrypt(plaintext);
const recovered = cipher.decrypt(ciphertext);
if (!Buffer.from(recovered).equals(plaintext)) {
  throw new Error("XChaCha20-Poly1305 no supera la prueba local");
}

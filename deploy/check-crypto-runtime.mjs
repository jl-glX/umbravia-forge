import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2id, hash as argon2Hash, verify as argon2Verify } from "argon2";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(operation, message) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function checkNodeCrypto() {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const aad = Buffer.from("umbravia-runtime:aes-256-gcm", "utf8");
  const plaintext = Buffer.from("umbravia-linux-readiness", "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const recovered = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  assert(recovered.equals(plaintext), "AES-256-GCM roundtrip failed");
  const invalidTag = Buffer.from(tag);
  invalidTag[0] ^= 1;
  assertThrows(() => {
    const tamperedDecipher = createDecipheriv("aes-256-gcm", key, iv);
    tamperedDecipher.setAAD(aad);
    tamperedDecipher.setAuthTag(invalidTag);
    tamperedDecipher.update(ciphertext);
    tamperedDecipher.final();
  }, "AES-256-GCM accepted a modified authentication tag");

  const digest = createHash("sha256").update(plaintext).digest();
  assert(digest.length === 32, "SHA-256 output length is invalid");
  const derived = scryptSync("temporary-code", "temporary-salt", 32);
  assert(derived.length === 32, "scrypt output length is invalid");
}

function checkXChaCha() {
  const key = randomBytes(32);
  const nonce = randomBytes(24);
  const aad = Buffer.from("umbravia-runtime:xchacha20", "utf8");
  const plaintext = Buffer.from("umbravia-linux-readiness", "utf8");
  const cipher = xchacha20poly1305(key, nonce, aad);
  const ciphertext = cipher.encrypt(plaintext);
  const recovered = Buffer.from(cipher.decrypt(ciphertext));
  assert(recovered.equals(plaintext), "XChaCha20-Poly1305 roundtrip failed");
  const tamperedCiphertext = Buffer.from(ciphertext);
  tamperedCiphertext[0] ^= 1;
  assertThrows(
    () => cipher.decrypt(tamperedCiphertext),
    "XChaCha20-Poly1305 accepted modified ciphertext",
  );
}

async function checkArgon2id() {
  const password = "umbravia-linux-readiness";
  const encoded = await argon2Hash(password, {
    type: argon2id,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
  });
  assert(
    encoded.startsWith("$argon2id$"),
    "Argon2 runtime did not use Argon2id",
  );
  assert(await argon2Verify(encoded, password), "Argon2id verification failed");
  assert(
    !(await argon2Verify(encoded, `${password}-incorrect`)),
    "Argon2id accepted an incorrect password",
  );
}

try {
  checkNodeCrypto();
  checkXChaCha();
  await checkArgon2id();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`crypto runtime check failed: ${message}\n`);
  process.exit(1);
}

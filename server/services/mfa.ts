import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { db } from "../db/client.js";
import { recordSecurityEvent } from "./security-events.js";

const ISSUER = "Umbravia Forge";
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_HASH_VERSION = "v2";

function decodeBase64(value: string, label: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new Error(`${label} must be valid base64`);
  }
  const decoded = Buffer.from(normalized, "base64");
  if (
    decoded.toString("base64").replace(/=+$/u, "") !==
    normalized.replace(/=+$/u, "")
  ) {
    throw new Error(`${label} must be valid base64`);
  }
  return decoded;
}

function encryptionKey(): Buffer {
  const configuredKey = process.env.MFA_ENCRYPTION_KEY;
  if (configuredKey) {
    const key = decodeBase64(configuredKey, "MFA_ENCRYPTION_KEY");
    if (key.length !== 32) {
      throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes encoded as base64");
    }
    return key;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("MFA_ENCRYPTION_KEY is required in production");
  }

  const dataDirectory =
    process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data");
  const keyPath = path.join(dataDirectory, "mfa-encryption.key");
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, randomBytes(32).toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  const key = decodeBase64(
    fs.readFileSync(keyPath, "utf8").trim(),
    "The local MFA encryption key",
  );
  if (key.length !== 32) {
    throw new Error("The local MFA encryption key is invalid");
  }
  return key;
}

function encryptSecret(secret: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`mfa-secret:v2:${userId}`, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(value: string, userId: string): string {
  const [version, iv, tag, encrypted, extra] = value.split(":");
  if (
    (version !== "v1" && version !== "v2") ||
    !iv ||
    !tag ||
    !encrypted ||
    extra !== undefined
  ) {
    throw new Error("Unsupported encrypted MFA secret");
  }
  const ivBuffer = decodeBase64(iv, "MFA secret IV");
  const tagBuffer = decodeBase64(tag, "MFA secret authentication tag");
  const encryptedBuffer = decodeBase64(encrypted, "Encrypted MFA secret");
  if (ivBuffer.length !== 12 || tagBuffer.length !== 16) {
    throw new Error("Unsupported encrypted MFA secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), ivBuffer);
  if (version === "v2") {
    decipher.setAAD(Buffer.from(`mfa-secret:v2:${userId}`, "utf8"));
  }
  decipher.setAuthTag(tagBuffer);
  return Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]).toString("utf8");
}

function totp(secret: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

function normaliseCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function recoveryCodeDigest(code: string, key: Uint8Array): string {
  return createHmac("sha256", key).update(normaliseCode(code)).digest("hex");
}

function recoveryCodeHash(code: string): string {
  const domainSeparatedKey = createHmac("sha256", encryptionKey())
    .update("umbravia:mfa-recovery:v2")
    .digest();
  return `${RECOVERY_CODE_HASH_VERSION}:${recoveryCodeDigest(code, domainSeparatedKey)}`;
}

function recoveryCodeMatches(code: string, stored: string): boolean {
  const [version, versionedDigest, extra] = stored.split(":");
  if (version === RECOVERY_CODE_HASH_VERSION) {
    if (!versionedDigest || extra !== undefined) return false;
    const domainSeparatedKey = createHmac("sha256", encryptionKey())
      .update("umbravia:mfa-recovery:v2")
      .digest();
    return safeHashEquals(
      versionedDigest,
      recoveryCodeDigest(code, domainSeparatedKey),
    );
  }
  // Legacy hashes used the AES key directly as the HMAC key. They remain
  // readable until each one-time code is consumed or regenerated.
  return safeHashEquals(stored, recoveryCodeDigest(code, encryptionKey()));
}

function safeHashEquals(left: string, right: string): boolean {
  if (!/^[a-f\d]{64}$/iu.test(left) || !/^[a-f\d]{64}$/iu.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const value = randomBytes(6).toString("hex").toUpperCase();
    return `${value.slice(0, 6)}-${value.slice(6)}`;
  });
}

export async function mfaStatus(userId: string) {
  const credential = await db
    .selectFrom("mfaCredentials")
    .select(["enabledAt", "recoveryCodeHashes"])
    .where("userId", "=", userId)
    .executeTakeFirst();

  return {
    enabled: credential?.enabledAt != null,
    enabledAt: credential?.enabledAt ?? null,
    recoveryCodesRemaining: credential
      ? (JSON.parse(credential.recoveryCodeHashes) as string[]).length
      : 0,
  };
}

export async function beginMfaSetup(userId: string, email: string) {
  const existing = await db
    .selectFrom("mfaCredentials")
    .select("enabledAt")
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (existing?.enabledAt != null) {
    throw new Error("MFA is already enabled");
  }

  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const now = Date.now();

  await db
    .insertInto("mfaCredentials")
    .values({
      userId,
      secretEncrypted: encryptSecret(secret, userId),
      recoveryCodeHashes: "[]",
      createdAt: now,
      updatedAt: now,
      enabledAt: null,
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        secretEncrypted: encryptSecret(secret, userId),
        recoveryCodeHashes: "[]",
        updatedAt: now,
        enabledAt: null,
      }),
    )
    .execute();

  const uri = totp(secret, email).toString();
  return {
    secret,
    uri,
    qrCodeDataUrl: await QRCode.toDataURL(uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    }),
  };
}

export async function enableMfa(
  userId: string,
  email: string,
  code: string,
): Promise<string[]> {
  const credential = await db
    .selectFrom("mfaCredentials")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!credential || credential.enabledAt != null) {
    throw new Error("MFA setup has not been started");
  }

  const secret = decryptSecret(credential.secretEncrypted, userId);
  if (
    totp(secret, email).validate({ token: normaliseCode(code), window: 1 }) ===
    null
  ) {
    throw new Error("Invalid verification code");
  }

  const recoveryCodes = createRecoveryCodes();
  const now = Date.now();
  const enabled = await db
    .updateTable("mfaCredentials")
    .set({
      secretEncrypted: credential.secretEncrypted.startsWith("v1:")
        ? encryptSecret(secret, userId)
        : credential.secretEncrypted,
      recoveryCodeHashes: JSON.stringify(recoveryCodes.map(recoveryCodeHash)),
      enabledAt: now,
      updatedAt: now,
    })
    .where("userId", "=", userId)
    .where("enabledAt", "is", null)
    .where("secretEncrypted", "=", credential.secretEncrypted)
    .executeTakeFirst();
  if (Number(enabled.numUpdatedRows) !== 1) {
    throw new Error("MFA setup state changed; start setup again");
  }
  await recordSecurityEvent("mfa_enabled", userId);
  return recoveryCodes;
}

export async function verifyMfaCode(
  userId: string,
  email: string,
  code: string,
): Promise<{ valid: boolean; usedRecoveryCode: boolean }> {
  const credential = await db
    .selectFrom("mfaCredentials")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!credential?.enabledAt) return { valid: false, usedRecoveryCode: false };

  const normalised = normaliseCode(code);
  const secret = decryptSecret(credential.secretEncrypted, userId);
  if (totp(secret, email).validate({ token: normalised, window: 1 }) !== null) {
    if (credential.secretEncrypted.startsWith("v1:")) {
      await db
        .updateTable("mfaCredentials")
        .set({
          secretEncrypted: encryptSecret(secret, userId),
          updatedAt: Date.now(),
        })
        .where("userId", "=", userId)
        .execute();
    }
    return { valid: true, usedRecoveryCode: false };
  }

  const hashes = JSON.parse(credential.recoveryCodeHashes) as string[];
  const index = hashes.findIndex((hash) =>
    recoveryCodeMatches(normalised, hash),
  );
  if (index === -1) return { valid: false, usedRecoveryCode: false };

  hashes.splice(index, 1);
  const consumed = await db
    .updateTable("mfaCredentials")
    .set({ recoveryCodeHashes: JSON.stringify(hashes), updatedAt: Date.now() })
    .where("userId", "=", userId)
    .where("enabledAt", "is not", null)
    .where("recoveryCodeHashes", "=", credential.recoveryCodeHashes)
    .executeTakeFirst();
  if (Number(consumed.numUpdatedRows) !== 1) {
    return { valid: false, usedRecoveryCode: false };
  }
  await recordSecurityEvent("mfa_recovery_code_used", userId, {
    remaining: hashes.length,
  });
  return { valid: true, usedRecoveryCode: true };
}

export async function regenerateRecoveryCodes(
  userId: string,
): Promise<string[]> {
  const recoveryCodes = createRecoveryCodes();
  const regenerated = await db
    .updateTable("mfaCredentials")
    .set({
      recoveryCodeHashes: JSON.stringify(recoveryCodes.map(recoveryCodeHash)),
      updatedAt: Date.now(),
    })
    .where("userId", "=", userId)
    .where("enabledAt", "is not", null)
    .executeTakeFirst();
  if (Number(regenerated.numUpdatedRows) !== 1) {
    throw new Error("MFA is not enabled");
  }
  await recordSecurityEvent("recovery_codes_regenerated", userId);
  return recoveryCodes;
}

export async function disableMfa(userId: string): Promise<void> {
  await db.deleteFrom("mfaCredentials").where("userId", "=", userId).execute();
  await recordSecurityEvent("mfa_disabled", userId);
}

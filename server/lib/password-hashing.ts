import {
  argon2id,
  hash as argon2Hash,
  needsRehash as argon2NeedsRehash,
  verify as argon2Verify,
} from "argon2";
import bcryptjs from "bcryptjs";

export const ARGON2ID_OPTIONS = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

const DUMMY_PASSWORD = "UmbraviaInvalidPasswordComparison123";
let dummyHash: Promise<string> | null = null;

export async function hashPasswordWithArgon2id(
  password: string,
): Promise<string> {
  return argon2Hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPasswordHash(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    if (encodedHash.startsWith("$argon2id$")) {
      return await argon2Verify(encodedHash, password);
    }
    if (/^\$2[aby]\$/.test(encodedHash)) {
      return await bcryptjs.compare(password, encodedHash);
    }
    return false;
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(encodedHash: string): boolean {
  if (!encodedHash.startsWith("$argon2id$")) return true;
  try {
    return argon2NeedsRehash(encodedHash, ARGON2ID_OPTIONS);
  } catch {
    return true;
  }
}

export async function performDummyPasswordVerification(
  password: string,
): Promise<void> {
  dummyHash ??= hashPasswordWithArgon2id(DUMMY_PASSWORD);
  await verifyPasswordHash(password, await dummyHash);
}

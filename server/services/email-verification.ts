import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "../db/client.js";
import { recordSecurityEvent } from "./security-events.js";
import { finalizeAdministratorSignupInTransaction } from "./commercial-trial.js";

const CHALLENGE_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type PendingEmailVerificationProfile = {
  email: string;
  name: string;
  locale: "es" | "en" | "de" | "de-CH";
};

function hashCode(
  code: string,
  salt = randomBytes(16).toString("hex"),
): string {
  const digest = scryptSync(code, salt, 32).toString("hex");
  return `${salt}:${digest}`;
}

function codeMatches(code: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(code, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createEmailVerificationChallenge(
  userId: string,
): Promise<{ code: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + CHALLENGE_DURATION_MS;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db
    .deleteFrom("emailVerificationChallenges")
    .where("userId", "=", userId)
    .execute();
  await db
    .insertInto("emailVerificationChallenges")
    .values({
      id: `email-verification-${randomBytes(12).toString("hex")}`,
      userId,
      codeHash: hashCode(code),
      createdAt: now,
      expiresAt,
      attempts: 0,
      consumedAt: null,
    })
    .execute();
  return { code, expiresAt };
}

export async function getPendingEmailVerificationProfile(
  userId: string,
): Promise<PendingEmailVerificationProfile | null> {
  const user = await db
    .selectFrom("users")
    .select(["email", "name", "locale", "accountStatus"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user || user.accountStatus !== "pending_verification") return null;
  const locale = ["es", "en", "de", "de-CH"].includes(user.locale)
    ? (user.locale as PendingEmailVerificationProfile["locale"])
    : "es";
  return {
    email: user.email,
    name: user.name,
    locale,
  };
}

export async function verifyEmailCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const challenge = await db
    .selectFrom("emailVerificationChallenges")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();
  const now = Date.now();
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= now ||
    challenge.attempts >= MAX_ATTEMPTS
  ) {
    return false;
  }
  if (!codeMatches(code, challenge.codeHash)) {
    await db
      .updateTable("emailVerificationChallenges")
      .set((expression) => ({
        attempts: expression("attempts", "+", 1),
      }))
      .where("id", "=", challenge.id)
      .where("attempts", "<", MAX_ATTEMPTS)
      .where("consumedAt", "is", null)
      .where("expiresAt", ">", now)
      .execute();
    return false;
  }
  const activated = await db.transaction().execute(async (transaction) => {
    const consumed = await transaction
      .updateTable("emailVerificationChallenges")
      .set({ consumedAt: now })
      .where("id", "=", challenge.id)
      .where("consumedAt", "is", null)
      .where("expiresAt", ">", now)
      .where("attempts", "<", MAX_ATTEMPTS)
      .executeTakeFirst();
    if (Number(consumed.numUpdatedRows) !== 1) {
      return false;
    }
    await finalizeAdministratorSignupInTransaction(transaction, userId);
    const userActivated = await transaction
      .updateTable("users")
      .set({ emailVerifiedAt: now, accountStatus: "active" })
      .where("id", "=", userId)
      .where("accountStatus", "=", "pending_verification")
      .where("emailVerifiedAt", "is", null)
      .executeTakeFirst();
    if (Number(userActivated.numUpdatedRows) !== 1) {
      throw new Error("Email verification account state is invalid");
    }
    return true;
  });
  if (!activated) return false;
  await recordSecurityEvent("email_verified", userId);
  return true;
}

export async function discardPendingSignup(userId: string): Promise<void> {
  await db
    .deleteFrom("users")
    .where("id", "=", userId)
    .where("accountStatus", "=", "pending_verification")
    .where("emailVerifiedAt", "is", null)
    .execute();
}

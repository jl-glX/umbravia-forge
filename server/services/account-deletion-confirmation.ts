import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "../db/client.js";
import {
  deliverQueuedEmail,
  queueAccountDeletionVerificationCode,
} from "./email-delivery.js";
import { mfaStatus } from "./mfa.js";
import { recordSecurityEvent } from "./security-events.js";

const CHALLENGE_DURATION_MS = 15 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export type AccountDeletionConfirmationMethod =
  "password_totp" | "password_email_code" | "email_code" | "email_code_totp";

export class AccountDeletionConfirmationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code: string,
    statusCode = 400,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hasUsablePasswordHash(passwordHash: string): boolean {
  return (
    passwordHash.startsWith("$argon2id$") || /^\$2[aby]\$/u.test(passwordHash)
  );
}

function supportedLocale(
  value: string,
):
  | "es"
  | "en"
  | "de"
  | "de-CH"
  | "fr"
  | "it"
  | "gl"
  | "ca"
  | "ca-valencia"
  | "eu"
  | "oc-aranes" {
  return [
    "es",
    "en",
    "de",
    "de-CH",
    "fr",
    "it",
    "gl",
    "ca",
    "ca-valencia",
    "eu",
    "oc-aranes",
  ].includes(value)
    ? (value as
        | "es"
        | "en"
        | "de"
        | "de-CH"
        | "fr"
        | "it"
        | "gl"
        | "ca"
        | "ca-valencia"
        | "eu"
        | "oc-aranes")
    : "es";
}

function hashCode(code: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`;
}

function codeMatches(code: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(code, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function getAccountDeletionConfirmation(userId: string) {
  const [user, mfa] = await Promise.all([
    db
      .selectFrom("users")
      .select(["email", "name", "locale", "password", "emailVerifiedAt"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow(),
    mfaStatus(userId),
  ]);
  const passwordAvailable = hasUsablePasswordHash(user.password);
  const method: AccountDeletionConfirmationMethod = passwordAvailable
    ? mfa.enabled
      ? "password_totp"
      : "password_email_code"
    : mfa.enabled
      ? "email_code_totp"
      : "email_code";
  return {
    method,
    passwordAvailable,
    mfaRequired: mfa.enabled,
    emailCodeRequired: !mfa.enabled || !passwordAvailable,
    emailAvailable: user.emailVerifiedAt !== null,
    user: {
      email: user.email,
      name: user.name,
      locale: supportedLocale(user.locale),
    },
  };
}

async function supersedeDelivery(deliveryId: string | null, now: number) {
  if (!deliveryId) return;
  await db
    .updateTable("emailDeliveries")
    .set({
      status: "superseded",
      recipient: "",
      payloadEncrypted: "",
      updatedAt: now,
    })
    .where("id", "=", deliveryId)
    .where("status", "in", ["queued", "retry", "processing"])
    .execute();
}

export async function requestAccountDeletionEmailCode(
  userId: string,
  sessionId: string,
) {
  const confirmation = await getAccountDeletionConfirmation(userId);
  if (!confirmation.emailCodeRequired) {
    throw new AccountDeletionConfirmationError(
      "Email confirmation is not available for this account",
      "EMAIL_CONFIRMATION_NOT_REQUIRED",
      409,
    );
  }
  if (!confirmation.emailAvailable) {
    throw new AccountDeletionConfirmationError(
      "A verified account email is required",
      "VERIFIED_EMAIL_REQUIRED",
      403,
    );
  }

  const now = Date.now();
  const previous = await db
    .selectFrom("accountDeletionChallenges")
    .select(["createdAt", "deliveryId"])
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (previous && previous.createdAt + RESEND_DELAY_MS > now) {
    const retryAfterSeconds = Math.ceil(
      (previous.createdAt + RESEND_DELAY_MS - now) / 1000,
    );
    throw new AccountDeletionConfirmationError(
      "Wait before requesting another code",
      "DELETION_CODE_RATE_LIMITED",
      429,
      retryAfterSeconds,
    );
  }

  await supersedeDelivery(previous?.deliveryId ?? null, now);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challengeId = `account-deletion-${randomBytes(12).toString("hex")}`;
  const expiresAt = now + CHALLENGE_DURATION_MS;
  await db.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom("accountDeletionChallenges")
      .where("userId", "=", userId)
      .execute();
    await transaction
      .insertInto("accountDeletionChallenges")
      .values({
        id: challengeId,
        userId,
        sessionId,
        codeHash: hashCode(code),
        createdAt: now,
        expiresAt,
        attempts: 0,
        consumedAt: null,
        deliveryId: null,
      })
      .execute();
  });

  let deliveryId: string;
  try {
    deliveryId = await queueAccountDeletionVerificationCode({
      userId,
      email: confirmation.user.email,
      name: confirmation.user.name,
      code,
      locale: confirmation.user.locale,
      expiresAt,
    });
    await db
      .updateTable("accountDeletionChallenges")
      .set({ deliveryId })
      .where("id", "=", challengeId)
      .execute();
  } catch (error) {
    await db
      .deleteFrom("accountDeletionChallenges")
      .where("id", "=", challengeId)
      .execute();
    throw error;
  }

  const delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
  await recordSecurityEvent("account_deletion_code_requested", userId, {
    delivered,
  });
  return {
    expiresAt,
    delivered,
    queued: !delivered,
    demoVerificationCode: process.env.NODE_ENV === "test" ? code : undefined,
  };
}

export async function verifyAccountDeletionEmailCode(
  userId: string,
  sessionId: string,
  code: string,
): Promise<boolean> {
  const now = Date.now();
  const challenge = await db
    .selectFrom("accountDeletionChallenges")
    .selectAll()
    .where("userId", "=", userId)
    .where("sessionId", "=", sessionId)
    .executeTakeFirst();
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= now ||
    challenge.attempts >= MAX_ATTEMPTS ||
    !/^\d{6}$/u.test(code)
  ) {
    return false;
  }
  if (!codeMatches(code, challenge.codeHash)) {
    await db
      .updateTable("accountDeletionChallenges")
      .set((expression) => ({ attempts: expression("attempts", "+", 1) }))
      .where("id", "=", challenge.id)
      .where("sessionId", "=", sessionId)
      .where("consumedAt", "is", null)
      .where("expiresAt", ">", now)
      .where("attempts", "<", MAX_ATTEMPTS)
      .execute();
    await recordSecurityEvent("account_deletion_code_failed", userId);
    return false;
  }
  const consumed = await db
    .updateTable("accountDeletionChallenges")
    .set({ consumedAt: now })
    .where("id", "=", challenge.id)
    .where("sessionId", "=", sessionId)
    .where("consumedAt", "is", null)
    .where("expiresAt", ">", now)
    .where("attempts", "<", MAX_ATTEMPTS)
    .executeTakeFirst();
  return Number(consumed.numUpdatedRows) === 1;
}

import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "../db/client.js";
import {
  deliverQueuedEmail,
  queueEmailChangedNotice,
  queueEmailChangeVerification,
} from "./email-delivery.js";
import { recordSecurityEvent } from "./security-events.js";

const CHALLENGE_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class EmailChangeError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EmailChangeError("Email is invalid", "INVALID_EMAIL");
  }
  return email;
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

function supportedLocale(value: string): "es" | "en" | "de" | "de-CH" {
  return ["es", "en", "de", "de-CH"].includes(value)
    ? (value as "es" | "en" | "de" | "de-CH")
    : "es";
}

export async function requestEmailChange(userId: string, value: string) {
  const newEmail = normalizeEmail(value);
  const user = await db
    .selectFrom("users")
    .select(["email", "name", "locale", "accountStatus", "emailVerifiedAt"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (
    !user ||
    user.accountStatus !== "active" ||
    user.emailVerifiedAt === null
  ) {
    throw new EmailChangeError(
      "The account must be active and verified",
      "ACCOUNT_NOT_VERIFIED",
      403,
    );
  }
  if (newEmail === user.email.toLowerCase()) {
    throw new EmailChangeError(
      "The new email matches the current email",
      "EMAIL_UNCHANGED",
    );
  }
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", newEmail)
    .executeTakeFirst();
  if (existing) {
    throw new EmailChangeError(
      "Email is already in use",
      "EMAIL_ALREADY_IN_USE",
      409,
    );
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = Date.now();
  const expiresAt = now + CHALLENGE_DURATION_MS;
  try {
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom("emailChangeChallenges")
        .where("userId", "=", userId)
        .execute();
      await transaction
        .insertInto("emailChangeChallenges")
        .values({
          id: `email-change-${randomBytes(12).toString("hex")}`,
          userId,
          newEmail,
          codeHash: hashCode(code),
          createdAt: now,
          expiresAt,
          attempts: 0,
        })
        .execute();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      throw new EmailChangeError(
        "Email is already pending or in use",
        "EMAIL_ALREADY_IN_USE",
        409,
      );
    }
    throw error;
  }
  const deliveryId = await queueEmailChangeVerification({
    userId,
    email: newEmail,
    name: user.name,
    code,
    locale: supportedLocale(user.locale),
    expiresAt,
  });
  const delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
  await recordSecurityEvent("email_change_requested", userId, {
    delivered,
  });
  return {
    expiresAt,
    delivered,
    queued: !delivered,
    demoVerificationCode: process.env.NODE_ENV === "test" ? code : undefined,
  };
}

export async function confirmEmailChange(
  userId: string,
  sessionId: string,
  code: string,
) {
  const challenge = await db
    .selectFrom("emailChangeChallenges")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();
  const now = Date.now();
  if (
    !challenge ||
    challenge.expiresAt <= now ||
    challenge.attempts >= MAX_ATTEMPTS
  ) {
    throw new EmailChangeError(
      "Code is invalid or expired",
      "EMAIL_CHANGE_CODE_INVALID",
    );
  }
  if (!/^\d{6}$/.test(code) || !codeMatches(code, challenge.codeHash)) {
    await db
      .updateTable("emailChangeChallenges")
      .set((expression) => ({
        attempts: expression("attempts", "+", 1),
      }))
      .where("id", "=", challenge.id)
      .where("expiresAt", ">", now)
      .where("attempts", "<", MAX_ATTEMPTS)
      .execute();
    throw new EmailChangeError(
      "Code is invalid or expired",
      "EMAIL_CHANGE_CODE_INVALID",
    );
  }

  const user = await db
    .selectFrom("users")
    .select(["email", "name", "locale"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  try {
    await db.transaction().execute(async (transaction) => {
      const consumed = await transaction
        .deleteFrom("emailChangeChallenges")
        .where("id", "=", challenge.id)
        .where("userId", "=", userId)
        .where("codeHash", "=", challenge.codeHash)
        .where("expiresAt", ">", now)
        .where("attempts", "<", MAX_ATTEMPTS)
        .executeTakeFirst();
      if (Number(consumed.numDeletedRows) !== 1) {
        throw new EmailChangeError(
          "Code is invalid or expired",
          "EMAIL_CHANGE_CODE_INVALID",
        );
      }
      const changed = await transaction
        .updateTable("users")
        .set({ email: challenge.newEmail, emailVerifiedAt: now })
        .where("id", "=", userId)
        .where("email", "=", user.email)
        .executeTakeFirst();
      if (Number(changed.numUpdatedRows) !== 1) {
        throw new EmailChangeError(
          "The account email changed during verification",
          "EMAIL_CHANGE_STATE_CONFLICT",
          409,
        );
      }
      await transaction
        .updateTable("sessions")
        .set({ revokedAt: now })
        .where("userId", "=", userId)
        .where("id", "!=", sessionId)
        .where("revokedAt", "is", null)
        .execute();
      await transaction
        .deleteFrom("accountRecoveryChallenges")
        .where("userId", "=", userId)
        .execute();
      await transaction
        .deleteFrom("emailVerificationChallenges")
        .where("userId", "=", userId)
        .execute();
      await transaction
        .deleteFrom("authChallenges")
        .where("userId", "=", userId)
        .execute();
      await transaction
        .updateTable("emailDeliveries")
        .set({
          status: "superseded",
          recipient: "",
          payloadEncrypted: "",
          updatedAt: now,
        })
        .where("userId", "=", userId)
        .where("kind", "in", ["email_verification", "account_recovery"])
        .where("status", "in", ["queued", "retry"])
        .execute();
    });
  } catch (error) {
    if (error instanceof EmailChangeError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      throw new EmailChangeError(
        "Email is already in use",
        "EMAIL_ALREADY_IN_USE",
        409,
      );
    }
    throw error;
  }

  const noticeId = await queueEmailChangedNotice({
    userId,
    oldEmail: user.email,
    newEmail: challenge.newEmail,
    name: user.name,
    locale: supportedLocale(user.locale),
  }).catch(() => null);
  if (noticeId) await deliverQueuedEmail(noticeId).catch(() => false);
  await recordSecurityEvent("email_changed", userId, {
    previousEmailNoticeQueued: Boolean(noticeId),
  });
  return { email: challenge.newEmail };
}

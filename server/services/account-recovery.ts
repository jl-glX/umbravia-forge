import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import bcryptjs from "bcryptjs";
import { db } from "../db/client.js";
import {
  isPasswordWithinHashLimit,
  isStrongPassword,
} from "../lib/password-policy.js";
import {
  cancelScheduledAccountDeletion,
  hasScheduledAccountDeletion,
} from "./account-lifecycle.js";
import { queueAccountRecoveryCode } from "./email-delivery.js";
import { recordSecurityEvent } from "./security-events.js";
import { rotateSupportIdentifier } from "./support-identifiers.js";
import { withCoordinatedManagerOperation } from "./manager-coordinator.js";

const RECOVERY_CHALLENGE_DURATION_MS = 15 * 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;
const DUMMY_RECOVERY_CODE_HASH = hashCode(
  "000000",
  "umbravia-account-recovery-timing-salt",
);

export type RecoveryMethodId =
  "password" | "email" | "code" | "passkey" | "support";
export type RecoveryCapabilityStatus = "available" | "planned";
export const RECOVERY_COMPLETION_EVENTS = [
  "login_success",
  "password_reset_completed",
  "mfa_verified",
  "passkey_verified",
  "support_recovery_approved",
] as const;
export type RecoveryCompletionEvent =
  (typeof RECOVERY_COMPLETION_EVENTS)[number];

export interface RecoveryCapability {
  id: RecoveryMethodId;
  status: RecoveryCapabilityStatus;
  entryPoint: "/login" | "/recover-account" | null;
  requiresCompletedVerification: true;
  canCancelPendingDeletion: boolean;
}

const capabilities: readonly RecoveryCapability[] = [
  {
    id: "password",
    status: "available",
    entryPoint: "/recover-account",
    requiresCompletedVerification: true,
    canCancelPendingDeletion: true,
  },
  {
    id: "email",
    status: "available",
    entryPoint: "/recover-account",
    requiresCompletedVerification: true,
    canCancelPendingDeletion: true,
  },
  {
    id: "code",
    status: "available",
    entryPoint: "/recover-account",
    requiresCompletedVerification: true,
    canCancelPendingDeletion: true,
  },
  {
    id: "passkey",
    status: "available",
    entryPoint: "/login",
    requiresCompletedVerification: true,
    canCancelPendingDeletion: true,
  },
  {
    id: "support",
    status: "planned",
    entryPoint: null,
    requiresCompletedVerification: true,
    canCancelPendingDeletion: false,
  },
];

type RecoveryLocale = "es" | "en" | "de" | "de-CH";

function normalizedLocale(value: string): RecoveryLocale {
  return ["es", "en", "de", "de-CH"].includes(value)
    ? (value as RecoveryLocale)
    : "es";
}

function hashCode(
  code: string,
  salt = randomBytes(16).toString("hex"),
): string {
  return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`;
}

function codeMatches(code: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(code, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createAccountRecoveryChallenge(
  userId: string,
): Promise<{ code: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + RECOVERY_CHALLENGE_DURATION_MS;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challenge = {
    id: `account-recovery-${randomBytes(12).toString("hex")}`,
    userId,
    codeHash: hashCode(code),
    createdAt: now,
    expiresAt,
    attempts: 0,
    consumedAt: null,
  };
  await db
    .insertInto("accountRecoveryChallenges")
    .values(challenge)
    .onConflict((conflict) => conflict.column("userId").doUpdateSet(challenge))
    .execute();
  return { code, expiresAt };
}

export function getRecoveryCapabilities(): readonly RecoveryCapability[] {
  return capabilities;
}

export async function requestPasswordRecovery(
  identifier: string,
): Promise<{ deliveryId: string | null }> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "name", "locale", "accountStatus"])
    .where("email", "=", normalizedIdentifier)
    .executeTakeFirst();

  // The public route always returns the same response. Pending signups are not
  // recoverable through password reset because their email has not been proven.
  if (!user || user.accountStatus === "pending_verification") {
    return { deliveryId: null };
  }

  const { code, expiresAt } = await createAccountRecoveryChallenge(user.id);

  const deliveryId = await queueAccountRecoveryCode({
    userId: user.id,
    email: user.email,
    name: user.name,
    code,
    locale: normalizedLocale(user.locale),
    expiresAt,
  });
  await recordSecurityEvent("account_recovery_requested", user.id);
  return { deliveryId };
}

async function performPasswordResetWithRecoveryCode(input: {
  identifier: string;
  code: string;
  newPassword: string;
}): Promise<boolean> {
  if (
    !isStrongPassword(input.newPassword) ||
    !isPasswordWithinHashLimit(input.newPassword)
  ) {
    throw new Error("Password does not meet the security requirements");
  }

  const normalizedIdentifier = input.identifier.trim().toLowerCase();
  const challenge = await db
    .selectFrom("accountRecoveryChallenges")
    .innerJoin("users", "users.id", "accountRecoveryChallenges.userId")
    .select([
      "accountRecoveryChallenges.id",
      "accountRecoveryChallenges.userId",
      "accountRecoveryChallenges.codeHash",
      "accountRecoveryChallenges.expiresAt",
      "accountRecoveryChallenges.attempts",
      "accountRecoveryChallenges.consumedAt",
    ])
    .where("users.email", "=", normalizedIdentifier)
    .executeTakeFirst();
  const now = Date.now();
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= now ||
    challenge.attempts >= RECOVERY_MAX_ATTEMPTS
  ) {
    // Keep the expensive comparison on invalid and unknown challenges too, so
    // response time is less useful for account enumeration.
    codeMatches(input.code, DUMMY_RECOVERY_CODE_HASH);
    if (challenge) {
      await recordSecurityEvent("account_recovery_failed", challenge.userId, {
        reason: "invalid_or_expired_challenge",
      });
    }
    return false;
  }

  if (!codeMatches(input.code, challenge.codeHash)) {
    await db
      .updateTable("accountRecoveryChallenges")
      .set((expression) => ({
        attempts: expression("attempts", "+", 1),
      }))
      .where("id", "=", challenge.id)
      .where("attempts", "<", RECOVERY_MAX_ATTEMPTS)
      .where("consumedAt", "is", null)
      .where("expiresAt", ">", now)
      .execute();
    await recordSecurityEvent("account_recovery_failed", challenge.userId, {
      reason: "invalid_code",
    });
    return false;
  }

  const passwordHash = await bcryptjs.hash(input.newPassword, 12);
  await db.transaction().execute(async (transaction) => {
    const consumed = await transaction
      .updateTable("accountRecoveryChallenges")
      .set({ consumedAt: now })
      .where("id", "=", challenge.id)
      .where("consumedAt", "is", null)
      .where("expiresAt", ">", now)
      .where("attempts", "<", RECOVERY_MAX_ATTEMPTS)
      .executeTakeFirst();
    if (Number(consumed.numUpdatedRows) !== 1) {
      throw new Error("Recovery challenge has already been consumed");
    }
    await transaction
      .updateTable("users")
      .set({ password: passwordHash })
      .where("id", "=", challenge.userId)
      .execute();
    await transaction
      .updateTable("sessions")
      .set({ revokedAt: now })
      .where("userId", "=", challenge.userId)
      .where("revokedAt", "is", null)
      .execute();
    await transaction
      .deleteFrom("authChallenges")
      .where("userId", "=", challenge.userId)
      .execute();
    await transaction
      .deleteFrom("webauthnChallenges")
      .where("userId", "=", challenge.userId)
      .execute();
  });

  await rotateSupportIdentifier(challenge.userId, "account_recovery");
  await completeAccountRecovery(challenge.userId, "password_reset_completed");
  await recordSecurityEvent(
    "account_recovery_password_reset",
    challenge.userId,
  );
  return true;
}

export async function resetPasswordWithRecoveryCode(input: {
  identifier: string;
  code: string;
  newPassword: string;
}): Promise<boolean> {
  return withCoordinatedManagerOperation(
    "account",
    "password-recovery",
    ["authentication-records"],
    () => performPasswordResetWithRecoveryCode(input),
  );
}

export async function completeAccountRecovery(
  userId: string,
  event: RecoveryCompletionEvent,
) {
  if (!(await hasScheduledAccountDeletion(userId))) {
    return { cancelledPendingDeletion: false, lifecycle: null };
  }
  const lifecycle = await cancelScheduledAccountDeletion(userId, {
    recoveryEvent: event,
  });
  await recordSecurityEvent("account_recovery_completed", userId, { event });
  return { cancelledPendingDeletion: true, lifecycle };
}

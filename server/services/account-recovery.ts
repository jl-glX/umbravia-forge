import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "../db/client.js";
import {
  hashPasswordWithArgon2id,
  verifyPasswordHash,
} from "../lib/password-hashing.js";
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
import {
  findUserIdBySupportIdentifier,
  rotateSupportIdentifier,
} from "./support-identifiers.js";
import { withCoordinatedManagerOperation } from "./manager-coordinator.js";

const RECOVERY_CHALLENGE_DURATION_MS = 15 * 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;
const DUMMY_RECOVERY_CODE_HASH = hashCode(
  "000000",
  "umbravia-account-recovery-timing-salt",
);
export const RECOVERY_LOOKUP_METHODS = [
  "email",
  "username",
  "public_id",
] as const;
export type RecoveryLookupMethod = (typeof RECOVERY_LOOKUP_METHODS)[number];

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

export class AccountRecoveryPasswordReusedError extends Error {
  readonly code = "ACCOUNT_RECOVERY_PASSWORD_REUSED";

  constructor() {
    super("The new password must be different from the current password");
    this.name = "AccountRecoveryPasswordReusedError";
  }
}

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

type RecoveryLocale =
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
  | "oc-aranes";

function normalizedLocale(value: string): RecoveryLocale {
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

export function getRecoveryLookupMethods(): readonly RecoveryLookupMethod[] {
  return RECOVERY_LOOKUP_METHODS;
}

type RecoverableUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  accountStatus: "pending_verification" | "active" | "security_review";
};

function normalizeRecoveryIdentifier(
  method: RecoveryLookupMethod,
  identifier: string,
): string {
  const trimmed = identifier.trim();
  return method === "public_id" ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

async function findRecoverableUser(
  method: RecoveryLookupMethod,
  identifier: string,
  identityRealm: "commercial" | "corporate_support" = "commercial",
): Promise<RecoverableUser | undefined> {
  const normalized = normalizeRecoveryIdentifier(method, identifier);
  if (method === "email") {
    return db
      .selectFrom("users")
      .select(["id", "email", "name", "locale", "accountStatus"])
      .where("email", "=", normalized)
      .where("identityRealm", "=", identityRealm)
      .executeTakeFirst();
  }
  if (identityRealm === "corporate_support") return undefined;
  if (method === "username") {
    return db
      .selectFrom("socialProfiles")
      .innerJoin("users", "users.id", "socialProfiles.userId")
      .select([
        "users.id",
        "users.email",
        "users.name",
        "users.locale",
        "users.accountStatus",
      ])
      .where("socialProfiles.username", "=", normalized)
      .executeTakeFirst();
  }
  const userId = await findUserIdBySupportIdentifier(normalized);
  if (!userId) return undefined;
  return db
    .selectFrom("users")
    .select(["id", "email", "name", "locale", "accountStatus"])
    .where("id", "=", userId)
    .where("identityRealm", "=", "commercial")
    .executeTakeFirst();
}

export async function requestPasswordRecovery(
  method: RecoveryLookupMethod,
  identifier: string,
  identityRealm: "commercial" | "corporate_support" = "commercial",
): Promise<{ deliveryId: string | null }> {
  const user = await findRecoverableUser(method, identifier, identityRealm);

  // The public route always returns the same response. Pending signups are not
  // recoverable through password reset because their email has not been proven.
  if (!user || user.accountStatus === "pending_verification") {
    return { deliveryId: null };
  }

  const { code, expiresAt } = await createAccountRecoveryChallenge(user.id);

  const deliveryId = await queueAccountRecoveryCode({
    userId: user.id,
    platformScope:
      identityRealm === "corporate_support" ? "support" : "commercial",
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
  method: RecoveryLookupMethod;
  identifier: string;
  code: string;
  newPassword: string;
  identityRealm?: "commercial" | "corporate_support";
}): Promise<boolean> {
  if (
    !isStrongPassword(input.newPassword) ||
    !isPasswordWithinHashLimit(input.newPassword)
  ) {
    throw new Error("Password does not meet the security requirements");
  }

  const user = await findRecoverableUser(
    input.method,
    input.identifier,
    input.identityRealm,
  );
  const challenge = await db
    .selectFrom("accountRecoveryChallenges")
    .select([
      "accountRecoveryChallenges.id",
      "accountRecoveryChallenges.userId",
      "accountRecoveryChallenges.codeHash",
      "accountRecoveryChallenges.expiresAt",
      "accountRecoveryChallenges.attempts",
      "accountRecoveryChallenges.consumedAt",
    ])
    .where("accountRecoveryChallenges.userId", "=", user?.id ?? "")
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

  const currentCredentials = await db
    .selectFrom("users")
    .select("password")
    .where("id", "=", challenge.userId)
    .executeTakeFirst();
  if (
    currentCredentials &&
    (await verifyPasswordHash(input.newPassword, currentCredentials.password))
  ) {
    await recordSecurityEvent("account_recovery_failed", challenge.userId, {
      reason: "password_reused",
    });
    throw new AccountRecoveryPasswordReusedError();
  }

  const passwordHash = await hashPasswordWithArgon2id(input.newPassword);
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
  method: RecoveryLookupMethod;
  identifier: string;
  code: string;
  newPassword: string;
  identityRealm?: "commercial" | "corporate_support";
}): Promise<boolean> {
  return withCoordinatedManagerOperation(
    "account",
    input.identityRealm === "corporate_support" ? "support" : "commercial",
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

import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import {
  hashPasswordWithArgon2id,
  passwordHashNeedsUpgrade,
  performDummyPasswordVerification,
  verifyPasswordHash,
} from "../lib/password-hashing.js";
import { mfaStatus, verifyMfaCode } from "./mfa.js";
import { recordSecurityEvent } from "./security-events.js";
import { ensureSupportIdentifier } from "./support-identifiers.js";
import { markMeaningfulAccountActivity } from "./account-lifecycle.js";
import {
  isPasswordWithinHashLimit,
  isStrongPassword,
} from "../lib/password-policy.js";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "../lib/legal-versions.js";
import { completeAccountRecovery } from "./account-recovery.js";
import {
  type FacilityContext,
  isPlatformOperator,
  resolveFacilityContext,
} from "./facility-context.js";
import { commercialFacilityTypes } from "../lib/commercial-trial.js";
import type { CommercialFacilityType } from "../db/types.js";

export { isStrongPassword } from "../lib/password-policy.js";

export const SESSION_DURATION = 24 * 60 * 60 * 1000;
export const REMEMBERED_SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
export const MFA_CHALLENGE_DURATION = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 7 * 24 * 60;

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: "member" | "trainer" | "admin";
  accountStatus: "pending_verification" | "active" | "security_review";
  identityRealm: "commercial" | "corporate_support";
  createdAt: number;
  expiresAt: number;
  facility: FacilityContext | null;
  platformOperator: boolean;
}

export interface AuthResult {
  sessionToken: string;
  rememberDevice: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    avatarDataUrl: string;
    role: "member" | "trainer" | "admin";
    accountStatus: "pending_verification" | "active" | "security_review";
    identityRealm: "commercial" | "corporate_support";
    facility?: FacilityContext | null;
    platformOperator?: boolean;
  };
}

export type LoginResult =
  | ({ mfaRequired: false } & AuthResult)
  | { mfaRequired: true; challengeToken: string };

export interface SessionMetadata {
  userAgent?: string;
}

export type AccessPortal = "member" | "staff" | "support";

export interface SignupProfile {
  lastName: string;
  countryCode: string;
  locale: "es" | "en" | "de" | "de-CH";
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  accountType?: "member" | "administrator";
  facilityName?: string;
  facilityType?: CommercialFacilityType;
}

export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordWithinHashLimit(password)) {
    throw new Error("Password exceeds the supported byte length");
  }
  return hashPasswordWithArgon2id(password);
}

export async function verifyUserPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  if (!isPasswordWithinHashLimit(password)) {
    return false;
  }
  const user = await db
    .selectFrom("users")
    .select("password")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user) return false;
  const valid = await verifyPasswordHash(password, user.password);
  if (valid && passwordHashNeedsUpgrade(user.password)) {
    await db
      .updateTable("users")
      .set({ password: await hashPassword(password) })
      .where("id", "=", userId)
      .where("password", "=", user.password)
      .execute();
  }
  return valid;
}

function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  user: AuthResult["user"],
  metadata: SessionMetadata = {},
  rememberDevice = false,
): Promise<AuthResult> {
  const now = Date.now();
  const token = randomBytes(32).toString("hex");

  await db.deleteFrom("sessions").where("expiresAt", "<", now).execute();
  await db
    .insertInto("sessions")
    .values({
      id: sessionId(token),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt:
        now + (rememberDevice ? REMEMBERED_SESSION_DURATION : SESSION_DURATION),
      revokedAt: null,
      userAgent: (metadata.userAgent ?? "Unknown device").slice(0, 255),
      remembered: rememberDevice ? 1 : 0,
      formVerifiedAt: now,
    })
    .execute();

  await markMeaningfulAccountActivity(user.id, "login_success", now);
  const corporateIdentity = user.identityRealm === "corporate_support";
  const platformOperator = corporateIdentity
    ? false
    : await isPlatformOperator(user.id);
  const publicUser: AuthResult["user"] = {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarDataUrl: user.avatarDataUrl,
    role: user.role,
    accountStatus: user.accountStatus,
    identityRealm: user.identityRealm,
    facility: corporateIdentity ? null : await resolveFacilityContext(user.id),
    platformOperator,
  };
  return { sessionToken: token, user: publicUser, rememberDevice };
}

export async function signup(
  email: string,
  name: string,
  password: string,
  metadata: SessionMetadata = {},
  profile: SignupProfile = {
    lastName: "",
    countryCode: "ES",
    locale: "es",
    acceptedTerms: true,
    acceptedPrivacy: true,
  },
  options: { requireEmailVerification?: boolean } = {},
): Promise<AuthResult> {
  if (!isStrongPassword(password)) {
    throw new Error("Password does not meet the security requirements");
  }

  const existingUser = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .where("identityRealm", "=", "commercial")
    .executeTakeFirst();

  if (existingUser) {
    throw new Error("Unable to create account with these credentials");
  }
  if (!profile.acceptedTerms || !profile.acceptedPrivacy) {
    throw new Error("Terms and privacy acknowledgement are required");
  }
  const administratorSignup = profile.accountType === "administrator";
  if (
    administratorSignup &&
    (!profile.facilityName ||
      profile.facilityName.trim().length < 2 ||
      profile.facilityName.trim().length > 120)
  ) {
    throw new Error("A valid facility name is required");
  }
  if (
    administratorSignup &&
    (!profile.facilityType ||
      !commercialFacilityTypes.includes(profile.facilityType))
  ) {
    throw new Error("A valid facility type is required");
  }

  const createdAt = Date.now();
  const requireEmailVerification = options.requireEmailVerification ?? true;

  const role = administratorSignup ? ("admin" as const) : ("member" as const);
  const user = {
    id: `user-${randomBytes(8).toString("hex")}`,
    email,
    identityRealm: "commercial" as const,
    phone: null,
    name,
    lastName: profile.lastName,
    countryCode: profile.countryCode,
    locale: profile.locale,
    accountStatus: requireEmailVerification
      ? ("pending_verification" as const)
      : ("active" as const),
    emailVerifiedAt: null,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: createdAt,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    privacyAcceptedAt: createdAt,
    avatarDataUrl: "",
    role,
    sessionIdleTimeoutMinutes: DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  };

  const passwordHash = await hashPassword(password);
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("users")
      .values({
        ...user,
        password: passwordHash,
        createdAt,
      })
      .execute();
    if (administratorSignup) {
      await transaction
        .insertInto("administratorSignupProvisioning")
        .values({
          userId: user.id,
          facilityName: profile.facilityName!.trim(),
          facilityType: profile.facilityType!,
          locale: profile.locale,
          createdAt,
        })
        .execute();
    }
  });

  await ensureSupportIdentifier(user.id);
  return createSession(user, metadata);
}

export async function signupCorporateSupportAccount(
  email: string,
  name: string,
  password: string,
  metadata: SessionMetadata,
  profile: Pick<
    SignupProfile,
    "lastName" | "countryCode" | "locale" | "acceptedTerms" | "acceptedPrivacy"
  >,
): Promise<AuthResult> {
  if (!isStrongPassword(password)) {
    throw new Error("Password does not meet the security requirements");
  }
  if (!profile.acceptedTerms || !profile.acceptedPrivacy) {
    throw new Error("Terms and privacy acknowledgement are required");
  }
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .where("identityRealm", "=", "corporate_support")
    .executeTakeFirst();
  if (existing) {
    throw new Error("Unable to create account with these credentials");
  }

  const createdAt = Date.now();
  const user = {
    id: `corporate-user-${randomBytes(8).toString("hex")}`,
    email,
    identityRealm: "corporate_support" as const,
    phone: null,
    name,
    lastName: profile.lastName,
    countryCode: profile.countryCode,
    locale: profile.locale,
    accountStatus: "pending_verification" as const,
    emailVerifiedAt: null,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: createdAt,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    privacyAcceptedAt: createdAt,
    avatarDataUrl: "",
    role: "admin" as const,
    sessionIdleTimeoutMinutes: DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  };
  await db
    .insertInto("users")
    .values({
      ...user,
      password: await hashPassword(password),
      createdAt,
    })
    .execute();
  return createSession(user, metadata);
}

export async function login(
  identifier: string,
  password: string,
  accessPortal: AccessPortal = "member",
  rememberDevice = false,
  metadata: SessionMetadata = {},
): Promise<LoginResult> {
  if (!isPasswordWithinHashLimit(password)) {
    await performDummyPasswordVerification("InvalidPasswordLength123");
    await recordSecurityEvent("login_failed", null, {
      portal: accessPortal,
      reason: "password_length",
    });
    throw new Error("Invalid email or password");
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const normalizedPhone = identifier.replace(/[\s()-]/g, "");
  const user = await db
    .selectFrom("users")
    .selectAll()
    .where((expression) =>
      expression.or([
        expression("email", "=", normalizedIdentifier),
        expression("phone", "=", normalizedPhone),
      ]),
    )
    .where(
      "identityRealm",
      "=",
      accessPortal === "support" ? "corporate_support" : "commercial",
    )
    .executeTakeFirst();

  const portalMembership = user
    ? await db
        .selectFrom("facilityMemberships")
        .select("id")
        .where("userId", "=", user.id)
        .where("status", "=", "active")
        .where(
          "role",
          "in",
          accessPortal === "member"
            ? ["member"]
            : ["trainer", "admin", "owner"],
        )
        .executeTakeFirst()
    : null;
  const supportMembership = user
    ? await db
        .selectFrom("umfSupportStaff")
        .select("userId")
        .where("userId", "=", user.id)
        .where("status", "=", "active")
        .executeTakeFirst()
    : null;
  const portalMatches =
    user &&
    (accessPortal === "support"
      ? Boolean(supportMembership)
      : portalMembership !== undefined ||
        (accessPortal === "member"
          ? user.role === "member"
          : user.role === "trainer" || user.role === "admin"));

  if (!user || !portalMatches) {
    await performDummyPasswordVerification(password);
    await recordSecurityEvent("login_failed", user?.id ?? null, {
      portal: accessPortal,
    });
    throw new Error("Invalid email or password");
  }

  if (!(await verifyPasswordHash(password, user.password))) {
    await recordSecurityEvent("login_failed", user.id);
    throw new Error("Invalid email or password");
  }

  if (passwordHashNeedsUpgrade(user.password)) {
    await db
      .updateTable("users")
      .set({ password: await hashPassword(password) })
      .where("id", "=", user.id)
      .where("password", "=", user.password)
      .execute();
  }

  const status = await mfaStatus(user.id);
  if (status.enabled) {
    const now = Date.now();
    const challengeToken = randomBytes(32).toString("hex");
    await db
      .deleteFrom("authChallenges")
      .where("expiresAt", "<", now)
      .execute();
    await db
      .insertInto("authChallenges")
      .values({
        id: sessionId(challengeToken),
        userId: user.id,
        createdAt: now,
        expiresAt: now + MFA_CHALLENGE_DURATION,
        attempts: 0,
        consumedAt: null,
        rememberDevice: rememberDevice ? 1 : 0,
      })
      .execute();
    await recordSecurityEvent("mfa_challenge_created", user.id);
    return { mfaRequired: true, challengeToken };
  }

  const result = await createSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarDataUrl: user.avatarDataUrl,
      role: user.role,
      accountStatus: user.accountStatus,
      identityRealm: user.identityRealm,
    },
    metadata,
    rememberDevice,
  );
  await recordSecurityEvent("login_succeeded", user.id);
  await completeAccountRecovery(user.id, "login_success");
  return { mfaRequired: false, ...result };
}

export async function completeMfaLogin(
  challengeToken: string,
  code: string,
  metadata: SessionMetadata = {},
  expectedIdentityRealm: "commercial" | "corporate_support" = "commercial",
): Promise<AuthResult> {
  const now = Date.now();
  const challengeId = sessionId(challengeToken);
  const challenge = await db
    .selectFrom("authChallenges")
    .innerJoin("users", "users.id", "authChallenges.userId")
    .select([
      "authChallenges.userId",
      "authChallenges.expiresAt",
      "authChallenges.attempts",
      "authChallenges.consumedAt",
      "authChallenges.rememberDevice",
      "users.email",
      "users.name",
      "users.avatarDataUrl",
      "users.role",
      "users.accountStatus",
      "users.identityRealm",
    ])
    .where("authChallenges.id", "=", challengeId)
    .executeTakeFirst();

  if (
    !challenge ||
    challenge.identityRealm !== expectedIdentityRealm ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= now ||
    challenge.attempts >= MFA_MAX_ATTEMPTS
  ) {
    throw new Error("Invalid or expired verification challenge");
  }
  if (expectedIdentityRealm === "corporate_support") {
    const membership = await db
      .selectFrom("umfSupportStaff")
      .select("userId")
      .where("userId", "=", challenge.userId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!membership) {
      throw new Error("Invalid or expired verification challenge");
    }
  }

  const verification = await verifyMfaCode(
    challenge.userId,
    challenge.email,
    code,
  );
  if (!verification.valid) {
    await db
      .updateTable("authChallenges")
      .set({ attempts: challenge.attempts + 1 })
      .where("id", "=", challengeId)
      .execute();
    await recordSecurityEvent("mfa_challenge_failed", challenge.userId);
    throw new Error("Invalid verification code");
  }

  await db
    .updateTable("authChallenges")
    .set({ consumedAt: now })
    .where("id", "=", challengeId)
    .execute();
  const result = await createSession(
    {
      id: challenge.userId,
      email: challenge.email,
      name: challenge.name,
      avatarDataUrl: challenge.avatarDataUrl,
      role: challenge.role,
      accountStatus: challenge.accountStatus,
      identityRealm: challenge.identityRealm,
    },
    metadata,
    challenge.rememberDevice === 1,
  );
  await recordSecurityEvent("mfa_succeeded", challenge.userId, {
    recoveryCode: verification.usedRecoveryCode,
  });
  await completeAccountRecovery(challenge.userId, "mfa_verified");
  return result;
}

export async function verifyToken(token: string): Promise<SessionData | null> {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }

  const now = Date.now();
  const record = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.userId")
    .select([
      "sessions.userId",
      "sessions.createdAt",
      "sessions.expiresAt",
      "sessions.revokedAt",
      "sessions.lastSeenAt",
      "users.sessionIdleTimeoutMinutes",
      "users.email",
      "users.name",
      "users.avatarDataUrl",
      "users.role",
      "users.accountStatus",
      "users.identityRealm",
    ])
    .where("sessions.id", "=", sessionId(token))
    .executeTakeFirst();

  if (!record) {
    return null;
  }

  const idleExpiresAt =
    record.lastSeenAt + record.sessionIdleTimeoutMinutes * 60 * 1000;

  if (
    record.revokedAt !== null ||
    record.expiresAt <= now ||
    idleExpiresAt <= now
  ) {
    if (record.revokedAt === null && idleExpiresAt <= now) {
      await db
        .updateTable("sessions")
        .set({ revokedAt: now })
        .where("id", "=", sessionId(token))
        .execute();
    }
    return null;
  }

  if (now - record.lastSeenAt > 5 * 60 * 1000) {
    await db
      .updateTable("sessions")
      .set({ lastSeenAt: now })
      .where("id", "=", sessionId(token))
      .execute();
  }

  const corporateIdentity = record.identityRealm === "corporate_support";
  const platformOperator = corporateIdentity
    ? false
    : await isPlatformOperator(record.userId);
  return {
    userId: record.userId,
    email: record.email,
    name: record.name,
    avatarDataUrl: record.avatarDataUrl,
    role: record.role,
    accountStatus: record.accountStatus,
    identityRealm: record.identityRealm,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    sessionId: sessionId(token),
    facility: corporateIdentity
      ? null
      : await resolveFacilityContext(record.userId),
    platformOperator,
  };
}

export async function logout(token: string): Promise<void> {
  await db
    .updateTable("sessions")
    .set({ revokedAt: Date.now() })
    .where("id", "=", sessionId(token))
    .execute();
}

export async function logoutAll(userId: string): Promise<void> {
  await db
    .updateTable("sessions")
    .set({ revokedAt: Date.now() })
    .where("userId", "=", userId)
    .where("revokedAt", "is", null)
    .execute();
}

import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "../lib/legal-versions.js";
import {
  createSession,
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  hashPassword,
  type AuthResult,
  type SessionMetadata,
  type SignupProfile,
} from "../services/auth.js";

export async function createActiveCorporateSupportTestAccount(
  email: string,
  name: string,
  password: string,
  metadata: SessionMetadata,
  profile: Pick<
    SignupProfile,
    "lastName" | "countryCode" | "locale" | "acceptedTerms" | "acceptedPrivacy"
  >,
): Promise<AuthResult> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Corporate support fixtures are available only in tests");
  }
  const createdAt = Date.now();
  const user = {
    id: `corporate-test-user-${randomBytes(8).toString("hex")}`,
    email,
    identityRealm: "corporate_support" as const,
    phone: null,
    name,
    lastName: profile.lastName,
    countryCode: profile.countryCode,
    locale: profile.locale,
    accountStatus: "active" as const,
    emailVerifiedAt: createdAt,
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

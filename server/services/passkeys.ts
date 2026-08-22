import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "../db/client.js";
import {
  createSession,
  MFA_CHALLENGE_DURATION,
  type AccessPortal,
  type AuthResult,
  type SessionMetadata,
} from "./auth.js";
import { recordSecurityEvent } from "./security-events.js";
import { completeAccountRecovery } from "./account-recovery.js";

const RP_NAME = "Umbravia Forge";

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, "");
}

async function findPortalUser(identifier: string, accessPortal: AccessPortal) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const identityRealm =
    accessPortal === "support" ? "corporate_support" : "commercial";
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "name", "role", "accountStatus", "emailVerifiedAt"])
    .where("identityRealm", "=", identityRealm)
    .where((expression) =>
      expression.or([
        expression("email", "=", normalizedIdentifier),
        expression("phone", "=", normalizePhone(identifier)),
      ]),
    )
    .executeTakeFirst();

  if (
    !user ||
    (accessPortal === "support"
      ? user.role !== "admin" ||
        user.accountStatus !== "active" ||
        user.emailVerifiedAt === null
      : accessPortal === "member"
        ? user.role !== "member"
        : user.role !== "trainer" && user.role !== "admin")
  ) {
    throw new Error("Passkey access is not available");
  }
  return user;
}

async function storeChallenge(
  userId: string,
  challenge: string,
  type: "registration" | "authentication",
  rememberDevice = false,
) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await db
    .deleteFrom("webauthnChallenges")
    .where("expiresAt", "<", now)
    .execute();
  await db
    .insertInto("webauthnChallenges")
    .values({
      id: tokenId(token),
      userId,
      challenge,
      type,
      rememberDevice: rememberDevice ? 1 : 0,
      createdAt: now,
      expiresAt: now + MFA_CHALLENGE_DURATION,
      consumedAt: null,
    })
    .execute();
  return token;
}

async function readChallenge(
  token: string,
  type: "registration" | "authentication",
) {
  const challenge = await db
    .selectFrom("webauthnChallenges")
    .selectAll()
    .where("id", "=", tokenId(token))
    .where("type", "=", type)
    .executeTakeFirst();
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= Date.now()
  ) {
    throw new Error("Invalid or expired passkey challenge");
  }
  return challenge;
}

async function consumeChallenge(token: string) {
  await db
    .updateTable("webauthnChallenges")
    .set({ consumedAt: Date.now() })
    .where("id", "=", tokenId(token))
    .execute();
}

export async function beginPasskeyRegistration(
  user: { id: string; email: string; name: string },
  rpID: string,
) {
  const existing = await db
    .selectFrom("passkeyCredentials")
    .select(["id", "transports"])
    .where("userId", "=", user.id)
    .execute();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    preferredAuthenticatorType: "localDevice",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: existing.map((credential) => ({
      id: credential.id as Base64URLString,
      transports: JSON.parse(
        credential.transports,
      ) as AuthenticatorTransportFuture[],
    })),
  });
  return {
    token: await storeChallenge(user.id, options.challenge, "registration"),
    options,
  };
}

export async function finishPasskeyRegistration(
  userId: string,
  token: string,
  response: RegistrationResponseJSON,
  expectedOrigin: string,
  rpID: string,
) {
  const challenge = await readChallenge(token, "registration");
  if (challenge.userId !== userId) throw new Error("Passkey user mismatch");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error("Passkey verification failed");
  const info = verification.registrationInfo;
  await db
    .insertInto("passkeyCredentials")
    .values({
      id: info.credential.id,
      userId,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      transports: JSON.stringify(info.credential.transports ?? []),
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp ? 1 : 0,
      createdAt: Date.now(),
    })
    .execute();
  await consumeChallenge(token);
  await recordSecurityEvent("passkey_registered", userId);
}

export async function beginPasskeyAuthentication(
  identifier: string,
  accessPortal: AccessPortal,
  rememberDevice: boolean,
  rpID: string,
) {
  const user = await findPortalUser(identifier, accessPortal);
  const credentials = await db
    .selectFrom("passkeyCredentials")
    .select(["id", "transports"])
    .where("userId", "=", user.id)
    .execute();
  if (credentials.length === 0)
    throw new Error("Passkey access is not available");
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.id as Base64URLString,
      transports: JSON.parse(
        credential.transports,
      ) as AuthenticatorTransportFuture[],
    })),
  });
  return {
    token: await storeChallenge(
      user.id,
      options.challenge,
      "authentication",
      rememberDevice,
    ),
    options,
  };
}

export async function finishPasskeyAuthentication(
  token: string,
  response: AuthenticationResponseJSON,
  expectedOrigin: string,
  rpID: string,
  accessPortal: AccessPortal,
  metadata: SessionMetadata,
): Promise<AuthResult> {
  const challenge = await readChallenge(token, "authentication");
  const [credential, user] = await Promise.all([
    db
      .selectFrom("passkeyCredentials")
      .selectAll()
      .where("id", "=", response.id)
      .where("userId", "=", challenge.userId)
      .executeTakeFirst(),
    db
      .selectFrom("users")
      .select([
        "id",
        "email",
        "name",
        "avatarDataUrl",
        "role",
        "accountStatus",
        "emailVerifiedAt",
        "identityRealm",
      ])
      .where("id", "=", challenge.userId)
      .executeTakeFirst(),
  ]);
  if (!credential || !user) throw new Error("Passkey verification failed");
  const expectedRealm =
    accessPortal === "support" ? "corporate_support" : "commercial";
  if (user.identityRealm !== expectedRealm) {
    throw new Error("Passkey verification failed");
  }
  if (
    accessPortal === "support" &&
    (user.role !== "admin" ||
      user.accountStatus !== "active" ||
      user.emailVerifiedAt === null)
  ) {
    throw new Error("Passkey verification failed");
  }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: credential.id as Base64URLString,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
      counter: credential.counter,
      transports: JSON.parse(
        credential.transports,
      ) as AuthenticatorTransportFuture[],
    },
  });
  if (!verification.verified) throw new Error("Passkey verification failed");
  await db
    .updateTable("passkeyCredentials")
    .set({ counter: verification.authenticationInfo.newCounter })
    .where("id", "=", credential.id)
    .execute();
  await consumeChallenge(token);
  await recordSecurityEvent("passkey_login_succeeded", user.id);
  const session = await createSession(
    user,
    metadata,
    challenge.rememberDevice === 1,
  );
  await completeAccountRecovery(user.id, "passkey_verified");
  return session;
}

export async function removePasskeys(userId: string): Promise<void> {
  await db
    .deleteFrom("passkeyCredentials")
    .where("userId", "=", userId)
    .execute();
  await recordSecurityEvent("passkey_removed", userId);
}

export async function passkeyStatus(userId: string) {
  const result = await db
    .selectFrom("passkeyCredentials")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("userId", "=", userId)
    .executeTakeFirstOrThrow();
  const count = Number(result.count);
  return { enabled: count > 0, count };
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { db } from "../db/client.js";
import type { Database, FacilityInvitationStatus } from "../db/types.js";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  hashPassword,
  isStrongPassword,
} from "./auth.js";
import { ensureSupportIdentifier } from "./support-identifiers.js";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "../lib/legal-versions.js";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const workerRoles = ["admin", "trainer"] as const;

export type FacilityInvitationRole = "admin" | "trainer" | "member";
type FacilityWorkerRole = (typeof workerRoles)[number];
export type InvitationLocale = "es" | "en" | "de" | "de-CH";

export class FacilityInvitationError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus = 400,
  ) {
    super(code);
    this.name = "FacilityInvitationError";
  }
}

export interface PublicFacilityInvitation {
  facilityName: string;
  invitedEmail: string;
  invitedName: string;
  role: FacilityInvitationRole;
  status: FacilityInvitationStatus;
  expiresAt: number;
  existingAccount: boolean;
}

export interface ManagedFacilityInvitation extends PublicFacilityInvitation {
  id: string;
  createdAt: number;
  updatedAt: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertInvitationRole(
  role: string,
): asserts role is FacilityWorkerRole {
  if (!workerRoles.some((candidate) => candidate === role)) {
    throw new FacilityInvitationError("FACILITY_INVITATION_ROLE_INVALID");
  }
}

async function expireInvitationIfNeeded<
  T extends {
    id: string;
    status: FacilityInvitationStatus;
    expiresAt: number;
  },
>(invitation: T): Promise<T> {
  if (invitation.status !== "pending" || invitation.expiresAt > Date.now()) {
    return invitation;
  }
  const now = Date.now();
  await db
    .updateTable("facilityInvitations")
    .set({ status: "expired", updatedAt: now })
    .where("id", "=", invitation.id)
    .where("status", "=", "pending")
    .execute();
  return { ...invitation, status: "expired" };
}

async function invitationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    throw new FacilityInvitationError("FACILITY_INVITATION_INVALID", 404);
  }
  const invitation = await db
    .selectFrom("facilityInvitations")
    .innerJoin(
      "facilityProfiles",
      "facilityProfiles.id",
      "facilityInvitations.facilityId",
    )
    .select([
      "facilityInvitations.id",
      "facilityInvitations.facilityId",
      "facilityInvitations.invitedEmail",
      "facilityInvitations.invitedName",
      "facilityInvitations.role",
      "facilityInvitations.invitedUserId",
      "facilityInvitations.status",
      "facilityInvitations.expiresAt",
      "facilityProfiles.name as facilityName",
    ])
    .where("facilityInvitations.tokenHash", "=", tokenHash(token))
    .executeTakeFirst();
  if (!invitation) {
    throw new FacilityInvitationError("FACILITY_INVITATION_INVALID", 404);
  }
  return expireInvitationIfNeeded(invitation);
}

async function recomputeLegacyRole(
  transaction: Transaction<Database>,
  userId: string,
): Promise<void> {
  const memberships = await transaction
    .selectFrom("facilityMemberships")
    .select("role")
    .where("userId", "=", userId)
    .where("status", "=", "active")
    .execute();
  const role = memberships.some((membership) =>
    ["owner", "admin"].includes(membership.role),
  )
    ? "admin"
    : memberships.some((membership) => membership.role === "trainer")
      ? "trainer"
      : "member";
  await transaction
    .updateTable("users")
    .set({ role })
    .where("id", "=", userId)
    .execute();
}

export async function createFacilityInvitation(input: {
  facilityId: string;
  invitedByUserId: string;
  email: string;
  name: string;
  role: string;
}): Promise<{
  invitation: ManagedFacilityInvitation;
  token: string;
}> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  assertInvitationRole(input.role);
  const role = input.role;
  if (!email.includes("@") || !name) {
    throw new FacilityInvitationError("FACILITY_INVITATION_INPUT_INVALID");
  }

  const existingUser = await db
    .selectFrom("users")
    .select(["id", "accountStatus"])
    .where("identityRealm", "=", "commercial")
    .where("email", "=", email)
    .executeTakeFirst();
  const membership = existingUser
    ? await db
        .selectFrom("facilityMemberships")
        .select(["id", "status"])
        .where("facilityId", "=", input.facilityId)
        .where("userId", "=", existingUser.id)
        .executeTakeFirst()
    : undefined;
  if (membership?.status === "active") {
    throw new FacilityInvitationError("FACILITY_MEMBER_ALREADY_ACTIVE", 409);
  }
  if (membership?.status === "suspended") {
    throw new FacilityInvitationError("FACILITY_MEMBERSHIP_SUSPENDED", 409);
  }
  if (existingUser?.accountStatus === "security_review") {
    throw new FacilityInvitationError("INVITED_ACCOUNT_REQUIRES_REVIEW", 409);
  }

  const now = Date.now();
  const expiresAt = now + INVITATION_LIFETIME_MS;
  const token = randomBytes(32).toString("base64url");
  const id = `facility-invitation-${randomUUID()}`;
  const facility = await db
    .selectFrom("facilityProfiles")
    .select("name")
    .where("id", "=", input.facilityId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!facility) {
    throw new FacilityInvitationError("FACILITY_NOT_ACTIVE", 409);
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("facilityInvitations")
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where("facilityId", "=", input.facilityId)
      .where("invitedEmail", "=", email)
      .where("status", "=", "pending")
      .execute();
    if (existingUser) {
      if (membership) {
        await transaction
          .updateTable("facilityMemberships")
          .set({ role, status: "invited", updatedAt: now })
          .where("id", "=", membership.id)
          .execute();
      } else {
        await transaction
          .insertInto("facilityMemberships")
          .values({
            id: `${input.facilityId}:${existingUser.id}`,
            facilityId: input.facilityId,
            userId: existingUser.id,
            role,
            status: "invited",
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
    }
    await transaction
      .insertInto("facilityInvitations")
      .values({
        id,
        facilityId: input.facilityId,
        invitedEmail: email,
        invitedName: name,
        role,
        tokenHash: tokenHash(token),
        invitedByUserId: input.invitedByUserId,
        invitedUserId: existingUser?.id ?? null,
        status: "pending",
        expiresAt,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  });

  return {
    invitation: {
      id,
      facilityName: facility.name,
      invitedEmail: email,
      invitedName: name,
      role,
      status: "pending",
      expiresAt,
      existingAccount: Boolean(existingUser),
      createdAt: now,
      updatedAt: now,
    },
    token,
  };
}

export async function listFacilityInvitations(
  facilityId: string,
): Promise<ManagedFacilityInvitation[]> {
  const rows = await db
    .selectFrom("facilityInvitations")
    .innerJoin(
      "facilityProfiles",
      "facilityProfiles.id",
      "facilityInvitations.facilityId",
    )
    .select([
      "facilityInvitations.id",
      "facilityInvitations.invitedEmail",
      "facilityInvitations.invitedName",
      "facilityInvitations.role",
      "facilityInvitations.invitedUserId",
      "facilityInvitations.status",
      "facilityInvitations.expiresAt",
      "facilityInvitations.createdAt",
      "facilityInvitations.updatedAt",
      "facilityProfiles.name as facilityName",
    ])
    .where("facilityInvitations.facilityId", "=", facilityId)
    .orderBy("facilityInvitations.createdAt", "desc")
    .execute();
  return Promise.all(
    rows.map(async (row) => {
      const current = await expireInvitationIfNeeded(row);
      return {
        ...current,
        existingAccount: Boolean(current.invitedUserId),
      };
    }),
  );
}

export async function inspectFacilityInvitation(
  token: string,
): Promise<PublicFacilityInvitation> {
  const invitation = await invitationByToken(token);
  return {
    facilityName: invitation.facilityName,
    invitedEmail: invitation.invitedEmail,
    invitedName: invitation.invitedName,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    existingAccount: Boolean(invitation.invitedUserId),
  };
}

function assertPendingInvitation(invitation: {
  status: FacilityInvitationStatus;
}): void {
  if (invitation.status !== "pending") {
    throw new FacilityInvitationError("FACILITY_INVITATION_NOT_PENDING", 409);
  }
}

export async function acceptExistingFacilityInvitation(
  token: string,
  userId: string,
  authenticatedEmail: string,
): Promise<void> {
  const invitation = await invitationByToken(token);
  assertPendingInvitation(invitation);
  if (
    invitation.invitedEmail !== normalizeEmail(authenticatedEmail) ||
    invitation.invitedUserId !== userId
  ) {
    throw new FacilityInvitationError(
      "FACILITY_INVITATION_IDENTITY_MISMATCH",
      403,
    );
  }
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("facilityMemberships")
      .set({ role: invitation.role, status: "active", updatedAt: now })
      .where("facilityId", "=", invitation.facilityId)
      .where("userId", "=", userId)
      .where("status", "=", "invited")
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("facilityInvitations")
      .set({ status: "accepted", acceptedAt: now, updatedAt: now })
      .where("id", "=", invitation.id)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: now })
      .where("id", "=", userId)
      .where("accountStatus", "=", "pending_verification")
      .execute();
    await recomputeLegacyRole(transaction, userId);
  });
}

export async function acceptNewFacilityInvitation(
  token: string,
  input: {
    password: string;
    locale: InvitationLocale;
    acceptedTerms: boolean;
    acceptedPrivacy: boolean;
  },
): Promise<{ email: string }> {
  const invitation = await invitationByToken(token);
  assertPendingInvitation(invitation);
  if (invitation.invitedUserId) {
    throw new FacilityInvitationError(
      "FACILITY_INVITATION_LOGIN_REQUIRED",
      409,
    );
  }
  if (!input.acceptedTerms || !input.acceptedPrivacy) {
    throw new FacilityInvitationError("LEGAL_ACKNOWLEDGEMENT_REQUIRED");
  }
  if (!isStrongPassword(input.password)) {
    throw new FacilityInvitationError("PASSWORD_POLICY_FAILED");
  }
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("identityRealm", "=", "commercial")
    .where("email", "=", invitation.invitedEmail)
    .executeTakeFirst();
  if (existing) {
    throw new FacilityInvitationError(
      "FACILITY_INVITATION_LOGIN_REQUIRED",
      409,
    );
  }

  const now = Date.now();
  const userId = `user-${randomBytes(8).toString("hex")}`;
  const password = await hashPassword(input.password);
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("users")
      .values({
        id: userId,
        email: invitation.invitedEmail,
        identityRealm: "commercial",
        phone: null,
        name: invitation.invitedName,
        lastName: "",
        countryCode: "",
        locale: input.locale,
        accountStatus: "active",
        emailVerifiedAt: now,
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: now,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        privacyAcceptedAt: now,
        avatarDataUrl: "",
        password,
        role: invitation.role,
        sessionIdleTimeoutMinutes: DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("facilityMemberships")
      .values({
        id: `${invitation.facilityId}:${userId}`,
        facilityId: invitation.facilityId,
        userId,
        role: invitation.role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await transaction
      .updateTable("facilityInvitations")
      .set({
        invitedUserId: userId,
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
      })
      .where("id", "=", invitation.id)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
  });
  await ensureSupportIdentifier(userId);
  return { email: invitation.invitedEmail };
}

export async function declineFacilityInvitation(token: string): Promise<void> {
  const invitation = await invitationByToken(token);
  assertPendingInvitation(invitation);
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("facilityInvitations")
      .set({ status: "declined", declinedAt: now, updatedAt: now })
      .where("id", "=", invitation.id)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    if (invitation.invitedUserId) {
      await transaction
        .deleteFrom("facilityMemberships")
        .where("facilityId", "=", invitation.facilityId)
        .where("userId", "=", invitation.invitedUserId)
        .where("status", "=", "invited")
        .execute();
    }
  });
}

export async function revokeFacilityInvitation(
  id: string,
  facilityId: string,
): Promise<void> {
  const invitation = await db
    .selectFrom("facilityInvitations")
    .select(["id", "invitedUserId", "status"])
    .where("id", "=", id)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!invitation) {
    throw new FacilityInvitationError("FACILITY_INVITATION_NOT_FOUND", 404);
  }
  if (invitation.status !== "pending") {
    throw new FacilityInvitationError("FACILITY_INVITATION_NOT_PENDING", 409);
  }
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("facilityInvitations")
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where("id", "=", id)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    if (invitation.invitedUserId) {
      await transaction
        .deleteFrom("facilityMemberships")
        .where("facilityId", "=", facilityId)
        .where("userId", "=", invitation.invitedUserId)
        .where("status", "=", "invited")
        .execute();
    }
  });
}

export function publicInvitationTokenForTest(
  token: string,
): string | undefined {
  return process.env.NODE_ENV === "test" ? token : undefined;
}

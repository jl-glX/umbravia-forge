import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "../db/client.js";
import type {
  CompanyPosition,
  CorporateManagerProfileId,
  UmfSupportRole,
  UmfSupportTicketPriority,
  UmfSupportTicketStatus,
} from "../db/types.js";
import type { AuthenticatedUser } from "../middleware/authorization.js";
import {
  getPrivateContentEncryptionStatus,
  protectPrivateText,
  revealPrivateText,
} from "../lib/private-content-crypto.js";
import {
  isProductionLike,
  resolveDeploymentProfile,
} from "../lib/deployment-profile.js";
import {
  buildUmfSupportReplyAddress,
  parseUmfSupportEmailRecipient,
  resolveUmfSupportEmailConfiguration,
  verifyUmfSupportReplyToken,
  type UmfSupportEmailConfiguration,
} from "../lib/umf-support-email.js";
import {
  extractUnquotedSupportReply,
  type SupportInboundEmailPayload,
} from "../lib/support-email-inbound.js";
import {
  deliverQueuedEmail,
  queueUmfSupportAccessCodeEmail,
  queueUmfSupportReplyEmail,
} from "./email-delivery.js";
import {
  createCorporateSupportAccount,
  isStrongPassword,
  type AuthResult,
} from "./auth.js";
import { isPasswordWithinHashLimit } from "../lib/password-policy.js";
import {
  bootstrapCompanyHead,
  canRequestCompanyHeadBootstrap,
} from "./company-bootstrap.js";
import { getEmailManagerReadiness } from "./email-manager.js";
import { recordSecurityEvent } from "./security-events.js";

const ACCESS_CODE_DURATION_MS = 24 * 60 * 60 * 1000;
const ACCESS_CODE_MAX_ATTEMPTS = 5;
const priorities = new Set<UmfSupportTicketPriority>([
  "low",
  "normal",
  "high",
  "urgent",
]);
const statuses = new Set<UmfSupportTicketStatus>([
  "open",
  "in_progress",
  "waiting_on_requester",
  "resolved",
  "closed",
]);
const categories = new Set([
  "account",
  "billing",
  "privacy",
  "technical",
  "security",
  "general",
]);
const companyModuleProfiles = new Set<CorporateManagerProfileId>([
  "manager-core",
  "manager-coordinator",
  "manager-flow-administrator",
  "manager-account",
  "manager-security",
  "manager-resource",
  "manager-encryption",
  "manager-environment",
  "manager-email",
  "manager-notification",
  "manager-support",
]);
const assignableCompanyPositions = new Set<CompanyPosition>([
  "area_head",
  "team_lead",
  "staff",
  "external_collaborator",
]);
const slaByPriority: Record<
  UmfSupportTicketPriority,
  { firstResponseMs: number; resolutionMs: number }
> = {
  low: { firstResponseMs: 24 * 60 * 60 * 1000, resolutionMs: 7 * 86400000 },
  normal: { firstResponseMs: 8 * 60 * 60 * 1000, resolutionMs: 3 * 86400000 },
  high: { firstResponseMs: 2 * 60 * 60 * 1000, resolutionMs: 86400000 },
  urgent: { firstResponseMs: 30 * 60 * 1000, resolutionMs: 4 * 60 * 60 * 1000 },
};

export class UmfSupportAccessError extends Error {
  readonly statusCode = 403;
}

export class UmfSupportValidationError extends Error {
  readonly statusCode = 400;
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export class UmfSupportNotFoundError extends Error {
  readonly statusCode = 404;
}

export class UmfSupportUnavailableError extends Error {
  readonly statusCode = 503;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new UmfSupportValidationError(`${name} is required`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new UmfSupportValidationError(`${name} is invalid`);
  }
  return normalized;
}

function requiredPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !isPasswordWithinHashLimit(value)
  ) {
    throw new UmfSupportValidationError(
      "Password does not meet the security requirements",
      "UMF_SUPPORT_PASSWORD_POLICY",
    );
  }
  return value;
}

function normalizedEmail(value: unknown): string {
  const email = requiredText(value, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UmfSupportValidationError("email is invalid");
  }
  return email;
}

function emailFingerprint(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 24);
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

const DUMMY_ACCESS_CODE_HASH = hashCode(
  "000000",
  "umf-support-dummy-activation-code",
);

async function cleanupExpiredAccessCredentials(now = Date.now()) {
  const expired = await db
    .selectFrom("umfSupportAccessCredentials")
    .select("requestId")
    .where("expiresAt", "<=", now)
    .execute();
  if (expired.length === 0) return 0;
  const requestIds = expired.map((entry) => entry.requestId);
  await db
    .deleteFrom("umfSupportAccessCredentials")
    .where("requestId", "in", requestIds)
    .execute();
  return requestIds.length;
}

function requestedSupportRole(value: unknown): UmfSupportRole {
  const role = requiredText(value ?? "agent", "requestedRole", 16);
  if (role !== "agent" && role !== "director") {
    throw new UmfSupportValidationError(
      "requestedRole is invalid",
      "UMF_SUPPORT_ROLE_INVALID",
    );
  }
  return role;
}

function protectMessage(value: string, messageId: string): string {
  requireCorporateContentProtection();
  return protectPrivateText(value, `umf-support:message:${messageId}`);
}

function revealMessage(value: string, messageId: string): string {
  requireCorporateContentProtection();
  return revealPrivateText(value, `umf-support:message:${messageId}`);
}

function requireCorporateContentProtection(): void {
  if (
    isProductionLike(resolveDeploymentProfile()) &&
    !getPrivateContentEncryptionStatus().enabled
  ) {
    throw new UmfSupportUnavailableError(
      "UMF Support requires private content encryption in production",
    );
  }
}

function publicTicketId(): string {
  return `UMF-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function categoryForInboundSubject(subject: string): "privacy" | "general" {
  const normalized = subject
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return /\b(privacidad|proteccion de datos|derecho de acceso|rectificacion|supresion|portabilidad|oposicion|privacy|data protection|access request|erasure|datenschutz|auskunft|loschung)\b/.test(
    normalized,
  )
    ? "privacy"
    : "general";
}

export async function getUmfSupportRole(
  userId: string,
): Promise<UmfSupportRole | null> {
  const staff = await db
    .selectFrom("umfSupportStaff")
    .select("role")
    .where("userId", "=", userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return staff?.role ?? null;
}

async function requireStaff(auth: AuthenticatedUser): Promise<UmfSupportRole> {
  if (auth.identityRealm !== "corporate_support") {
    throw new UmfSupportAccessError("UMF Support access is required");
  }
  const role = await getUmfSupportRole(auth.userId);
  if (!role) throw new UmfSupportAccessError("UMF Support access is required");
  return role;
}

async function requireDirector(auth: AuthenticatedUser): Promise<void> {
  if ((await requireStaff(auth)) !== "director") {
    throw new UmfSupportAccessError("UMF Support director access is required");
  }
}

export async function getUmfSupportCapabilities(auth: AuthenticatedUser) {
  const role = await requireStaff(auth);
  const companyHead = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("position", "=", "platform_head")
    .where("status", "=", "active")
    .executeTakeFirst();
  const readiness = getEmailManagerReadiness();
  let inbound = false;
  let configurationValid = true;
  try {
    inbound = resolveUmfSupportEmailConfiguration() !== null;
  } catch {
    configurationValid = false;
  }
  return {
    role,
    canReviewAccess: role === "director",
    canManageTeam: role === "director",
    canManageCompanyRoles: Boolean(companyHead),
    email: {
      outbound: readiness.capabilities.supportNotifications,
      inbound,
      addressConfigured: Boolean(process.env.UMF_SUPPORT_EMAIL_ADDRESS?.trim()),
      configurationValid,
    },
    deliveryOperationallyVerified: false,
  };
}

export function getUmfSupportDistribution() {
  return {
    stage: "production" as const,
    channel: "web" as const,
    path: "/umf-support/access",
    available: true,
    installer: null,
  };
}

export async function requestUmfSupportAccess(input: Record<string, unknown>) {
  const email = normalizedEmail(input.email);
  await cleanupExpiredAccessCredentials();
  const name = requiredText(input.name, "name", 100);
  const lastName = requiredText(input.lastName, "lastName", 100);
  const requestedRole = requestedSupportRole(input.requestedRole);
  const locale = requiredText(input.locale ?? "es", "locale", 5) as
    "es" | "en" | "de" | "de-CH";
  if (!new Set(["es", "en", "de", "de-CH"]).has(locale)) {
    throw new UmfSupportValidationError("locale is invalid");
  }
  const [existingUser, openRequest, designatedHead] = await Promise.all([
    db
      .selectFrom("users")
      .select("id")
      .where("email", "=", email)
      .where("identityRealm", "=", "corporate_support")
      .executeTakeFirst(),
    db
      .selectFrom("umfSupportAccessRequests")
      .select("id")
      .where("email", "=", email)
      .where("status", "in", ["pending", "approved"])
      .executeTakeFirst(),
    canRequestCompanyHeadBootstrap(email),
  ]);
  let created = false;
  let activationCode: string | null = null;
  let activationExpiresAt: number | null = null;
  if (!existingUser && !openRequest) {
    const now = Date.now();
    const requestId = `umf-support-access-${randomUUID()}`;
    activationCode = designatedHead
      ? randomInt(0, 1_000_000).toString().padStart(6, "0")
      : null;
    activationExpiresAt = designatedHead ? now + ACCESS_CODE_DURATION_MS : null;
    try {
      await db.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("umfSupportAccessRequests")
          .values({
            id: requestId,
            email,
            name,
            lastName,
            requestedRole: designatedHead ? "director" : requestedRole,
            activationKind: designatedHead ? "designated_head" : "staff",
            locale,
            status: designatedHead ? "approved" : "pending",
            activationCodeHash: activationCode
              ? hashCode(activationCode)
              : null,
            activationAttempts: 0,
            activationExpiresAt,
            reviewedByUserId: null,
            reviewedAt: designatedHead ? now : null,
            activatedUserId: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      });
      created = true;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("unique") && !message.includes("duplicate")) {
        throw error;
      }
      activationCode = null;
      activationExpiresAt = null;
    }
  }
  let delivered = false;
  if (created && designatedHead && activationCode && activationExpiresAt) {
    const deliveryId = await queueUmfSupportAccessCodeEmail({
      email,
      name,
      code: activationCode,
      locale,
      expiresAt: activationExpiresAt,
    });
    delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
  }
  await recordSecurityEvent("umf_support_access_requested", null, {
    emailFingerprint: emailFingerprint(email),
    created,
    approvalMode: created && designatedHead ? "designated_head" : "manual",
    activationDeliveryQueued: created && designatedHead,
    activationDelivered: delivered,
  });
  return {
    accepted: true,
    demoActivationCode:
      process.env.NODE_ENV === "test" && created && designatedHead
        ? activationCode
        : undefined,
  };
}

export async function resumeDesignatedCompanyHeadActivation(
  emailInput: string,
) {
  const email = normalizedEmail(emailInput);
  const now = Date.now();
  await cleanupExpiredAccessCredentials(now);
  if (!(await canRequestCompanyHeadBootstrap(email))) {
    throw new UmfSupportValidationError(
      "The designated company head activation cannot be resumed",
      "COMPANY_HEAD_ACTIVATION_UNAVAILABLE",
    );
  }

  const request = await db
    .selectFrom("umfSupportAccessRequests")
    .select(["id", "name", "locale", "status"])
    .where("email", "=", email)
    .where("status", "in", ["pending", "approved"])
    .orderBy("updatedAt", "desc")
    .executeTakeFirst();
  if (!request) {
    throw new UmfSupportValidationError(
      "No company head role request is available",
      "COMPANY_HEAD_PRE_ENROLMENT_UNAVAILABLE",
    );
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = now + ACCESS_CODE_DURATION_MS;
  await db.transaction().execute(async (transaction) => {
    const updated = await transaction
      .updateTable("umfSupportAccessRequests")
      .set({
        status: "approved",
        requestedRole: "director",
        activationKind: "designated_head",
        activationCodeHash: hashCode(code),
        activationAttempts: 0,
        activationExpiresAt: expiresAt,
        reviewedByUserId: null,
        reviewedAt: now,
        updatedAt: now,
      })
      .where("id", "=", request.id)
      .where("status", "in", ["pending", "approved"])
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) {
      throw new UmfSupportValidationError(
        "The company head role request changed during recovery",
        "COMPANY_HEAD_ACTIVATION_UNAVAILABLE",
      );
    }
    await transaction
      .updateTable("umfSupportAccessCredentials")
      .set({ activationKind: "designated_head" })
      .where("requestId", "=", request.id)
      .execute();
  });

  const deliveryId = await queueUmfSupportAccessCodeEmail({
    email,
    name: request.name,
    code,
    locale: request.locale,
    expiresAt,
  });
  const delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
  await recordSecurityEvent("umf_support_access_approved", null, {
    requestId: request.id,
    delivered,
    resumedDesignatedHeadActivation: true,
  });
  return {
    requestId: request.id,
    expiresAt,
    delivered,
    queued: !delivered,
    demoActivationCode: process.env.NODE_ENV === "test" ? code : undefined,
  };
}

export async function listUmfSupportAccessRequests(auth: AuthenticatedUser) {
  await requireDirector(auth);
  return db
    .selectFrom("umfSupportAccessRequests")
    .select([
      "id",
      "email",
      "name",
      "lastName",
      "requestedRole",
      "locale",
      "status",
      "activationExpiresAt",
      "reviewedByUserId",
      "reviewedAt",
      "activatedUserId",
      "createdAt",
      "updatedAt",
    ])
    .orderBy("createdAt", "desc")
    .limit(200)
    .execute();
}

export async function approveUmfSupportAccess(
  auth: AuthenticatedUser,
  requestId: string,
) {
  await requireDirector(auth);
  const now = Date.now();
  await cleanupExpiredAccessCredentials(now);
  const request = await db
    .selectFrom("umfSupportAccessRequests")
    .selectAll()
    .where("id", "=", requestId)
    .executeTakeFirst();
  if (!request) throw new UmfSupportNotFoundError("Access request not found");
  if (request.status !== "pending") {
    throw new UmfSupportValidationError("Access request is not pending");
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = now + ACCESS_CODE_DURATION_MS;
  const updated = await db
    .updateTable("umfSupportAccessRequests")
    .set({
      status: "approved",
      activationCodeHash: hashCode(code),
      activationAttempts: 0,
      activationExpiresAt: expiresAt,
      reviewedByUserId: auth.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where("id", "=", requestId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) !== 1) {
    throw new UmfSupportValidationError("Access request changed during review");
  }
  const deliveryId = await queueUmfSupportAccessCodeEmail({
    email: request.email,
    name: request.name,
    code,
    locale: request.locale,
    expiresAt,
  });
  const delivered = await deliverQueuedEmail(deliveryId).catch(() => false);
  await recordSecurityEvent("umf_support_access_approved", auth.userId, {
    requestId,
    delivered,
  });
  return { code, expiresAt, delivered, queued: !delivered };
}

export async function rejectUmfSupportAccess(
  auth: AuthenticatedUser,
  requestId: string,
) {
  await requireDirector(auth);
  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    const result = await transaction
      .updateTable("umfSupportAccessRequests")
      .set({
        status: "rejected",
        activationCodeHash: null,
        activationExpiresAt: null,
        reviewedByUserId: auth.userId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where("id", "=", requestId)
      .where("status", "in", ["pending", "approved"])
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) {
      throw new UmfSupportValidationError("Access request cannot be rejected");
    }
    await transaction
      .deleteFrom("umfSupportAccessCredentials")
      .where("requestId", "=", requestId)
      .execute();
  });
  await recordSecurityEvent("umf_support_access_rejected", auth.userId, {
    requestId,
  });
}

export async function activateUmfSupportAccount(
  input: Record<string, unknown>,
  metadata: { userAgent?: string },
): Promise<AuthResult> {
  const email = normalizedEmail(input.email);
  const now = Date.now();
  await cleanupExpiredAccessCredentials(now);
  const password = requiredPassword(input.password);
  if (!isStrongPassword(password)) {
    throw new UmfSupportValidationError(
      "Password does not meet the security requirements",
      "UMF_SUPPORT_PASSWORD_POLICY",
    );
  }
  const code = requiredText(input.code, "code", 6);
  if (!/^\d{6}$/.test(code)) {
    throw new UmfSupportValidationError(
      "Email or activation code is invalid or expired",
      "UMF_SUPPORT_ACTIVATION_INVALID",
    );
  }
  const request = await db
    .selectFrom("umfSupportAccessRequests")
    .selectAll()
    .where("email", "=", email)
    .where("status", "=", "approved")
    .orderBy("updatedAt", "desc")
    .executeTakeFirst();
  const requestUsable = Boolean(
    request?.activationCodeHash &&
    request.activationExpiresAt &&
    request.activationExpiresAt > now &&
    request.activationAttempts < ACCESS_CODE_MAX_ATTEMPTS,
  );
  const activationCodeMatches = codeMatches(
    code,
    request?.activationCodeHash ?? DUMMY_ACCESS_CODE_HASH,
  );
  if (!request || !requestUsable || !activationCodeMatches) {
    if (request) {
      const nextAttempts = request.activationAttempts + 1;
      const closeRequest =
        !request.activationExpiresAt ||
        request.activationExpiresAt <= now ||
        nextAttempts >= ACCESS_CODE_MAX_ATTEMPTS;
      await db.transaction().execute(async (transaction) => {
        await transaction
          .updateTable("umfSupportAccessRequests")
          .set({
            activationAttempts: nextAttempts,
            status: closeRequest ? "expired" : "approved",
            activationCodeHash: closeRequest
              ? null
              : request.activationCodeHash,
            activationExpiresAt: closeRequest
              ? null
              : request.activationExpiresAt,
            updatedAt: now,
          })
          .where("id", "=", request.id)
          .where("status", "=", "approved")
          .execute();
        if (closeRequest) {
          await transaction
            .deleteFrom("umfSupportAccessCredentials")
            .where("requestId", "=", request.id)
            .execute();
        }
      });
    }
    await recordSecurityEvent("umf_support_activation_failed", null, {
      emailFingerprint: emailFingerprint(email),
      reason: "activation_code_mismatch",
    });
    throw new UmfSupportValidationError(
      "Email or activation code is invalid or expired",
      "UMF_SUPPORT_ACTIVATION_INVALID",
    );
  }
  const countryCode = requiredText(
    input.countryCode ?? "ES",
    "countryCode",
    2,
  ).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new UmfSupportValidationError("countryCode is invalid");
  }
  const result = await createCorporateSupportAccount(
    email,
    request.name,
    password,
    metadata,
    {
      lastName: request.lastName,
      countryCode,
      locale: request.locale,
      acceptedTerms: input.acceptedTerms === true,
      acceptedPrivacy: input.acceptedPrivacy === true,
    },
  );
  try {
    if (request.activationKind === "designated_head") {
      await bootstrapCompanyHead(result.user.id, request.id);
    } else {
      await db.transaction().execute(async (transaction) => {
        const consumed = await transaction
          .updateTable("umfSupportAccessRequests")
          .set({
            status: "activated",
            activationCodeHash: null,
            activationExpiresAt: null,
            activatedUserId: result.user.id,
            updatedAt: Date.now(),
          })
          .where("id", "=", request.id)
          .where("status", "=", "approved")
          .where("activationCodeHash", "=", request.activationCodeHash)
          .executeTakeFirst();
        if (Number(consumed.numUpdatedRows) !== 1) {
          throw new UmfSupportValidationError("Code was already used");
        }
        await transaction
          .deleteFrom("umfSupportAccessCredentials")
          .where("requestId", "=", request.id)
          .execute();
        await transaction
          .insertInto("umfSupportStaff")
          .values({
            userId: result.user.id,
            role: request.requestedRole,
            status: "active",
            approvedByUserId: request.reviewedByUserId,
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      });
    }
  } catch (error) {
    await db.deleteFrom("users").where("id", "=", result.user.id).execute();
    throw error;
  }
  await recordSecurityEvent("umf_support_account_activated", result.user.id, {
    requestId: request.id,
    approvedByUserId:
      request.activationKind === "designated_head"
        ? result.user.id
        : (request.reviewedByUserId ?? "unknown"),
    activationKind: request.activationKind,
    requestedRole: request.requestedRole,
  });
  return result;
}

export async function listUmfSupportStaff(auth: AuthenticatedUser) {
  await requireStaff(auth);
  return db
    .selectFrom("umfSupportStaff")
    .innerJoin("users", "users.id", "umfSupportStaff.userId")
    .select([
      "umfSupportStaff.userId",
      "umfSupportStaff.role",
      "umfSupportStaff.status",
      "umfSupportStaff.createdAt",
      "users.name",
      "users.lastName",
      "users.email",
    ])
    .orderBy("users.name")
    .execute();
}

export async function listCompanyStaff(auth: AuthenticatedUser) {
  await requireStaff(auth);
  return db
    .selectFrom("companyStaffProfiles")
    .innerJoin("users", "users.id", "companyStaffProfiles.userId")
    .leftJoin(
      "users as manager",
      "manager.id",
      "companyStaffProfiles.reportsToUserId",
    )
    .select([
      "companyStaffProfiles.userId",
      "companyStaffProfiles.position",
      "companyStaffProfiles.reportsToUserId",
      "companyStaffProfiles.status",
      "companyStaffProfiles.createdAt",
      "users.name",
      "users.lastName",
      "users.email",
      "manager.name as managerName",
      "manager.lastName as managerLastName",
    ])
    .orderBy("companyStaffProfiles.position")
    .orderBy("users.name")
    .execute();
}

function assignableCompanyPosition(value: unknown): CompanyPosition {
  const position = requiredText(value, "position", 32) as CompanyPosition;
  if (!assignableCompanyPositions.has(position)) {
    throw new UmfSupportValidationError("Company position is invalid");
  }
  return position;
}

export async function updateCompanyStaff(
  auth: AuthenticatedUser,
  userId: string,
  input: Record<string, unknown>,
) {
  await requireCompanyHead(auth);
  if (userId === auth.userId) {
    throw new UmfSupportValidationError(
      "The company head profile cannot be changed from the staff directory",
    );
  }
  const position = assignableCompanyPosition(input.position);
  const status = requiredText(input.status, "status", 16);
  if (status !== "active" && status !== "revoked") {
    throw new UmfSupportValidationError("Company staff status is invalid");
  }
  const reportsToUserId =
    input.reportsToUserId === null || input.reportsToUserId === undefined
      ? auth.userId
      : requiredText(input.reportsToUserId, "reportsToUserId", 128);
  if (reportsToUserId === userId) {
    throw new UmfSupportValidationError(
      "A company staff member cannot report to themselves",
    );
  }

  const [supportMember, manager, existing] = await Promise.all([
    db
      .selectFrom("umfSupportStaff")
      .select(["userId", "status"])
      .where("userId", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("companyStaffProfiles")
      .select("userId")
      .where("userId", "=", reportsToUserId)
      .where("status", "=", "active")
      .executeTakeFirst(),
    db
      .selectFrom("companyStaffProfiles")
      .select(["userId", "position"])
      .where("userId", "=", userId)
      .executeTakeFirst(),
  ]);
  if (
    !supportMember ||
    (status === "active" && supportMember.status !== "active")
  ) {
    throw new UmfSupportNotFoundError(
      "An active UMF Support account is required before joining company staff",
    );
  }
  if (!manager) {
    throw new UmfSupportNotFoundError("Active company manager not found");
  }
  if (existing?.position === "platform_head") {
    throw new UmfSupportValidationError(
      "The company head profile cannot be reassigned",
    );
  }

  const now = Date.now();
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("companyStaffProfiles")
      .values({
        userId,
        position,
        reportsToUserId,
        status,
        appointedByUserId: auth.userId,
        createdAt: now,
        updatedAt: now,
        revokedAt: status === "revoked" ? now : null,
      })
      .onConflict((conflict) =>
        conflict.column("userId").doUpdateSet({
          position,
          reportsToUserId,
          status,
          appointedByUserId: auth.userId,
          updatedAt: now,
          revokedAt: status === "revoked" ? now : null,
        }),
      )
      .execute();
    if (status === "revoked") {
      await transaction
        .updateTable("corporateRoleAssignments")
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where("userId", "=", userId)
        .where("status", "=", "active")
        .execute();
      await transaction
        .updateTable("corporateRoleDelegations")
        .set({ status: "withdrawn", respondedAt: now, updatedAt: now })
        .where("recipientUserId", "=", userId)
        .where("status", "in", ["pending", "accepted"])
        .execute();
    }
  });
  await recordSecurityEvent("company_staff_updated", auth.userId, {
    companyUserId: userId,
    position,
    status,
    reportsToUserId,
  });
}

function companyProfile(value: unknown): CorporateManagerProfileId {
  const profileId = requiredText(
    value,
    "profileId",
    64,
  ) as CorporateManagerProfileId;
  if (!companyModuleProfiles.has(profileId)) {
    throw new UmfSupportValidationError("Company module profile is invalid");
  }
  return profileId;
}

async function requireCompanyHead(auth: AuthenticatedUser): Promise<void> {
  await requireDirector(auth);
  const head = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("position", "=", "platform_head")
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!head) {
    throw new UmfSupportAccessError(
      "Active company head authority is required",
    );
  }
}

export async function listCompanyRoleDelegations(auth: AuthenticatedUser) {
  await requireStaff(auth);
  const companyHead = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("position", "=", "platform_head")
    .where("status", "=", "active")
    .executeTakeFirst();
  let query = db
    .selectFrom("corporateRoleDelegations")
    .innerJoin(
      "users as recipient",
      "recipient.id",
      "corporateRoleDelegations.recipientUserId",
    )
    .select([
      "corporateRoleDelegations.id",
      "corporateRoleDelegations.profileId",
      "corporateRoleDelegations.recipientUserId",
      "corporateRoleDelegations.status",
      "corporateRoleDelegations.createdAt",
      "corporateRoleDelegations.respondedAt",
      "recipient.name as recipientName",
      "recipient.lastName as recipientLastName",
    ]);
  if (!companyHead) {
    query = query.where(
      "corporateRoleDelegations.recipientUserId",
      "=",
      auth.userId,
    );
  }
  return query
    .orderBy("corporateRoleDelegations.createdAt", "desc")
    .limit(200)
    .execute();
}

export async function delegateCompanyRole(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  await requireCompanyHead(auth);
  const profileId = companyProfile(input.profileId);
  const recipientUserId = requiredText(
    input.recipientUserId,
    "recipientUserId",
    128,
  );
  if (recipientUserId === auth.userId) {
    throw new UmfSupportValidationError(
      "Use self-enable instead of delegating a role to yourself",
    );
  }
  const recipient = await db
    .selectFrom("companyStaffProfiles")
    .innerJoin(
      "umfSupportStaff",
      "umfSupportStaff.userId",
      "companyStaffProfiles.userId",
    )
    .select("companyStaffProfiles.userId")
    .where("companyStaffProfiles.userId", "=", recipientUserId)
    .where("companyStaffProfiles.status", "=", "active")
    .where("umfSupportStaff.status", "=", "active")
    .executeTakeFirst();
  if (!recipient) {
    throw new UmfSupportNotFoundError("Active company staff member not found");
  }
  const existingAssignment = await db
    .selectFrom("corporateRoleAssignments")
    .select("id")
    .where("userId", "=", recipientUserId)
    .where("profileId", "=", profileId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existingAssignment) {
    throw new UmfSupportValidationError("Company role is already active");
  }
  const existing = await db
    .selectFrom("corporateRoleDelegations")
    .select("id")
    .where("recipientUserId", "=", recipientUserId)
    .where("profileId", "=", profileId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (existing) return { id: existing.id, pending: true };

  const id = `corporate-delegation-${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  await db
    .insertInto("corporateRoleDelegations")
    .values({
      id,
      profileId,
      delegatedByUserId: auth.userId,
      recipientUserId,
      status: "pending",
      assignmentId: null,
      createdAt: now,
      respondedAt: null,
      updatedAt: now,
    })
    .execute();
  await recordSecurityEvent("corporate_role_delegated", auth.userId, {
    delegationId: id,
    profileId,
    recipientUserId,
  });
  return { id, pending: true };
}

export async function respondToCompanyRoleDelegation(
  auth: AuthenticatedUser,
  delegationId: string,
  decision: unknown,
) {
  await requireStaff(auth);
  const normalizedDecision = requiredText(decision, "decision", 16);
  if (normalizedDecision !== "accept" && normalizedDecision !== "reject") {
    throw new UmfSupportValidationError("Delegation decision is invalid");
  }
  const delegation = await db
    .selectFrom("corporateRoleDelegations")
    .selectAll()
    .where("id", "=", delegationId)
    .where("recipientUserId", "=", auth.userId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (!delegation) {
    throw new UmfSupportNotFoundError(
      "Pending company role delegation not found",
    );
  }
  const activeStaff = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!activeStaff) {
    throw new UmfSupportAccessError(
      "Active company staff membership is required",
    );
  }

  const now = Date.now();
  let assignmentId: string | null = null;
  await db.transaction().execute(async (transaction) => {
    if (normalizedDecision === "accept") {
      const existing = await transaction
        .selectFrom("corporateRoleAssignments")
        .select("id")
        .where("userId", "=", auth.userId)
        .where("profileId", "=", delegation.profileId)
        .where("status", "=", "active")
        .executeTakeFirst();
      assignmentId =
        existing?.id ?? `corporate-role-${randomBytes(12).toString("hex")}`;
      if (!existing) {
        await transaction
          .insertInto("corporateRoleAssignments")
          .values({
            id: assignmentId,
            userId: auth.userId,
            profileId: delegation.profileId,
            assignedByUserId: delegation.delegatedByUserId,
            status: "active",
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          })
          .execute();
      }
    }
    await transaction
      .updateTable("corporateRoleDelegations")
      .set({
        status: normalizedDecision === "accept" ? "accepted" : "rejected",
        assignmentId,
        respondedAt: now,
        updatedAt: now,
      })
      .where("id", "=", delegation.id)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
  });
  await recordSecurityEvent(
    normalizedDecision === "accept"
      ? "corporate_role_accepted"
      : "corporate_role_rejected",
    auth.userId,
    { delegationId: delegation.id, profileId: delegation.profileId },
  );
  return { status: normalizedDecision === "accept" ? "accepted" : "rejected" };
}

export async function renounceCompanyRole(
  auth: AuthenticatedUser,
  profileValue: unknown,
) {
  await requireStaff(auth);
  const profileId = companyProfile(profileValue);
  const now = Date.now();
  const assignment = await db
    .updateTable("corporateRoleAssignments")
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where("userId", "=", auth.userId)
    .where("profileId", "=", profileId)
    .where("status", "=", "active")
    .returning("id")
    .executeTakeFirst();
  if (!assignment) {
    throw new UmfSupportNotFoundError("Active company role not found");
  }
  await db
    .updateTable("corporateRoleDelegations")
    .set({ status: "renounced", respondedAt: now, updatedAt: now })
    .where("assignmentId", "=", assignment.id)
    .where("status", "=", "accepted")
    .execute();
  await recordSecurityEvent("corporate_role_renounced", auth.userId, {
    assignmentId: assignment.id,
    profileId,
  });
}

export async function selfEnableCompanyRole(
  auth: AuthenticatedUser,
  profileValue: unknown,
) {
  await requireCompanyHead(auth);
  const profileId = companyProfile(profileValue);
  const existing = await db
    .selectFrom("corporateRoleAssignments")
    .select("id")
    .where("userId", "=", auth.userId)
    .where("profileId", "=", profileId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) return;
  const now = Date.now();
  const assignmentId = `corporate-role-${randomBytes(12).toString("hex")}`;
  await db
    .insertInto("corporateRoleAssignments")
    .values({
      id: assignmentId,
      userId: auth.userId,
      profileId,
      assignedByUserId: auth.userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .execute();
  await recordSecurityEvent("corporate_role_self_enabled", auth.userId, {
    assignmentId,
    profileId,
  });
}

export async function updateUmfSupportStaff(
  auth: AuthenticatedUser,
  userId: string,
  input: Record<string, unknown>,
) {
  await requireDirector(auth);
  if (userId === auth.userId && input.status === "revoked") {
    throw new UmfSupportValidationError(
      "A director cannot revoke their own access",
    );
  }
  const role = requiredText(input.role, "role", 16) as UmfSupportRole;
  const status = requiredText(input.status, "status", 16) as
    "active" | "revoked";
  if (
    !new Set(["director", "agent"]).has(role) ||
    !new Set(["active", "revoked"]).has(status)
  ) {
    throw new UmfSupportValidationError("Staff role or status is invalid");
  }
  const now = Date.now();
  const result = await db
    .updateTable("umfSupportStaff")
    .set({
      role,
      status,
      updatedAt: now,
      revokedAt: status === "revoked" ? now : null,
    })
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new UmfSupportNotFoundError("UMF Support staff member not found");
  }
  await recordSecurityEvent("umf_support_staff_changed", auth.userId, {
    subjectUserId: userId,
    role,
    status,
  });
}

async function ticketById(ticketId: string) {
  const ticket = await db
    .selectFrom("umfSupportTickets")
    .leftJoin(
      "users as assignee",
      "assignee.id",
      "umfSupportTickets.assigneeUserId",
    )
    .selectAll("umfSupportTickets")
    .select("assignee.name as assigneeName")
    .where("umfSupportTickets.id", "=", ticketId)
    .executeTakeFirst();
  if (!ticket)
    throw new UmfSupportNotFoundError("UMF Support ticket not found");
  return ticket;
}

export async function listUmfSupportTickets(
  auth: AuthenticatedUser,
  filters: { status?: string; q?: string } = {},
) {
  await requireStaff(auth);
  let query = db
    .selectFrom("umfSupportTickets")
    .leftJoin(
      "users as assignee",
      "assignee.id",
      "umfSupportTickets.assigneeUserId",
    )
    .selectAll("umfSupportTickets")
    .select("assignee.name as assigneeName");
  if (
    filters.status &&
    statuses.has(filters.status as UmfSupportTicketStatus)
  ) {
    query = query.where(
      "umfSupportTickets.status",
      "=",
      filters.status as UmfSupportTicketStatus,
    );
  }
  const search = filters.q?.trim().slice(0, 120);
  if (search) {
    query = query.where((expression) =>
      expression.or([
        expression("umfSupportTickets.publicId", "like", `%${search}%`),
        expression("umfSupportTickets.subject", "like", `%${search}%`),
        expression("umfSupportTickets.requesterEmail", "like", `%${search}%`),
      ]),
    );
  }
  return query
    .orderBy("umfSupportTickets.updatedAt", "desc")
    .limit(250)
    .execute();
}

export async function getUmfSupportTicket(
  auth: AuthenticatedUser,
  ticketId: string,
) {
  await requireStaff(auth);
  const ticket = await ticketById(ticketId);
  const messages = await db
    .selectFrom("umfSupportMessages")
    .leftJoin("users", "users.id", "umfSupportMessages.authorUserId")
    .leftJoin(
      "emailDeliveries",
      "emailDeliveries.id",
      "umfSupportMessages.deliveryId",
    )
    .selectAll("umfSupportMessages")
    .select([
      "users.name as authorName",
      "emailDeliveries.status as deliveryStatus",
    ])
    .where("umfSupportMessages.ticketId", "=", ticketId)
    .orderBy("umfSupportMessages.createdAt", "asc")
    .execute();
  await recordSecurityEvent("private_content_accessed", auth.userId, {
    domain: "umf_support",
    ticketPublicId: ticket.publicId,
  });
  return {
    ...ticket,
    messages: messages.map((message) => ({
      ...message,
      body: revealMessage(message.body, message.id),
    })),
  };
}

export async function createUmfSupportTicket(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  await requireStaff(auth);
  return createTicket({
    requesterUserId: null,
    requesterEmail: normalizedEmail(input.requesterEmail),
    requesterName: requiredText(input.requesterName, "requesterName", 160),
    organizationName:
      typeof input.organizationName === "string"
        ? input.organizationName.trim().slice(0, 160)
        : "",
    subject: requiredText(input.subject, "subject", 160),
    message: requiredText(input.message, "message", 20_000),
    category: requiredText(input.category ?? "general", "category", 32),
    priority: requiredText(input.priority ?? "normal", "priority", 16),
    source: "internal",
    channel: "web",
    sender: auth.email,
  });
}

async function createTicket(input: {
  requesterUserId: string | null;
  requesterEmail: string;
  requesterName: string;
  organizationName: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  source: "email" | "internal";
  channel: "email" | "web";
  sender: string;
  inboundMessageIdHash?: string | null;
}) {
  if (
    !categories.has(input.category) ||
    !priorities.has(input.priority as UmfSupportTicketPriority)
  ) {
    throw new UmfSupportValidationError(
      "Ticket category or priority is invalid",
    );
  }
  const priority = input.priority as UmfSupportTicketPriority;
  const now = Date.now();
  const id = `umf-support-ticket-${randomUUID()}`;
  const messageId = `umf-support-message-${randomUUID()}`;
  const sla = slaByPriority[priority];
  const ticket = {
    id,
    publicId: publicTicketId(),
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail,
    requesterName: input.requesterName,
    organizationName: input.organizationName,
    assigneeUserId: null,
    subject: input.subject,
    category: input.category as
      "account" | "billing" | "privacy" | "technical" | "security" | "general",
    priority,
    status: "open" as const,
    source: input.source,
    firstResponseDueAt: now + sla.firstResponseMs,
    resolutionDueAt: now + sla.resolutionMs,
    firstRespondedAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction().execute(async (transaction) => {
    await transaction.insertInto("umfSupportTickets").values(ticket).execute();
    await transaction
      .insertInto("umfSupportMessages")
      .values({
        id: messageId,
        ticketId: id,
        authorUserId: input.requesterUserId,
        direction: "inbound",
        channel: input.channel,
        sender: input.sender,
        recipient:
          process.env.UMF_SUPPORT_EMAIL_ADDRESS?.trim() ?? "UMF Support",
        body: protectMessage(input.message, messageId),
        deliveryId: null,
        inboundMessageIdHash: input.inboundMessageIdHash ?? null,
        createdAt: now,
      })
      .execute();
  });
  return ticket;
}

export async function replyToUmfSupportTicket(
  auth: AuthenticatedUser,
  ticketId: string,
  input: Record<string, unknown>,
) {
  await requireStaff(auth);
  const ticket = await ticketById(ticketId);
  if (ticket.status === "closed") {
    throw new UmfSupportValidationError(
      "Closed tickets cannot receive messages",
    );
  }
  const body = requiredText(input.body, "body", 20_000);
  const internal = input.internal === true;
  const sendEmail = input.sendEmail !== false && !internal;
  let deliveryId: string | null = null;
  if (sendEmail) {
    let replyTo: string | undefined;
    const configuration = resolveUmfSupportEmailConfiguration();
    if (configuration) {
      replyTo = buildUmfSupportReplyAddress(
        ticket.publicId,
        ticket.requesterEmail,
        configuration,
      );
    }
    deliveryId = await queueUmfSupportReplyEmail({
      email: ticket.requesterEmail,
      locale: "es",
      ticketPublicId: ticket.publicId,
      subject: ticket.subject,
      message: body,
      replyTo,
    });
  }
  const now = Date.now();
  const messageId = `umf-support-message-${randomUUID()}`;
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("umfSupportMessages")
      .values({
        id: messageId,
        ticketId,
        authorUserId: auth.userId,
        direction: internal ? "internal" : "outbound",
        channel: sendEmail ? "email" : "web",
        sender: process.env.UMF_SUPPORT_EMAIL_ADDRESS?.trim() ?? auth.email,
        recipient: internal ? "UMF Support" : ticket.requesterEmail,
        body: protectMessage(body, messageId),
        deliveryId,
        inboundMessageIdHash: null,
        createdAt: now,
      })
      .execute();
    await transaction
      .updateTable("umfSupportTickets")
      .set({
        status: internal ? ticket.status : "waiting_on_requester",
        firstRespondedAt: internal
          ? ticket.firstRespondedAt
          : (ticket.firstRespondedAt ?? now),
        updatedAt: now,
      })
      .where("id", "=", ticketId)
      .execute();
  });
  if (deliveryId) void deliverQueuedEmail(deliveryId).catch(() => undefined);
  return getUmfSupportTicket(auth, ticketId);
}

export async function updateUmfSupportTicket(
  auth: AuthenticatedUser,
  ticketId: string,
  input: Record<string, unknown>,
) {
  await requireStaff(auth);
  const ticket = await ticketById(ticketId);
  const status = (input.status ?? ticket.status) as UmfSupportTicketStatus;
  const priority = (input.priority ??
    ticket.priority) as UmfSupportTicketPriority;
  const category =
    typeof input.category === "string" ? input.category : ticket.category;
  if (
    !statuses.has(status) ||
    !priorities.has(priority) ||
    !categories.has(category)
  ) {
    throw new UmfSupportValidationError(
      "Ticket status, priority or category is invalid",
    );
  }
  const assigneeUserId =
    input.assigneeUserId === null
      ? null
      : typeof input.assigneeUserId === "string"
        ? input.assigneeUserId
        : ticket.assigneeUserId;
  if (assigneeUserId && !(await getUmfSupportRole(assigneeUserId))) {
    throw new UmfSupportValidationError(
      "Assignee is not active UMF Support staff",
    );
  }
  const now = Date.now();
  const sla = slaByPriority[priority];
  await db
    .updateTable("umfSupportTickets")
    .set({
      status,
      priority,
      category: category as typeof ticket.category,
      assigneeUserId,
      firstResponseDueAt:
        priority === ticket.priority
          ? ticket.firstResponseDueAt
          : now + sla.firstResponseMs,
      resolutionDueAt:
        priority === ticket.priority
          ? ticket.resolutionDueAt
          : now + sla.resolutionMs,
      resolvedAt:
        status === "resolved"
          ? (ticket.resolvedAt ?? now)
          : status === "closed"
            ? ticket.resolvedAt
            : null,
      closedAt: status === "closed" ? (ticket.closedAt ?? now) : null,
      updatedAt: now,
    })
    .where("id", "=", ticketId)
    .execute();
  return getUmfSupportTicket(auth, ticketId);
}

export async function listUmfSupportMailbox(
  auth: AuthenticatedUser,
  direction: "inbound" | "outbound",
) {
  await requireStaff(auth);
  const rows = await db
    .selectFrom("umfSupportMessages")
    .innerJoin(
      "umfSupportTickets",
      "umfSupportTickets.id",
      "umfSupportMessages.ticketId",
    )
    .leftJoin(
      "emailDeliveries",
      "emailDeliveries.id",
      "umfSupportMessages.deliveryId",
    )
    .select([
      "umfSupportMessages.id",
      "umfSupportMessages.ticketId",
      "umfSupportMessages.sender",
      "umfSupportMessages.recipient",
      "umfSupportMessages.body",
      "umfSupportMessages.channel",
      "umfSupportMessages.createdAt",
      "umfSupportTickets.publicId",
      "umfSupportTickets.subject",
      "emailDeliveries.status as deliveryStatus",
    ])
    .where("umfSupportMessages.direction", "=", direction)
    .orderBy("umfSupportMessages.createdAt", "desc")
    .limit(250)
    .execute();
  await recordSecurityEvent("private_content_accessed", auth.userId, {
    domain: "umf_support",
    mailbox: direction,
    itemCount: rows.length,
  });
  return rows.map((row) => ({ ...row, body: revealMessage(row.body, row.id) }));
}

export async function ingestUmfSupportInboundEmail(
  payload: SupportInboundEmailPayload,
  configuration: UmfSupportEmailConfiguration,
) {
  const recipient = parseUmfSupportEmailRecipient(
    payload.envelopeTo,
    configuration,
  );
  if (!recipient || payload.attachmentCount !== 0) {
    throw new UmfSupportValidationError(
      "Inbound UMF Support recipient is invalid",
    );
  }
  const messageIdHash = createHash("sha256")
    .update(payload.messageId)
    .digest("hex");
  const duplicate = await db
    .selectFrom("umfSupportMessages")
    .select("ticketId")
    .where("inboundMessageIdHash", "=", messageIdHash)
    .executeTakeFirst();
  if (duplicate) {
    const ticket = await ticketById(duplicate.ticketId);
    return { duplicate: true, ticketPublicId: ticket.publicId };
  }
  if (recipient.kind === "new_ticket") {
    const ticket = await createTicket({
      requesterUserId: null,
      requesterEmail: normalizedEmail(payload.from),
      requesterName: payload.from,
      organizationName: "",
      subject: payload.subject || "Solicitud recibida por correo",
      message: payload.text,
      category: categoryForInboundSubject(payload.subject),
      priority: "normal",
      source: "email",
      channel: "email",
      sender: payload.from,
      inboundMessageIdHash: messageIdHash,
    });
    return { duplicate: false, ticketPublicId: ticket.publicId };
  }
  const ticket = await db
    .selectFrom("umfSupportTickets")
    .selectAll()
    .where("publicId", "=", recipient.publicId)
    .executeTakeFirst();
  if (
    !ticket ||
    ticket.requesterEmail.toLowerCase() !== payload.from.toLowerCase() ||
    !verifyUmfSupportReplyToken(recipient, ticket.requesterEmail, configuration)
  ) {
    throw new UmfSupportAccessError(
      "Inbound UMF Support reply is not authorized",
    );
  }
  const body = extractUnquotedSupportReply(payload.text);
  if (!body) throw new UmfSupportValidationError("Inbound reply is empty");
  const now = Date.now();
  const id = `umf-support-message-${randomUUID()}`;
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("umfSupportMessages")
      .values({
        id,
        ticketId: ticket.id,
        authorUserId: ticket.requesterUserId,
        direction: "inbound",
        channel: "email",
        sender: payload.from,
        recipient: payload.envelopeTo,
        body: protectMessage(body, id),
        deliveryId: null,
        inboundMessageIdHash: messageIdHash,
        createdAt: now,
      })
      .execute();
    await transaction
      .updateTable("umfSupportTickets")
      .set({ status: "open", updatedAt: now })
      .where("id", "=", ticket.id)
      .execute();
  });
  return { duplicate: false, ticketPublicId: ticket.publicId };
}

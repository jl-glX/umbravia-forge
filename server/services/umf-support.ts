import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  queueEmailVerificationCode,
  queueUmfSupportComposedEmail,
  queueUmfSupportReplyEmail,
} from "./email-delivery.js";
import {
  isStrongPassword,
  signupCorporateSupportAccount,
  type AuthResult,
} from "./auth.js";
import { isPasswordWithinHashLimit } from "../lib/password-policy.js";
import { getUmfSupportMailReadiness } from "./umf-support-mail-readiness.js";
import { recordSecurityEvent } from "./security-events.js";
import {
  createEmailVerificationChallenge,
  discardPendingSignup,
  getPendingEmailVerificationProfile,
  verifyEmailCode,
} from "./email-verification.js";
import { ensureConfiguredCompanyHead } from "./company-head-designation.js";
import { commercialTrialProvisioningIsEnabled } from "../lib/commercial-trial.js";

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

async function requirePlatformHeadDirector(
  auth: AuthenticatedUser,
): Promise<void> {
  await requireDirector(auth);
  const companyHead = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("position", "=", "platform_head")
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!companyHead) {
    throw new UmfSupportAccessError("Platform head access is required");
  }
}

export async function getUmfSupportCapabilities(auth: AuthenticatedUser) {
  const role = await requireStaff(auth);
  const staff = await db
    .selectFrom("umfSupportStaff")
    .select("workspaceName")
    .where("userId", "=", auth.userId)
    .where("status", "=", "active")
    .executeTakeFirstOrThrow();
  const companyHead = await db
    .selectFrom("companyStaffProfiles")
    .select("userId")
    .where("userId", "=", auth.userId)
    .where("position", "=", "platform_head")
    .where("status", "=", "active")
    .executeTakeFirst();
  const email = await getUmfSupportMailReadiness();
  return {
    role,
    workspaceName: staff.workspaceName,
    canManageAdministrators: role === "director",
    canManageCollaborationSpaces: role === "director",
    isPlatformHead: Boolean(companyHead),
    canManageCommercialTrials: role === "director" && Boolean(companyHead),
    commercialTrialProvisioningEnabled: commercialTrialProvisioningIsEnabled(),
    email,
    deliveryOperationallyVerified:
      email.outboundOperationallyVerified && email.inboundOperationallyVerified,
  };
}

export async function updateUmfSupportWorkspaceName(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  await requireStaff(auth);
  const workspaceName = requiredText(input.workspaceName, "workspaceName", 80);
  const result = await db
    .updateTable("umfSupportStaff")
    .set({ workspaceName, updatedAt: Date.now() })
    .where("userId", "=", auth.userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new UmfSupportNotFoundError("UMF Support workspace not found");
  }
  return { workspaceName };
}

export async function listCommercialTrialAdministratorAccounts(
  auth: AuthenticatedUser,
) {
  await requirePlatformHeadDirector(auth);
  const accounts = await db
    .selectFrom("users")
    .select([
      "id as userId",
      "name",
      "lastName",
      "email",
      "accountStatus",
      "emailVerifiedAt",
      "createdAt",
    ])
    .where("identityRealm", "=", "commercial")
    .where("role", "=", "admin")
    .orderBy("createdAt", "desc")
    .execute();

  return Promise.all(
    accounts.map(async (account) => {
      const [pending, trial] = await Promise.all([
        db
          .selectFrom("administratorSignupProvisioning")
          .select(["facilityName", "facilityType"])
          .where("userId", "=", account.userId)
          .executeTakeFirst(),
        db
          .selectFrom("commercialTrials")
          .select([
            "id",
            "facilityName",
            "facilityType",
            "status",
            "realDataDeclaration",
            "startedAt",
            "expiresAt",
          ])
          .where("ownerUserId", "=", account.userId)
          .orderBy("createdAt", "desc")
          .executeTakeFirst(),
      ]);
      const emailSegments = account.email.split("@");
      const domain =
        emailSegments[emailSegments.length - 1]?.toLowerCase() ?? "";
      const syntheticDomain =
        domain === "localhost" ||
        domain.endsWith(".local") ||
        domain.endsWith(".test") ||
        domain.endsWith(".example") ||
        domain.endsWith(".invalid") ||
        domain === "example.com" ||
        domain === "example.org" ||
        domain === "example.net";
      return {
        ...account,
        emailAssessment: syntheticDomain
          ? ("fictitious" as const)
          : account.emailVerifiedAt !== null
            ? ("real" as const)
            : ("indeterminate" as const),
        pendingProvisioning: pending ?? null,
        trial: trial ?? null,
      };
    }),
  );
}

export async function getCommercialAccountMetrics(auth: AuthenticatedUser) {
  await requirePlatformHeadDirector(auth);
  const [
    activeAccounts,
    pendingAccounts,
    activeTrials,
    currentAbandoned,
    facts,
  ] = await Promise.all([
    db
      .selectFrom("users")
      .innerJoin(
        "facilityMemberships",
        "facilityMemberships.userId",
        "users.id",
      )
      .select("users.id")
      .distinct()
      .where("users.identityRealm", "=", "commercial")
      .where("users.accountStatus", "=", "active")
      .where("facilityMemberships.status", "=", "active")
      .where("facilityMemberships.role", "in", ["owner", "admin"])
      .execute(),
    db
      .selectFrom("administratorSignupProvisioning")
      .innerJoin("users", "users.id", "administratorSignupProvisioning.userId")
      .select("users.id")
      .where("users.accountStatus", "=", "pending_verification")
      .execute(),
    db
      .selectFrom("commercialTrials")
      .select("id")
      .where("status", "in", [
        "trial_active",
        "trial_paused_support",
        "trial_conversion_review",
      ])
      .execute(),
    db
      .selectFrom("commercialTrials")
      .select("id")
      .where("status", "in", ["trial_expired", "trial_closed"])
      .where("realDataDeclaration", "in", ["undeclared", "no"])
      .execute(),
    db
      .selectFrom("commercialLifecycleFacts")
      .select(["kind", "subjectId", "occurredAt"])
      .execute(),
  ]);

  const deletedAccounts = facts.filter(
    (fact) => fact.kind === "commercial_account_deleted",
  );
  const deletedAbandonedTrials = facts.filter(
    (fact) => fact.kind === "commercial_trial_abandoned",
  );
  return {
    measuredAt: Date.now(),
    activeAdministratorAccounts: activeAccounts.length,
    pendingVerificationAccounts: pendingAccounts.length,
    activeTrials: activeTrials.length,
    abandonedTrials: currentAbandoned.length + deletedAbandonedTrials.length,
    deletedAdministratorAccounts: deletedAccounts.length,
    historicalCoverage: "from_schema_v52" as const,
    firstRetainedFactAt:
      facts.length > 0
        ? Math.min(...facts.map((fact) => fact.occurredAt))
        : null,
  };
}

export async function resendCommercialTrialAdministratorVerification(
  auth: AuthenticatedUser,
  userId: string,
) {
  await requirePlatformHeadDirector(auth);
  const candidate = await db
    .selectFrom("users")
    .innerJoin(
      "administratorSignupProvisioning",
      "administratorSignupProvisioning.userId",
      "users.id",
    )
    .select([
      "users.id",
      "users.identityRealm",
      "users.role",
      "users.accountStatus",
      "users.emailVerifiedAt",
    ])
    .where("users.id", "=", userId)
    .executeTakeFirst();
  if (
    !candidate ||
    candidate.identityRealm !== "commercial" ||
    candidate.role !== "admin" ||
    candidate.accountStatus !== "pending_verification" ||
    candidate.emailVerifiedAt !== null
  ) {
    throw new UmfSupportValidationError(
      "A pending commercial trial administrator is required",
      "COMMERCIAL_TRIAL_ADMIN_NOT_PENDING",
    );
  }
  const profile = await getPendingEmailVerificationProfile(userId);
  if (!profile) {
    throw new UmfSupportValidationError(
      "A pending commercial trial administrator is required",
      "COMMERCIAL_TRIAL_ADMIN_NOT_PENDING",
    );
  }
  const challenge = await createEmailVerificationChallenge(userId);
  const deliveryId = await queueEmailVerificationCode({
    userId,
    platformScope: "commercial",
    ...profile,
    code: challenge.code,
    expiresAt: challenge.expiresAt,
  });
  const sent = await deliverQueuedEmail(deliveryId).catch(() => false);
  await recordSecurityEvent(
    "commercial_trial_administrator_verification_resent",
    auth.userId,
    { subjectUserId: userId, deliveryQueued: true, sent },
  );
  return { sent, queued: !sent };
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

export async function registerUmfSupportAccount(
  input: Record<string, unknown>,
  metadata: { userAgent?: string },
): Promise<
  AuthResult & {
    verificationEmailSent: boolean;
    demoVerificationCode?: string;
  }
> {
  const email = normalizedEmail(input.email);
  const password = requiredPassword(input.password);
  if (!isStrongPassword(password)) {
    throw new UmfSupportValidationError(
      "Password does not meet the security requirements",
      "UMF_SUPPORT_PASSWORD_POLICY",
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
  const locale = requiredText(input.locale ?? "es", "locale", 5) as
    "es" | "en" | "de" | "de-CH";
  if (!new Set(["es", "en", "de", "de-CH"]).has(locale)) {
    throw new UmfSupportValidationError("locale is invalid");
  }
  const name = requiredText(input.name, "name", 100);
  const lastName = requiredText(input.lastName, "lastName", 100);
  let result: AuthResult;
  try {
    result = await signupCorporateSupportAccount(
      email,
      name,
      password,
      metadata,
      {
        lastName,
        countryCode,
        locale,
        acceptedTerms: input.acceptedTerms === true,
        acceptedPrivacy: input.acceptedPrivacy === true,
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Unable to create account with these credentials"
    ) {
      throw new UmfSupportValidationError(
        "A corporate account already exists for this email",
        "UMF_SUPPORT_ACCOUNT_EXISTS",
      );
    }
    throw error;
  }
  try {
    const challenge = await createEmailVerificationChallenge(result.user.id);
    const deliveryId = await queueEmailVerificationCode({
      userId: result.user.id,
      platformScope: "support",
      email,
      name,
      code: challenge.code,
      locale,
      expiresAt: challenge.expiresAt,
    });
    const verificationEmailSent = await deliverQueuedEmail(deliveryId).catch(
      () => false,
    );
    await recordSecurityEvent("umf_support_access_requested", result.user.id, {
      mode: "verified_email_self_registration",
      verificationEmailSent,
    });
    return {
      ...result,
      verificationEmailSent,
      demoVerificationCode:
        process.env.NODE_ENV === "test" ? challenge.code : undefined,
    };
  } catch (error) {
    await discardPendingSignup(result.user.id).catch(() => undefined);
    throw error;
  }
}

export async function verifyUmfSupportRegistration(
  userId: string,
  code: string,
): Promise<{
  verified: true;
  access: "company_head_approved" | "awaiting_administrator_approval";
}> {
  const user = await db
    .selectFrom("users")
    .select(["accountStatus", "emailVerifiedAt", "identityRealm"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user || user.identityRealm !== "corporate_support") {
    throw new UmfSupportValidationError(
      "The corporate identity is not available",
      "UMF_SUPPORT_REGISTRATION_UNAVAILABLE",
    );
  }
  const alreadyVerified =
    user.accountStatus === "active" && user.emailVerifiedAt !== null;
  if (
    !alreadyVerified &&
    !(await verifyEmailCode(userId, code, "corporate_support"))
  ) {
    throw new UmfSupportValidationError(
      "Email verification code is invalid or expired",
      "UMF_SUPPORT_EMAIL_VERIFICATION_INVALID",
    );
  }
  const bootstrap = await ensureConfiguredCompanyHead(userId);
  const access = bootstrap.isCompanyHead
    ? "company_head_approved"
    : "awaiting_administrator_approval";
  await recordSecurityEvent("umf_support_account_activated", userId, {
    mode: "verified_email_self_registration",
    access,
  });
  return { verified: true, access };
}

export async function listUmfSupportStaff(auth: AuthenticatedUser) {
  await requireStaff(auth);
  return db
    .selectFrom("umfSupportStaff")
    .innerJoin("users", "users.id", "umfSupportStaff.userId")
    .select([
      "umfSupportStaff.userId",
      "umfSupportStaff.role",
      "umfSupportStaff.workspaceName",
      "umfSupportStaff.status",
      "umfSupportStaff.createdAt",
      "users.name",
      "users.lastName",
      "users.email",
    ])
    .orderBy("users.name")
    .execute();
}

export async function listUmfSupportAdministratorAccounts(
  auth: AuthenticatedUser,
) {
  await requireDirector(auth);
  return db
    .selectFrom("users")
    .leftJoin("umfSupportStaff", "umfSupportStaff.userId", "users.id")
    .select([
      "users.id as userId",
      "users.name",
      "users.lastName",
      "users.email",
      "users.accountStatus",
      "users.emailVerifiedAt",
      "users.createdAt",
      "umfSupportStaff.role",
      "umfSupportStaff.status as staffStatus",
    ])
    .where("users.identityRealm", "=", "corporate_support")
    .orderBy("users.createdAt", "desc")
    .execute();
}

export async function approveUmfSupportAdministrator(
  auth: AuthenticatedUser,
  userId: string,
) {
  await requireDirector(auth);
  const candidate = await db
    .selectFrom("users")
    .select(["id", "accountStatus", "emailVerifiedAt", "identityRealm"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (
    !candidate ||
    candidate.identityRealm !== "corporate_support" ||
    candidate.accountStatus !== "active" ||
    candidate.emailVerifiedAt === null
  ) {
    throw new UmfSupportValidationError(
      "A verified corporate support account is required",
      "UMF_SUPPORT_ACCOUNT_NOT_VERIFIED",
    );
  }
  const now = Date.now();
  await db
    .insertInto("umfSupportStaff")
    .values({
      userId,
      role: "agent",
      status: "active",
      approvedByUserId: auth.userId,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        role: "agent",
        status: "active",
        approvedByUserId: auth.userId,
        updatedAt: now,
        revokedAt: null,
      }),
    )
    .execute();
  await recordSecurityEvent("umf_support_administrator_approved", auth.userId, {
    subjectUserId: userId,
    role: "agent",
    status: "active",
    mode: "human_administrator_approval",
  });
}

export async function listUmfSupportCollaborationSpaces(
  auth: AuthenticatedUser,
) {
  const role = await requireStaff(auth);
  let query = db
    .selectFrom("umfSupportCollaborationSpaces")
    .selectAll()
    .orderBy("updatedAt", "desc");
  if (role !== "director") {
    query = query
      .where("status", "=", "published")
      .where("visibility", "=", "staff");
  }
  return query.execute();
}

export async function createUmfSupportCollaborationSpace(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  await requireDirector(auth);
  const now = Date.now();
  const space = {
    id: `umf-collaboration-${randomBytes(12).toString("hex")}`,
    name: requiredText(input.name, "name", 100),
    description: requiredText(input.description, "description", 500),
    visibility: "hidden" as const,
    status: "draft" as const,
    createdByUserId: auth.userId,
    createdAt: now,
    updatedAt: now,
  };
  await db.insertInto("umfSupportCollaborationSpaces").values(space).execute();
  await recordSecurityEvent(
    "umf_support_collaboration_space_changed",
    auth.userId,
    {
      collaborationSpaceId: space.id,
      action: "created_as_hidden_draft",
    },
  );
  return space;
}

export async function updateUmfSupportCollaborationSpace(
  auth: AuthenticatedUser,
  spaceId: string,
  input: Record<string, unknown>,
) {
  await requireDirector(auth);
  const visibility = requiredText(input.visibility, "visibility", 16);
  const status = requiredText(input.status, "status", 16);
  if (!new Set(["hidden", "staff"]).has(visibility)) {
    throw new UmfSupportValidationError("Collaboration visibility is invalid");
  }
  if (!new Set(["draft", "published"]).has(status)) {
    throw new UmfSupportValidationError("Collaboration status is invalid");
  }
  const result = await db
    .updateTable("umfSupportCollaborationSpaces")
    .set({
      visibility: visibility as "hidden" | "staff",
      status: status as "draft" | "published",
      updatedAt: Date.now(),
    })
    .where("id", "=", spaceId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new UmfSupportNotFoundError("Collaboration space not found");
  }
  await recordSecurityEvent(
    "umf_support_collaboration_space_changed",
    auth.userId,
    {
      collaborationSpaceId: spaceId,
      action: "visibility_changed",
      visibility,
      status,
    },
  );
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

type UmfSupportMailDraftContent = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

function recipientList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 25) {
    throw new UmfSupportValidationError(`${name} recipients are invalid`);
  }
  return value.map((entry) => normalizedEmail(entry));
}

function mailDraftContent(input: unknown): UmfSupportMailDraftContent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UmfSupportValidationError("Mail draft content is invalid");
  }
  const candidate = input as Record<string, unknown>;
  const to = recipientList(candidate.to, "To");
  const cc = recipientList(candidate.cc, "CC");
  const bcc = recipientList(candidate.bcc, "BCC");
  const recipients = [...to, ...cc, ...bcc];
  if (recipients.length > 25) {
    throw new UmfSupportValidationError("Too many mail recipients");
  }
  const unique = new Set(recipients);
  if (unique.size !== recipients.length) {
    throw new UmfSupportValidationError(
      "A recipient may only appear once across To, CC and BCC",
    );
  }
  return {
    to,
    cc,
    bcc,
    subject: requiredText(candidate.subject, "subject", 200),
    body: requiredText(candidate.body, "message", 20_000),
  };
}

function revealMailDraftContent(
  value: string,
  draftId: string,
): UmfSupportMailDraftContent {
  try {
    return mailDraftContent(JSON.parse(revealMessage(value, draftId)));
  } catch (error) {
    if (error instanceof UmfSupportValidationError) throw error;
    throw new UmfSupportValidationError("Mail draft content is unavailable");
  }
}

function parseDeliveryIds(value: string): string[] {
  try {
    const ids = JSON.parse(value) as unknown;
    return Array.isArray(ids) && ids.every((id) => typeof id === "string")
      ? ids
      : [];
  } catch {
    return [];
  }
}

function derivedMailStatus(
  storedStatus: "draft" | "scheduled" | "queued" | "cancelled",
  deliveryStatuses: string[],
):
  | "draft"
  | "scheduled"
  | "outbox"
  | "sent"
  | "partially_failed"
  | "failed"
  | "cancelled" {
  if (storedStatus === "draft" || storedStatus === "cancelled") {
    return storedStatus;
  }
  if (deliveryStatuses.length === 0) return "failed";
  if (deliveryStatuses.every((status) => status === "sent")) return "sent";
  const failed = deliveryStatuses.filter((status) => status === "failed");
  if (failed.length === deliveryStatuses.length) return "failed";
  if (failed.length > 0) return "partially_failed";
  if (storedStatus === "scheduled") return "scheduled";
  return "outbox";
}

export async function listUmfSupportMailDrafts(auth: AuthenticatedUser) {
  await requireStaff(auth);
  const drafts = await db
    .selectFrom("umfSupportMailDrafts")
    .leftJoin("users", "users.id", "umfSupportMailDrafts.authorUserId")
    .selectAll("umfSupportMailDrafts")
    .select("users.name as authorName")
    .orderBy("umfSupportMailDrafts.updatedAt", "desc")
    .limit(250)
    .execute();
  const deliveryIds = drafts.flatMap((draft) =>
    parseDeliveryIds(draft.deliveryIds),
  );
  const attachmentRows =
    drafts.length === 0
      ? []
      : await db
          .selectFrom("umfSupportMailAttachments")
          .select([
            "id",
            "draftId",
            "uploadedByUserId",
            "fileName",
            "mimeType",
            "sizeBytes",
            "createdAt",
          ])
          .where(
            "draftId",
            "in",
            drafts.map((draft) => draft.id),
          )
          .orderBy("createdAt", "asc")
          .execute();
  const attachmentsByDraft = new Map<string, typeof attachmentRows>();
  for (const attachment of attachmentRows) {
    const current = attachmentsByDraft.get(attachment.draftId) ?? [];
    current.push(attachment);
    attachmentsByDraft.set(attachment.draftId, current);
  }
  const deliveries =
    deliveryIds.length === 0
      ? []
      : await db
          .selectFrom("emailDeliveries")
          .select(["id", "status", "lastError", "sentAt"])
          .where("platformScope", "=", "support")
          .where("id", "in", deliveryIds)
          .execute();
  const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  await recordSecurityEvent("private_content_accessed", auth.userId, {
    domain: "umf_support",
    mailbox: "drafts",
    itemCount: drafts.length,
  });
  return drafts.map((draft) => {
    const content = revealMailDraftContent(draft.content, draft.id);
    const draftDeliveries = parseDeliveryIds(draft.deliveryIds)
      .map((id) => byId.get(id))
      .filter((delivery) => delivery !== undefined);
    return {
      id: draft.id,
      authorUserId: draft.authorUserId,
      authorName: draft.authorName,
      ...content,
      status: derivedMailStatus(
        draft.status,
        draftDeliveries.map((delivery) => delivery.status),
      ),
      scheduledAt: draft.scheduledAt,
      sentAt:
        draftDeliveries.length > 0 &&
        draftDeliveries.every((delivery) => delivery.sentAt !== null)
          ? Math.max(...draftDeliveries.map((delivery) => delivery.sentAt ?? 0))
          : null,
      deliveryIssueCount: draftDeliveries.filter(
        (delivery) => delivery.lastError !== null,
      ).length,
      attachments: attachmentsByDraft.get(draft.id) ?? [],
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  });
}

export async function saveUmfSupportMailDraft(
  auth: AuthenticatedUser,
  input: unknown,
  draftId?: string,
) {
  await requireStaff(auth);
  const content = mailDraftContent(input);
  const now = Date.now();
  const id = draftId ?? `umf-support-mail-${randomUUID()}`;
  if (draftId) {
    const existing = await db
      .selectFrom("umfSupportMailDrafts")
      .select("status")
      .where("id", "=", draftId)
      .executeTakeFirst();
    if (!existing) throw new UmfSupportNotFoundError("Mail draft not found");
    if (existing.status !== "draft") {
      throw new UmfSupportValidationError("Only unsent drafts can be edited");
    }
    await db
      .updateTable("umfSupportMailDrafts")
      .set({
        content: protectMessage(JSON.stringify(content), id),
        updatedAt: now,
      })
      .where("id", "=", id)
      .where("status", "=", "draft")
      .execute();
  } else {
    await db
      .insertInto("umfSupportMailDrafts")
      .values({
        id,
        authorUserId: auth.userId,
        content: protectMessage(JSON.stringify(content), id),
        status: "draft",
        deliveryIds: "[]",
        scheduledAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }
  return { id };
}

export async function sendUmfSupportMailDraft(
  auth: AuthenticatedUser,
  draftId: string,
  scheduledAt?: number,
) {
  await requireStaff(auth);
  const draft = await db
    .selectFrom("umfSupportMailDrafts")
    .selectAll()
    .where("id", "=", draftId)
    .executeTakeFirst();
  if (!draft) throw new UmfSupportNotFoundError("Mail draft not found");
  if (draft.status !== "draft") {
    throw new UmfSupportValidationError("Mail draft was already submitted");
  }
  const now = Date.now();
  const dispatchAt = scheduledAt ?? now;
  if (
    !Number.isSafeInteger(dispatchAt) ||
    dispatchAt < now ||
    dispatchAt > now + 90 * 24 * 60 * 60 * 1000
  ) {
    throw new UmfSupportValidationError(
      "Scheduled delivery must be within the next 90 days",
    );
  }
  const content = revealMailDraftContent(draft.content, draft.id);
  const attachments = await db
    .selectFrom("umfSupportMailAttachments")
    .select("id")
    .where("draftId", "=", draft.id)
    .orderBy("createdAt", "asc")
    .execute();
  const recipients = [...content.to, ...content.cc, ...content.bcc];
  if (recipients.length === 0) {
    throw new UmfSupportValidationError("At least one recipient is required");
  }
  const user = await db
    .selectFrom("users")
    .select("locale")
    .where("id", "=", auth.userId)
    .where("identityRealm", "=", "corporate_support")
    .executeTakeFirst();
  const locale = ["es", "en", "de", "de-CH"].includes(user?.locale ?? "")
    ? (user!.locale as "es" | "en" | "de" | "de-CH")
    : "es";
  const deliveryIds: string[] = [];
  try {
    for (const email of recipients) {
      deliveryIds.push(
        await queueUmfSupportComposedEmail({
          email,
          locale,
          subject: content.subject,
          message: content.body,
          scheduledAt: dispatchAt,
          attachmentIds: attachments.map((attachment) => attachment.id),
        }),
      );
    }
  } catch (error) {
    if (deliveryIds.length > 0) {
      await db
        .updateTable("emailDeliveries")
        .set({
          status: "superseded",
          recipient: "",
          payloadEncrypted: "",
          updatedAt: Date.now(),
        })
        .where("platformScope", "=", "support")
        .where("id", "in", deliveryIds)
        .where("status", "in", ["queued", "retry"])
        .execute();
    }
    throw error;
  }
  const changed = await db
    .updateTable("umfSupportMailDrafts")
    .set({
      status: dispatchAt > now ? "scheduled" : "queued",
      deliveryIds: JSON.stringify(deliveryIds),
      scheduledAt: dispatchAt > now ? dispatchAt : null,
      updatedAt: Date.now(),
    })
    .where("id", "=", draftId)
    .where("status", "=", "draft")
    .executeTakeFirst();
  if (Number(changed.numUpdatedRows) !== 1) {
    await db
      .updateTable("emailDeliveries")
      .set({
        status: "superseded",
        recipient: "",
        payloadEncrypted: "",
        updatedAt: Date.now(),
      })
      .where("platformScope", "=", "support")
      .where("id", "in", deliveryIds)
      .where("status", "in", ["queued", "retry"])
      .execute();
    throw new UmfSupportValidationError("Mail draft changed before sending");
  }
  return { queued: true, scheduledAt: dispatchAt > now ? dispatchAt : null };
}

export async function cancelUmfSupportScheduledMail(
  auth: AuthenticatedUser,
  draftId: string,
) {
  await requireStaff(auth);
  const draft = await db
    .selectFrom("umfSupportMailDrafts")
    .select(["status", "deliveryIds"])
    .where("id", "=", draftId)
    .executeTakeFirst();
  if (!draft) throw new UmfSupportNotFoundError("Scheduled mail not found");
  if (draft.status !== "scheduled") {
    throw new UmfSupportValidationError("Only scheduled mail can be cancelled");
  }
  const deliveryIds = parseDeliveryIds(draft.deliveryIds);
  if (deliveryIds.length === 0) {
    throw new UmfSupportValidationError(
      "Scheduled mail has no cancellable deliveries",
    );
  }
  const now = Date.now();
  const deliveries = await db
    .selectFrom("emailDeliveries")
    .select(["id", "status", "nextAttemptAt"])
    .where("platformScope", "=", "support")
    .where("id", "in", deliveryIds)
    .execute();
  if (
    deliveries.length !== deliveryIds.length ||
    deliveries.some(
      (delivery) =>
        !["queued", "retry"].includes(delivery.status) ||
        delivery.nextAttemptAt <= now,
    )
  ) {
    throw new UmfSupportValidationError(
      "Scheduled mail delivery already started and cannot be cancelled",
    );
  }
  await db.transaction().execute(async (transaction) => {
    const cancelledDeliveries = await transaction
      .updateTable("emailDeliveries")
      .set({
        status: "superseded",
        recipient: "",
        payloadEncrypted: "",
        updatedAt: now,
      })
      .where("platformScope", "=", "support")
      .where("id", "in", deliveryIds)
      .where("status", "in", ["queued", "retry"])
      .where("nextAttemptAt", ">", now)
      .executeTakeFirst();
    if (Number(cancelledDeliveries.numUpdatedRows) !== deliveryIds.length) {
      throw new UmfSupportValidationError(
        "Scheduled mail changed before cancellation",
      );
    }
    const cancelledDraft = await transaction
      .updateTable("umfSupportMailDrafts")
      .set({ status: "cancelled", updatedAt: now })
      .where("id", "=", draftId)
      .where("status", "=", "scheduled")
      .executeTakeFirst();
    if (Number(cancelledDraft.numUpdatedRows) !== 1) {
      throw new UmfSupportValidationError(
        "Scheduled mail changed before cancellation",
      );
    }
  });
  return { cancelled: true };
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

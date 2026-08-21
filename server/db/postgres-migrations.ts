import type { Pool, PoolClient } from "pg";

type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const postgresInitialSchema = String.raw`
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "phone" TEXT UNIQUE,
  "name" TEXT NOT NULL,
  "lastName" TEXT NOT NULL DEFAULT '',
  "countryCode" TEXT NOT NULL DEFAULT 'ES',
  "locale" TEXT NOT NULL DEFAULT 'es',
  "accountStatus" TEXT NOT NULL DEFAULT 'active' CHECK ("accountStatus" IN ('pending_verification', 'active', 'security_review')),
  "emailVerifiedAt" BIGINT,
  "termsVersion" TEXT NOT NULL DEFAULT 'draft-v1',
  "termsAcceptedAt" BIGINT,
  "privacyVersion" TEXT NOT NULL DEFAULT 'draft-v1',
  "privacyAcceptedAt" BIGINT,
  "avatarDataUrl" TEXT NOT NULL DEFAULT '',
  "password" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('member', 'trainer', 'admin')),
  "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 10080,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users" ("role");

CREATE TABLE IF NOT EXISTS "accountSupportIdentifiers" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "publicId" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "rotationReason" TEXT CHECK ("rotationReason" IS NULL OR "rotationReason" IN ('account_recovery', 'security_incident', 'administrative_correction')),
  "createdAt" BIGINT NOT NULL,
  "revokedAt" BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_supportIdentifiers_active_user" ON "accountSupportIdentifiers" ("userId") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_supportIdentifiers_publicId" ON "accountSupportIdentifiers" ("publicId");
CREATE INDEX IF NOT EXISTS "idx_supportIdentifiers_userId" ON "accountSupportIdentifiers" ("userId");

CREATE TABLE IF NOT EXISTS "emailVerificationChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_emailVerificationChallenges_userId" ON "emailVerificationChallenges" ("userId");
CREATE INDEX IF NOT EXISTS "idx_emailVerificationChallenges_expiresAt" ON "emailVerificationChallenges" ("expiresAt");

CREATE TABLE IF NOT EXISTS "accountRecoveryChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_accountRecoveryChallenges_userId" ON "accountRecoveryChallenges" ("userId");
CREATE INDEX IF NOT EXISTS "idx_accountRecoveryChallenges_expiresAt" ON "accountRecoveryChallenges" ("expiresAt");

CREATE TABLE IF NOT EXISTS "emailDeliveries" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('email_verification', 'account_recovery', 'support_update', 'security_notice')),
  "recipient" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "payloadEncrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued', 'processing', 'retry', 'sent', 'failed', 'superseded')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" BIGINT NOT NULL,
  "messageId" TEXT,
  "lastError" TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "sentAt" BIGINT,
  "expiresAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_due" ON "emailDeliveries" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_user" ON "emailDeliveries" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_expiry" ON "emailDeliveries" ("expiresAt");

CREATE TABLE IF NOT EXISTS "antiAutomationChallenges" (
  "id" TEXT PRIMARY KEY,
  "action" TEXT NOT NULL CHECK ("action" IN ('login', 'signup', 'recovery', 'form_access', 'feedback')),
  "nonce" TEXT NOT NULL,
  "difficulty" INTEGER NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "consumedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_antiAutomationChallenges_expiry" ON "antiAutomationChallenges" ("expiresAt");

CREATE TABLE IF NOT EXISTS "accountDeletionPreferences" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "inactivityMonths" INTEGER CHECK ("inactivityMonths" IS NULL OR "inactivityMonths" IN (6, 12, 18, 24, 36)),
  "lastMeaningfulActivityAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "accountDeletionRequests" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('manual', 'inactivity')),
  "status" TEXT NOT NULL CHECK ("status" IN ('scheduled', 'cancelled', 'processing', 'completed')),
  "requestedAt" BIGINT NOT NULL,
  "graceEndsAt" BIGINT NOT NULL,
  "cancelledAt" BIGINT,
  "completedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_deletionRequests_userId" ON "accountDeletionRequests" ("userId");
CREATE INDEX IF NOT EXISTS "idx_deletionRequests_status_grace" ON "accountDeletionRequests" ("status", "graceEndsAt");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_deletionRequests_scheduled_user" ON "accountDeletionRequests" ("userId") WHERE "status" = 'scheduled';

CREATE TABLE IF NOT EXISTS "accountDeletionJobs" (
  "id" TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL UNIQUE REFERENCES "accountDeletionRequests" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'planned' CHECK ("status" IN ('planned', 'blocked_retention_review', 'cancelled', 'completed')),
  "executionEnabled" SMALLINT NOT NULL DEFAULT 0 CHECK ("executionEnabled" IN (0, 1)),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "completedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_accountDeletionJobs_user_status" ON "accountDeletionJobs" ("userId", "status");

CREATE TABLE IF NOT EXISTS "accountDataDeletionDrafts" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "selectedCategories" TEXT NOT NULL DEFAULT '[]',
  "intent" TEXT NOT NULL CHECK ("intent" IN ('selected_data', 'account_closure')),
  "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "accountRepresentatives" (
  "id" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "representativeUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "scopes" TEXT NOT NULL DEFAULT '[]',
  "reason" TEXT NOT NULL CHECK ("reason" IN ('hospitalization', 'temporary_incapacity', 'permanent_incapacity', 'death_contingency', 'other')),
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'pending_review', 'approved', 'revoked', 'expired')),
  "startsAt" BIGINT NOT NULL,
  "expiresAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT,
  CHECK ("ownerUserId" <> "representativeUserId")
);
CREATE INDEX IF NOT EXISTS "idx_accountRepresentatives_owner" ON "accountRepresentatives" ("ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "idx_accountRepresentatives_representative" ON "accountRepresentatives" ("representativeUserId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_accountRepresentatives_open_pair" ON "accountRepresentatives" ("ownerUserId", "representativeUserId") WHERE "status" IN ('draft', 'pending_review', 'approved');

CREATE TABLE IF NOT EXISTS "dataRetentionPolicies" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "dataCategory" TEXT NOT NULL,
  "retentionDays" INTEGER CHECK ("retentionDays" IS NULL OR "retentionDays" > 0),
  "legalBasisReference" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'active', 'retired')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_retentionPolicies_jurisdiction" ON "dataRetentionPolicies" ("jurisdiction");
CREATE INDEX IF NOT EXISTS "idx_retentionPolicies_status" ON "dataRetentionPolicies" ("status");

CREATE TABLE IF NOT EXISTS "dataRetentionRecords" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "policyId" TEXT NOT NULL REFERENCES "dataRetentionPolicies" ("id"),
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'retained' CHECK ("status" IN ('retained', 'legal_hold', 'scheduled_deletion', 'released')),
  "retainUntil" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "releasedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_retentionRecords_userId" ON "dataRetentionRecords" ("userId");
CREATE INDEX IF NOT EXISTS "idx_retentionRecords_status_until" ON "dataRetentionRecords" ("status", "retainUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_retentionRecords_source" ON "dataRetentionRecords" ("sourceType", "sourceId");

CREATE TABLE IF NOT EXISTS "gymClasses" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "trainerId" TEXT NOT NULL,
  "trainerName" TEXT NOT NULL,
  "maxCapacity" INTEGER NOT NULL,
  "scheduledAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_gymClasses_scheduledAt" ON "gymClasses" ("scheduledAt");

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" TEXT PRIMARY KEY,
  "classId" TEXT NOT NULL REFERENCES "gymClasses" ("id"),
  "userId" TEXT NOT NULL REFERENCES "users" ("id"),
  "status" TEXT NOT NULL CHECK ("status" IN ('confirmed', 'cancelled', 'waitlist')),
  "createdAt" BIGINT NOT NULL,
  "cancelledAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_bookings_classId" ON "bookings" ("classId");
CREATE INDEX IF NOT EXISTS "idx_bookings_userId" ON "bookings" ("userId");
CREATE INDEX IF NOT EXISTS "idx_bookings_status" ON "bookings" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bookings_active_user_class" ON "bookings" ("classId", "userId") WHERE "status" IN ('confirmed', 'waitlist');

CREATE TABLE IF NOT EXISTS "waitlistEntries" (
  "id" TEXT PRIMARY KEY,
  "classId" TEXT NOT NULL REFERENCES "gymClasses" ("id"),
  "userId" TEXT NOT NULL REFERENCES "users" ("id"),
  "position" INTEGER NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "promotedAt" BIGINT,
  UNIQUE ("classId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_waitlistEntries_classId" ON "waitlistEntries" ("classId");
CREATE INDEX IF NOT EXISTS "idx_waitlistEntries_userId" ON "waitlistEntries" ("userId");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "createdAt" BIGINT NOT NULL,
  "lastSeenAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "revokedAt" BIGINT,
  "userAgent" TEXT NOT NULL DEFAULT '',
  "remembered" SMALLINT NOT NULL DEFAULT 0 CHECK ("remembered" IN (0, 1)),
  "formVerifiedAt" BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_sessions_userId" ON "sessions" ("userId");
CREATE INDEX IF NOT EXISTS "idx_sessions_expiresAt" ON "sessions" ("expiresAt");

CREATE TABLE IF NOT EXISTS "mfaCredentials" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "secretEncrypted" TEXT NOT NULL,
  "recoveryCodeHashes" TEXT NOT NULL DEFAULT '[]',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "enabledAt" BIGINT
);

CREATE TABLE IF NOT EXISTS "authChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" BIGINT,
  "rememberDevice" SMALLINT NOT NULL DEFAULT 0 CHECK ("rememberDevice" IN (0, 1))
);
CREATE INDEX IF NOT EXISTS "idx_authChallenges_userId" ON "authChallenges" ("userId");
CREATE INDEX IF NOT EXISTS "idx_authChallenges_expiresAt" ON "authChallenges" ("expiresAt");

CREATE TABLE IF NOT EXISTS "passkeyCredentials" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "publicKey" TEXT NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT NOT NULL DEFAULT '[]',
  "deviceType" TEXT NOT NULL,
  "backedUp" SMALLINT NOT NULL DEFAULT 0 CHECK ("backedUp" IN (0, 1)),
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_passkeyCredentials_userId" ON "passkeyCredentials" ("userId");

CREATE TABLE IF NOT EXISTS "webauthnChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "challenge" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('registration', 'authentication')),
  "rememberDevice" SMALLINT NOT NULL DEFAULT 0 CHECK ("rememberDevice" IN (0, 1)),
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "consumedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_webauthnChallenges_userId" ON "webauthnChallenges" ("userId");
CREATE INDEX IF NOT EXISTS "idx_webauthnChallenges_expiresAt" ON "webauthnChallenges" ("expiresAt");

CREATE TABLE IF NOT EXISTS "securityEvents" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "idx_securityEvents_userId" ON "securityEvents" ("userId");
CREATE INDEX IF NOT EXISTS "idx_securityEvents_createdAt" ON "securityEvents" ("createdAt");

CREATE TABLE IF NOT EXISTS "feedback" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users" ("id") ON DELETE CASCADE,
  "category" TEXT NOT NULL CHECK ("category" IN ('suggestion', 'problem', 'accessibility', 'other')),
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new' CHECK ("status" IN ('new', 'reviewed', 'closed')),
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_feedback_userId" ON "feedback" ("userId");
CREATE INDEX IF NOT EXISTS "idx_feedback_createdAt" ON "feedback" ("createdAt");

CREATE TABLE IF NOT EXISTS "billingRecords" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "userId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL DEFAULT '',
  "concept" TEXT NOT NULL,
  "billingCycle" TEXT NOT NULL CHECK ("billingCycle" IN ('monthly', 'quarterly', 'semiannual', 'annual', 'trial_day', 'custom')),
  "customCycleLabel" TEXT NOT NULL DEFAULT '',
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" TEXT NOT NULL CHECK ("status" IN ('paid', 'unpaid', 'pending')),
  "dueAt" BIGINT,
  "paidAt" BIGINT,
  "invoiceNumber" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "archivedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_billingRecords_userId" ON "billingRecords" ("userId");
CREATE INDEX IF NOT EXISTS "idx_billingRecords_status" ON "billingRecords" ("status");
CREATE INDEX IF NOT EXISTS "idx_billingRecords_dueAt" ON "billingRecords" ("dueAt");
CREATE INDEX IF NOT EXISTS "idx_billingRecords_archivedAt" ON "billingRecords" ("archivedAt");

CREATE TABLE IF NOT EXISTS "facilityProfiles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "logoDataUrl" TEXT NOT NULL DEFAULT '',
  "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
  "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "commercialTrials" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL UNIQUE REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "ownerUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "facilityName" TEXT NOT NULL,
  "facilityType" TEXT NOT NULL CHECK ("facilityType" IN ('traditional_gym', 'crossfit', 'hyrox', 'functional_training', 'personal_training', 'powerlifting', 'strongman', 'bodybuilding', 'martial_arts', 'yoga', 'pilates', 'indoor_cycling', 'multidisciplinary', 'custom')),
  "approximateMembers" INTEGER,
  "trainerCount" INTEGER,
  "spaceCount" INTEGER,
  "usualCapacity" INTEGER,
  "classTypes" TEXT NOT NULL DEFAULT '[]',
  "scheduleNotes" TEXT NOT NULL DEFAULT '',
  "locale" TEXT NOT NULL CHECK ("locale" IN ('es', 'en', 'de', 'de-CH')),
  "currency" TEXT NOT NULL,
  "usesBookings" SMALLINT NOT NULL DEFAULT 1 CHECK ("usesBookings" IN (0, 1)),
  "usesWaitlist" SMALLINT NOT NULL DEFAULT 1 CHECK ("usesWaitlist" IN (0, 1)),
  "templateKey" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('trial_active', 'trial_paused_support', 'trial_conversion_review', 'trial_expired', 'trial_closed')),
  "subdomain" TEXT NOT NULL,
  "realDataDeclaration" TEXT NOT NULL DEFAULT 'undeclared' CHECK ("realDataDeclaration" IN ('undeclared', 'yes', 'no', 'assistance')),
  "autoCleanupEligible" SMALLINT NOT NULL DEFAULT 0 CHECK ("autoCleanupEligible" IN (0, 1)),
  "dataReviewRequestedAt" BIGINT,
  "cleanupEligibleAt" BIGINT,
  "conversionDraft" TEXT NOT NULL DEFAULT '[]',
  "startedAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "pausedAt" BIGINT,
  "closedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_commercialTrials_status" ON "commercialTrials" ("status");
CREATE INDEX IF NOT EXISTS "idx_commercialTrials_expiry" ON "commercialTrials" ("expiresAt");

CREATE TABLE IF NOT EXISTS "commercialTrialEvents" (
  "id" TEXT PRIMARY KEY,
  "trialId" TEXT NOT NULL REFERENCES "commercialTrials" ("id") ON DELETE CASCADE,
  "actorUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_commercialTrialEvents_trial" ON "commercialTrialEvents" ("trialId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "administratorSignupProvisioning" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "facilityName" TEXT NOT NULL,
  "facilityType" TEXT NOT NULL CHECK ("facilityType" IN ('traditional_gym', 'crossfit', 'hyrox', 'functional_training', 'personal_training', 'powerlifting', 'strongman', 'bodybuilding', 'martial_arts', 'yoga', 'pilates', 'indoor_cycling', 'multidisciplinary', 'custom')),
  "locale" TEXT NOT NULL CHECK ("locale" IN ('es', 'en', 'de', 'de-CH')),
  "createdAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "delegationGrants" (
  "id" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "delegateUserId" TEXT REFERENCES "users" ("id") ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "tokenPreview" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'bookings' CHECK ("scope" = 'bookings'),
  "duration" TEXT NOT NULL CHECK ("duration" IN ('24h', '7d', '30d', 'indefinite')),
  "expiresAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "redeemedAt" BIGINT,
  "revokedAt" BIGINT,
  "ownerHiddenAt" BIGINT,
  "delegateHiddenAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_delegationGrants_owner" ON "delegationGrants" ("ownerUserId");
CREATE INDEX IF NOT EXISTS "idx_delegationGrants_delegate" ON "delegationGrants" ("delegateUserId");
CREATE INDEX IF NOT EXISTS "idx_delegationGrants_expiry" ON "delegationGrants" ("expiresAt");

CREATE TABLE IF NOT EXISTS "supportTickets" (
  "id" TEXT PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "requesterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "assigneeUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('account', 'billing', 'reservations', 'technical', 'safety', 'general')),
  "priority" TEXT NOT NULL CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  "source" TEXT NOT NULL CHECK ("source" IN ('web', 'api', 'system')),
  "relatedType" TEXT,
  "relatedId" TEXT,
  "context" TEXT NOT NULL DEFAULT '{}',
  "firstResponseDueAt" BIGINT NOT NULL,
  "resolutionDueAt" BIGINT NOT NULL,
  "firstRespondedAt" BIGINT,
  "resolvedAt" BIGINT,
  "closedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_requester" ON "supportTickets" ("requesterUserId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_queue" ON "supportTickets" ("facilityId", "status", "priority", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_assignee" ON "supportTickets" ("assigneeUserId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "supportAgents" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('agent', 'manager')),
  "active" SMALLINT NOT NULL DEFAULT 1 CHECK ("active" IN (0, 1)),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_supportAgents_active" ON "supportAgents" ("facilityId", "active", "role");

CREATE TABLE IF NOT EXISTS "supportMessages" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "authorUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "visibility" TEXT NOT NULL CHECK ("visibility" IN ('requester', 'internal')),
  "body" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportMessages_ticket" ON "supportMessages" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportAttachments" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "messageId" TEXT REFERENCES "supportMessages" ("id") ON DELETE SET NULL,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "checksumSha256" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportAttachments_ticket" ON "supportAttachments" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportEvents" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "actorUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportEvents_ticket" ON "supportEvents" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportKnowledgeArticles" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'published', 'archived')),
  "authorUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "publishedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_status" ON "supportKnowledgeArticles" ("facilityId", "status", "category", "updatedAt" DESC);

INSERT INTO "facilityProfiles" ("id", "name", "logoDataUrl", "accentColor", "updatedAt")
VALUES ('legacy-import-quarantine', 'Legacy import under review', '', '#64748b', 0)
ON CONFLICT ("id") DO NOTHING;
`;

const migrations: Migration[] = [
  { version: 1, name: "initial-production-schema", sql: postgresInitialSchema },
  {
    version: 2,
    name: "commercial-workflow-and-booking-lifecycle",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "classBookingConfigurations" (
  "classId" TEXT PRIMARY KEY REFERENCES "gymClasses" ("id") ON DELETE CASCADE,
  "configuration" TEXT NOT NULL DEFAULT '{}',
  "lifecycleState" TEXT NOT NULL DEFAULT 'active' CHECK ("lifecycleState" IN ('active', 'suspended', 'cancelled')),
  "seriesId" TEXT,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_classBookingConfigurations_series"
  ON "classBookingConfigurations" ("seriesId");

CREATE TABLE IF NOT EXISTS "bookingLifecycles" (
  "bookingId" TEXT PRIMARY KEY REFERENCES "bookings" ("id") ON DELETE CASCADE,
  "lifecycleStatus" TEXT NOT NULL,
  "attendanceIntention" TEXT NOT NULL DEFAULT 'unanswered',
  "intentionUpdatedAt" BIGINT,
  "confirmedAt" BIGINT,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_bookingLifecycles_status"
  ON "bookingLifecycles" ("lifecycleStatus", "attendanceIntention");

CREATE TABLE IF NOT EXISTS "commercialRequests" (
  "id" TEXT PRIMARY KEY,
  "trialId" TEXT NOT NULL REFERENCES "commercialTrials" ("id") ON DELETE CASCADE,
  "requesterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('commercial_contact', 'support', 'problem')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_review', 'resolved', 'cancelled')),
  "name" TEXT NOT NULL,
  "facilityName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "preferredChannel" TEXT NOT NULL CHECK ("preferredChannel" IN ('email', 'phone', 'whatsapp')),
  "preferredTime" TEXT NOT NULL DEFAULT '',
  "contactConsent" SMALLINT NOT NULL CHECK ("contactConsent" IN (0, 1)),
  "includeEnvironmentSummary" SMALLINT NOT NULL DEFAULT 0 CHECK ("includeEnvironmentSummary" IN (0, 1)),
  "environmentSummary" TEXT,
  "problemCategory" TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "resolvedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_commercialRequests_trial"
  ON "commercialRequests" ("trialId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_commercialRequests_status"
  ON "commercialRequests" ("status", "kind");
`,
  },
  {
    version: 3,
    name: "attendance-reputation-waitlist-session-content",
    sql: String.raw`
ALTER TABLE "bookingLifecycles"
  ADD COLUMN IF NOT EXISTS "lastReminderAt" BIGINT;
ALTER TABLE "bookingLifecycles"
  ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "waitlistEntries"
  ADD COLUMN IF NOT EXISTS "promotionExpiresAt" BIGINT;

INSERT INTO "bookingLifecycles" (
  "bookingId",
  "lifecycleStatus",
  "attendanceIntention",
  "intentionUpdatedAt",
  "confirmedAt",
  "lastReminderAt",
  "reminderCount",
  "updatedAt"
)
SELECT
  "id",
  CASE
    WHEN "status" = 'waitlist' THEN 'waitlisted'
    WHEN "status" = 'cancelled' THEN 'cancelled_on_time'
    ELSE 'confirmation_pending'
  END,
  'unanswered',
  NULL,
  NULL,
  NULL,
  0,
  "createdAt"
FROM "bookings"
ON CONFLICT ("bookingId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "bookingReputations" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "score" INTEGER NOT NULL DEFAULT 100 CHECK ("score" BETWEEN 0 AND 100),
  "penaltyUntil" BIGINT,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_bookingReputations_penalty"
  ON "bookingReputations" ("penaltyUntil");

CREATE TABLE IF NOT EXISTS "bookingReputationEvents" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "bookingId" TEXT REFERENCES "bookings" ("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL,
  "pointsDelta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_bookingReputationEvents_user"
  ON "bookingReputationEvents" ("userId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "classSessionContents" (
  "classId" TEXT PRIMARY KEY REFERENCES "gymClasses" ("id") ON DELETE CASCADE,
  "terminology" TEXT NOT NULL DEFAULT 'Contenido de la sesión',
  "blocks" TEXT NOT NULL DEFAULT '[]',
  "commentsEnabled" SMALLINT NOT NULL DEFAULT 0 CHECK ("commentsEnabled" IN (0, 1)),
  "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "sessionContentProgress" (
  "classId" TEXT NOT NULL REFERENCES "gymClasses" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "completedBlockIds" TEXT NOT NULL DEFAULT '[]',
  "notes" TEXT NOT NULL DEFAULT '',
  "updatedAt" BIGINT NOT NULL,
  PRIMARY KEY ("classId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_sessionContentProgress_user"
  ON "sessionContentProgress" ("userId", "updatedAt" DESC);
`,
  },
  {
    version: 4,
    name: "booking-lifecycle-query-indexes",
    sql: String.raw`
CREATE INDEX IF NOT EXISTS "idx_bookingReputationEvents_booking_type"
  ON "bookingReputationEvents" ("bookingId", "type");
CREATE INDEX IF NOT EXISTS "idx_waitlistEntries_class_expiry"
  ON "waitlistEntries" ("classId", "promotionExpiresAt");
`,
  },
  {
    version: 5,
    name: "community-identity-parental-moderation",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "socialProfiles" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "username" TEXT NOT NULL UNIQUE,
  "bio" TEXT NOT NULL DEFAULT '',
  "displayRealName" SMALLINT NOT NULL DEFAULT 0 CHECK ("displayRealName" IN (0, 1)),
  "birthDate" TEXT,
  "privacy" TEXT NOT NULL DEFAULT '{}',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_socialProfiles_username_lower"
  ON "socialProfiles" (LOWER("username"));

CREATE TABLE IF NOT EXISTS "internalContacts" (
  "id" TEXT PRIMARY KEY,
  "requesterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "recipientUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CHECK ("requesterUserId" <> "recipientUserId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_internalContacts_pair"
  ON "internalContacts" (LEAST("requesterUserId", "recipientUserId"), GREATEST("requesterUserId", "recipientUserId"));
CREATE INDEX IF NOT EXISTS "idx_internalContacts_user_status"
  ON "internalContacts" ("requesterUserId", "recipientUserId", "status");

CREATE TABLE IF NOT EXISTS "communityChannels" (
  "id" TEXT PRIMARY KEY,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('facility','class','community')),
  "scopeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("scope", "scopeId", "name")
);

CREATE TABLE IF NOT EXISTS "communityMessages" (
  "id" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL REFERENCES "communityChannels" ("id") ON DELETE CASCADE,
  "authorUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "parentId" TEXT REFERENCES "communityMessages" ("id") ON DELETE SET NULL,
  "body" TEXT NOT NULL CHECK (length("body") BETWEEN 1 AND 4000),
  "protectedBody" TEXT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('public','private_justification')),
  "pinned" SMALLINT NOT NULL DEFAULT 0 CHECK ("pinned" IN (0, 1)),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','reported','removed')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_communityMessages_channel"
  ON "communityMessages" ("channelId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "communityAttachments" (
  "id" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL REFERENCES "communityChannels" ("id") ON DELETE CASCADE,
  "messageId" TEXT REFERENCES "communityMessages" ("id") ON DELETE SET NULL,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL CHECK ("sizeBytes" > 0),
  "storageKey" TEXT NOT NULL UNIQUE,
  "checksumSha256" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_communityAttachments_channel"
  ON "communityAttachments" ("channelId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_communityAttachments_message"
  ON "communityAttachments" ("messageId");

CREATE TABLE IF NOT EXISTS "communityMembers" (
  "channelId" TEXT NOT NULL REFERENCES "communityChannels" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('owner','member')),
  "createdAt" BIGINT NOT NULL,
  PRIMARY KEY ("channelId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_communityMembers_user"
  ON "communityMembers" ("userId", "channelId");

CREATE TABLE IF NOT EXISTS "facilityLinks" (
  "id" TEXT PRIMARY KEY,
  "sourceFacilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "targetFacilityName" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "mode" TEXT NOT NULL CHECK ("mode" IN ('temporary','permanent')),
  "sharedSpaces" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL CHECK ("status" IN ('facility_link_requested','facility_link_accepted','facility_link_rejected','facility_link_active','facility_link_suspended','facility_link_expired','facility_link_terminated')),
  "expiresAt" BIGINT,
  "createdBy" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_facilityLinks_source_status"
  ON "facilityLinks" ("sourceFacilityId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "parentalControls" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine' REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "childUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "guardianUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "settings" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL CHECK ("status" IN ('parental_control_inactive','parental_control_pending','parental_control_active','parental_control_under_review','parental_control_transitioning','parental_control_ended')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "childUserId", "guardianUserId")
);
CREATE INDEX IF NOT EXISTS "idx_parentalControls_facility_status"
  ON "parentalControls" ("facilityId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "moderationCases" (
  "id" TEXT PRIMARY KEY,
  "reporterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "subjectUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "messageId" TEXT REFERENCES "communityMessages" ("id") ON DELETE SET NULL,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine' REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" TEXT NOT NULL DEFAULT '[]',
  "urgency" TEXT NOT NULL CHECK ("urgency" IN ('normal','high','critical')),
  "status" TEXT NOT NULL CHECK ("status" IN ('open','in_review','resolved','rejected','appeal_open')),
  "resolution" TEXT NOT NULL DEFAULT '',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_moderationCases_status"
  ON "moderationCases" ("facilityId", "status", "urgency", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "moderationActions" (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES "moderationCases" ("id") ON DELETE CASCADE,
  "actorUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "subjectUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "state" TEXT NOT NULL CHECK ("state" IN ('unrestricted','muted','removed_from_chat','temporarily_blocked','blocked_by_facility','under_central_review','appeal_open','platform_suspended')),
  "reason" TEXT NOT NULL,
  "durationMinutes" INTEGER,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_moderationActions_subject"
  ON "moderationActions" ("subjectUserId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "moderationAppeals" (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES "moderationCases" ("id") ON DELETE CASCADE,
  "appellantUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "context" TEXT NOT NULL,
  "evidence" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL CHECK ("status" IN ('open','accepted','rejected')),
  "resolution" TEXT NOT NULL DEFAULT '',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_moderationAppeals_case"
  ON "moderationAppeals" ("caseId", "status", "createdAt" DESC);
`,
  },
  {
    version: 6,
    name: "transactional-email-delivery-queue",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "emailDeliveries" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('email_verification')),
  "recipient" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "payloadEncrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued', 'processing', 'retry', 'sent', 'failed', 'superseded')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" BIGINT NOT NULL,
  "messageId" TEXT,
  "lastError" TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "sentAt" BIGINT,
  "expiresAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_due" ON "emailDeliveries" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_user" ON "emailDeliveries" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_emailDeliveries_expiry" ON "emailDeliveries" ("expiresAt");
`,
  },
  {
    version: 7,
    name: "first-party-anti-automation-challenges",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "antiAutomationChallenges" (
  "id" TEXT PRIMARY KEY,
  "action" TEXT NOT NULL CHECK ("action" IN ('login', 'signup', 'form_access', 'feedback')),
  "nonce" TEXT NOT NULL,
  "difficulty" INTEGER NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "consumedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_antiAutomationChallenges_expiry" ON "antiAutomationChallenges" ("expiresAt");
`,
  },
  {
    version: 8,
    name: "forge-support-foundation",
    sql: String.raw`
DO $$
DECLARE delivery_kind_constraint TEXT;
BEGIN
  SELECT conname INTO delivery_kind_constraint
    FROM pg_constraint
   WHERE conrelid = '"emailDeliveries"'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF delivery_kind_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "emailDeliveries" DROP CONSTRAINT %I', delivery_kind_constraint);
  END IF;
END $$;
ALTER TABLE "emailDeliveries"
  ADD CONSTRAINT "emailDeliveries_kind_check"
  CHECK ("kind" IN ('email_verification', 'support_update', 'security_notice'));

CREATE TABLE IF NOT EXISTS "supportTickets" (
  "id" TEXT PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "requesterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "assigneeUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('account', 'billing', 'reservations', 'technical', 'safety', 'general')),
  "priority" TEXT NOT NULL CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  "source" TEXT NOT NULL CHECK ("source" IN ('web', 'api', 'system')),
  "relatedType" TEXT,
  "relatedId" TEXT,
  "context" TEXT NOT NULL DEFAULT '{}',
  "firstResponseDueAt" BIGINT NOT NULL,
  "resolutionDueAt" BIGINT NOT NULL,
  "firstRespondedAt" BIGINT,
  "resolvedAt" BIGINT,
  "closedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_requester" ON "supportTickets" ("requesterUserId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_queue" ON "supportTickets" ("facilityId", "status", "priority", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_supportTickets_assignee" ON "supportTickets" ("assigneeUserId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "supportAgents" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('agent', 'manager')),
  "active" SMALLINT NOT NULL DEFAULT 1 CHECK ("active" IN (0, 1)),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_supportAgents_active" ON "supportAgents" ("facilityId", "active", "role");

CREATE TABLE IF NOT EXISTS "supportMessages" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "authorUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "visibility" TEXT NOT NULL CHECK ("visibility" IN ('requester', 'internal')),
  "body" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportMessages_ticket" ON "supportMessages" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportAttachments" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "messageId" TEXT REFERENCES "supportMessages" ("id") ON DELETE SET NULL,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "checksumSha256" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportAttachments_ticket" ON "supportAttachments" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportEvents" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "supportTickets" ("id") ON DELETE CASCADE,
  "actorUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "type" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_supportEvents_ticket" ON "supportEvents" ("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "supportKnowledgeArticles" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine',
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'published', 'archived')),
  "authorUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "publishedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_status" ON "supportKnowledgeArticles" ("facilityId", "status", "category", "updatedAt" DESC);
`,
  },
  {
    version: 9,
    name: "account-recovery-flow",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "accountRecoveryChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_accountRecoveryChallenges_userId" ON "accountRecoveryChallenges" ("userId");
CREATE INDEX IF NOT EXISTS "idx_accountRecoveryChallenges_expiresAt" ON "accountRecoveryChallenges" ("expiresAt");

DO $$
DECLARE delivery_kind_constraint TEXT;
BEGIN
  SELECT conname INTO delivery_kind_constraint
    FROM pg_constraint
   WHERE conrelid = '"emailDeliveries"'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kind%';
  IF delivery_kind_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "emailDeliveries" DROP CONSTRAINT %I', delivery_kind_constraint);
  END IF;
END $$;
ALTER TABLE "emailDeliveries"
  ADD CONSTRAINT "emailDeliveries_kind_check"
  CHECK ("kind" IN ('email_verification', 'account_recovery', 'support_update', 'security_notice'));

DO $$
DECLARE action_constraint TEXT;
BEGIN
  SELECT conname INTO action_constraint
    FROM pg_constraint
   WHERE conrelid = '"antiAutomationChallenges"'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%action%';
  IF action_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "antiAutomationChallenges" DROP CONSTRAINT %I', action_constraint);
  END IF;
END $$;
ALTER TABLE "antiAutomationChallenges"
  ADD CONSTRAINT "antiAutomationChallenges_action_check"
  CHECK ("action" IN ('login', 'signup', 'recovery', 'form_access', 'feedback'));
`,
  },
  {
    version: 10,
    name: "account-recovery-concurrency-hardening",
    sql: String.raw`
DELETE FROM "accountRecoveryChallenges"
WHERE EXISTS (
  SELECT 1
  FROM "accountRecoveryChallenges" newer
  WHERE newer."userId" = "accountRecoveryChallenges"."userId"
    AND (
      newer."createdAt" > "accountRecoveryChallenges"."createdAt"
      OR (
        newer."createdAt" = "accountRecoveryChallenges"."createdAt"
        AND newer."id" > "accountRecoveryChallenges"."id"
      )
    )
);
DROP INDEX IF EXISTS "idx_accountRecoveryChallenges_userId";
CREATE UNIQUE INDEX "idx_accountRecoveryChallenges_userId"
  ON "accountRecoveryChallenges" ("userId");
`,
  },
  {
    version: 11,
    name: "private-community-content-encryption-envelope",
    sql: String.raw`
ALTER TABLE "communityMessages"
  ADD COLUMN IF NOT EXISTS "protectedBody" TEXT;
`,
  },
  {
    version: 12,
    name: "e2ee-one-to-one-relay-foundation",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "e2eeDevices" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "clientDeviceId" TEXT NOT NULL,
  "registrationId" INTEGER NOT NULL CHECK ("registrationId" BETWEEN 1 AND 16380),
  "identityKey" TEXT NOT NULL,
  "signedPrekeyId" INTEGER NOT NULL,
  "signedPrekey" TEXT NOT NULL,
  "signedPrekeySignature" TEXT NOT NULL,
  "capabilityVersion" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "lastSeenAt" BIGINT NOT NULL,
  "revokedAt" BIGINT,
  UNIQUE ("userId", "clientDeviceId")
);
CREATE INDEX IF NOT EXISTS "idx_e2eeDevices_user_active"
  ON "e2eeDevices" ("userId", "revokedAt");

CREATE TABLE IF NOT EXISTS "e2eeOneTimePrekeys" (
  "deviceId" TEXT NOT NULL REFERENCES "e2eeDevices" ("id") ON DELETE CASCADE,
  "keyId" INTEGER NOT NULL,
  "publicKey" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "consumedAt" BIGINT,
  "consumedByDeviceId" TEXT REFERENCES "e2eeDevices" ("id") ON DELETE SET NULL,
  PRIMARY KEY ("deviceId", "keyId")
);
CREATE INDEX IF NOT EXISTS "idx_e2eePrekeys_available"
  ON "e2eeOneTimePrekeys" ("deviceId", "consumedAt", "keyId");

CREATE TABLE IF NOT EXISTS "e2eeConversations" (
  "id" TEXT PRIMARY KEY,
  "participantAUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "participantBUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CHECK ("participantAUserId" < "participantBUserId"),
  UNIQUE ("participantAUserId", "participantBUserId")
);
CREATE INDEX IF NOT EXISTS "idx_e2eeConversations_participantA"
  ON "e2eeConversations" ("participantAUserId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_e2eeConversations_participantB"
  ON "e2eeConversations" ("participantBUserId", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "e2eeEnvelopes" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "e2eeConversations" ("id") ON DELETE CASCADE,
  "senderUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "senderDeviceId" TEXT NOT NULL REFERENCES "e2eeDevices" ("id") ON DELETE CASCADE,
  "recipientUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "recipientDeviceId" TEXT NOT NULL REFERENCES "e2eeDevices" ("id") ON DELETE CASCADE,
  "clientMessageId" TEXT NOT NULL,
  "envelopeType" TEXT NOT NULL CHECK ("envelopeType" IN ('prekey', 'signal')),
  "ciphertext" TEXT NOT NULL CHECK (length("ciphertext") BETWEEN 1 AND 24576),
  "associatedData" TEXT NOT NULL DEFAULT '',
  "createdAt" BIGINT NOT NULL,
  "deliveredAt" BIGINT,
  "readAt" BIGINT,
  "expiresAt" BIGINT,
  UNIQUE ("senderDeviceId", "clientMessageId", "recipientDeviceId")
);
CREATE INDEX IF NOT EXISTS "idx_e2eeEnvelopes_recipient"
  ON "e2eeEnvelopes" ("recipientDeviceId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "idx_e2eeEnvelopes_conversation"
  ON "e2eeEnvelopes" ("conversationId", "createdAt", "id");
`,
  },
  {
    version: 13,
    name: "encrypted-community-attachments",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "communityAttachments" (
  "id" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL REFERENCES "communityChannels" ("id") ON DELETE CASCADE,
  "messageId" TEXT REFERENCES "communityMessages" ("id") ON DELETE SET NULL,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL CHECK ("sizeBytes" > 0),
  "storageKey" TEXT NOT NULL UNIQUE,
  "checksumSha256" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_communityAttachments_channel"
  ON "communityAttachments" ("channelId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_communityAttachments_message"
  ON "communityAttachments" ("messageId");
`,
  },
  {
    version: 14,
    name: "opaque-e2ee-attachments",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "e2eeAttachments" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "e2eeConversations" ("id") ON DELETE CASCADE,
  "senderUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "senderDeviceId" TEXT NOT NULL REFERENCES "e2eeDevices" ("id") ON DELETE CASCADE,
  "recipientUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "recipientDeviceId" TEXT NOT NULL REFERENCES "e2eeDevices" ("id") ON DELETE CASCADE,
  "clientAttachmentId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "sizeBytes" BIGINT NOT NULL CHECK ("sizeBytes" > 0),
  "checksumSha256" TEXT NOT NULL,
  "associatedData" TEXT NOT NULL DEFAULT '',
  "createdAt" BIGINT NOT NULL,
  "downloadedAt" BIGINT,
  "expiresAt" BIGINT,
  UNIQUE ("senderDeviceId", "clientAttachmentId", "recipientDeviceId")
);
CREATE INDEX IF NOT EXISTS "idx_e2eeAttachments_recipient"
  ON "e2eeAttachments" ("recipientDeviceId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "idx_e2eeAttachments_conversation"
  ON "e2eeAttachments" ("conversationId", "createdAt", "id");
`,
  },
  {
    version: 15,
    name: "facility-membership-foundation",
    sql: String.raw`
ALTER TABLE "facilityProfiles"
  ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "facilityProfiles"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active', 'suspended', 'closed'));
ALTER TABLE "facilityProfiles"
  ADD COLUMN IF NOT EXISTS "createdAt" BIGINT NOT NULL DEFAULT 0;

UPDATE "facilityProfiles"
SET "slug" = "id"
WHERE "slug" = '';
UPDATE "facilityProfiles"
SET "createdAt" = "updatedAt"
WHERE "createdAt" = 0;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_facilityProfiles_slug"
  ON "facilityProfiles" ("slug");

INSERT INTO "facilityProfiles"
  ("id", "slug", "name", "logoDataUrl", "accentColor", "status", "createdAt", "updatedAt")
VALUES
  ('legacy-import-quarantine', 'legacy-import-quarantine', 'Legacy import under review', '', '#64748b', 'closed', 0, 0)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "facilityMemberships" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('owner', 'admin', 'trainer', 'member')),
  "status" TEXT NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active', 'invited', 'suspended', 'left')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_facilityMemberships_user"
  ON "facilityMemberships" ("userId", "status");
CREATE INDEX IF NOT EXISTS "idx_facilityMemberships_facility_role"
  ON "facilityMemberships" ("facilityId", "role", "status");

INSERT INTO "facilityMemberships"
  ("id", "facilityId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT
  'legacy-import-quarantine:' || "id",
  'legacy-import-quarantine',
  "id",
  CASE "role"
    WHEN 'admin' THEN 'admin'
    WHEN 'trainer' THEN 'trainer'
    ELSE 'member'
  END,
  'active',
  "createdAt",
  "createdAt"
FROM "users"
ON CONFLICT ("facilityId", "userId") DO NOTHING;

UPDATE "facilityMemberships"
SET "role" = 'owner'
WHERE "id" = (
  SELECT membership."id"
  FROM "facilityMemberships" AS membership
  INNER JOIN "users" AS account ON account."id" = membership."userId"
  WHERE membership."facilityId" = 'legacy-import-quarantine'
    AND membership."status" = 'active'
    AND account."role" = 'admin'
  ORDER BY account."createdAt" ASC, account."id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1
  FROM "facilityMemberships"
  WHERE "facilityId" = 'legacy-import-quarantine'
    AND "role" = 'owner'
    AND "status" = 'active'
);
`,
  },
  {
    version: 16,
    name: "facility-class-scope",
    sql: String.raw`
ALTER TABLE "gymClasses"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';

ALTER TABLE "gymClasses"
  ADD CONSTRAINT "gymClasses_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "idx_gymClasses_facility_scheduled"
  ON "gymClasses" ("facilityId", "scheduledAt");
`,
  },
  {
    version: 17,
    name: "facility-booking-reputation-scope",
    sql: String.raw`
ALTER TABLE "bookingReputations"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';

ALTER TABLE "bookingReputationEvents"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';

UPDATE "bookingReputationEvents" AS event
SET "facilityId" = (
  SELECT gym_class."facilityId"
  FROM "gymClasses" AS gym_class
  WHERE gym_class."id" = booking."classId"
)
FROM "bookings" AS booking
WHERE event."bookingId" = booking."id";

ALTER TABLE "bookingReputations"
  DROP CONSTRAINT "bookingReputations_pkey";
ALTER TABLE "bookingReputations"
  ADD CONSTRAINT "bookingReputations_pkey"
  PRIMARY KEY ("facilityId", "userId");
ALTER TABLE "bookingReputations"
  ADD CONSTRAINT "bookingReputations_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
  ON DELETE CASCADE;
ALTER TABLE "bookingReputationEvents"
  ADD CONSTRAINT "bookingReputationEvents_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
  ON DELETE CASCADE;

DROP INDEX IF EXISTS "idx_bookingReputations_penalty";
DROP INDEX IF EXISTS "idx_bookingReputationEvents_user";
CREATE INDEX IF NOT EXISTS "idx_bookingReputations_facility_penalty"
  ON "bookingReputations" ("facilityId", "penaltyUntil");
CREATE INDEX IF NOT EXISTS "idx_bookingReputationEvents_facility_user"
  ON "bookingReputationEvents" ("facilityId", "userId", "createdAt" DESC);
`,
  },
  {
    version: 18,
    name: "facility-billing-scope",
    sql: String.raw`
ALTER TABLE "billingRecords"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';
ALTER TABLE "billingRecords"
  ADD CONSTRAINT "billingRecords_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
  ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_billingRecords_facility_status"
  ON "billingRecords" ("facilityId", "status", "updatedAt" DESC);
`,
  },
  {
    version: 19,
    name: "facility-support-scope",
    sql: String.raw`
ALTER TABLE "supportKnowledgeArticles"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';
ALTER TABLE "supportKnowledgeArticles"
  DROP CONSTRAINT IF EXISTS "supportKnowledgeArticles_slug_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportTickets_facilityId_fkey'
  ) THEN
    ALTER TABLE "supportTickets"
      ADD CONSTRAINT "supportTickets_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportAgents_facilityId_fkey'
  ) THEN
    ALTER TABLE "supportAgents"
      ADD CONSTRAINT "supportAgents_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportKnowledgeArticles_facilityId_fkey'
  ) THEN
    ALTER TABLE "supportKnowledgeArticles"
      ADD CONSTRAINT "supportKnowledgeArticles_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "idx_supportKnowledge_status";
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_status"
  ON "supportKnowledgeArticles"
  ("facilityId", "status", "category", "updatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_supportKnowledge_facility_slug"
  ON "supportKnowledgeArticles" ("facilityId", "slug");
`,
  },
  {
    version: 20,
    name: "facility-moderation-scope",
    sql: String.raw`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'moderationCases_facilityId_fkey'
  ) THEN
    ALTER TABLE "moderationCases"
      ADD CONSTRAINT "moderationCases_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facilityLinks_sourceFacilityId_fkey'
  ) THEN
    ALTER TABLE "facilityLinks"
      ADD CONSTRAINT "facilityLinks_sourceFacilityId_fkey"
      FOREIGN KEY ("sourceFacilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "idx_moderationCases_status";
CREATE INDEX IF NOT EXISTS "idx_moderationCases_status"
  ON "moderationCases" ("facilityId", "status", "urgency", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_facilityLinks_source_status"
  ON "facilityLinks" ("sourceFacilityId", "status", "updatedAt" DESC);
`,
  },
  {
    version: 21,
    name: "facility-community-controls-scope",
    sql: String.raw`
ALTER TABLE "parentalControls"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';
ALTER TABLE "parentalControls"
  DROP CONSTRAINT IF EXISTS "parentalControls_childUserId_guardianUserId_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parentalControls_facilityId_fkey'
  ) THEN
    ALTER TABLE "parentalControls"
      ADD CONSTRAINT "parentalControls_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_parentalControls_facility_pair"
  ON "parentalControls" ("facilityId", "childUserId", "guardianUserId");
CREATE INDEX IF NOT EXISTS "idx_parentalControls_facility_status"
  ON "parentalControls" ("facilityId", "status", "updatedAt" DESC);
`,
  },
  {
    version: 22,
    name: "commercial-trials-facility-scope",
    sql: String.raw`
ALTER TABLE "commercialTrials"
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'legacy-import-quarantine';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercialTrials_facilityId_fkey'
  ) THEN
    ALTER TABLE "commercialTrials"
      ADD CONSTRAINT "commercialTrials_facilityId_fkey"
      FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_commercialTrials_facility"
  ON "commercialTrials" ("facilityId");
`,
  },
  {
    version: 23,
    name: "administrator-signup-provisioning",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "administratorSignupProvisioning" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "facilityName" TEXT NOT NULL,
  "facilityType" TEXT NOT NULL CHECK ("facilityType" IN ('traditional_gym', 'crossfit', 'hyrox', 'functional_training', 'personal_training', 'powerlifting', 'strongman', 'bodybuilding', 'martial_arts', 'yoga', 'pilates', 'indoor_cycling', 'multidisciplinary', 'custom')),
  "locale" TEXT NOT NULL CHECK ("locale" IN ('es', 'en', 'de', 'de-CH')),
  "createdAt" BIGINT NOT NULL
);
`,
  },
  {
    version: 24,
    name: "commercial-trial-abandonment-cleanup",
    sql: String.raw`
ALTER TABLE "commercialTrials"
  ADD COLUMN IF NOT EXISTS "autoCleanupEligible" SMALLINT NOT NULL DEFAULT 0
    CHECK ("autoCleanupEligible" IN (0, 1));
ALTER TABLE "commercialTrials"
  ADD COLUMN IF NOT EXISTS "dataReviewRequestedAt" BIGINT;
ALTER TABLE "commercialTrials"
  ADD COLUMN IF NOT EXISTS "cleanupEligibleAt" BIGINT;

CREATE INDEX IF NOT EXISTS "idx_commercialTrials_cleanup"
  ON "commercialTrials" ("autoCleanupEligible", "cleanupEligibleAt");
`,
  },
  {
    version: 25,
    name: "booking-analytics-event-history",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "bookingAnalyticsEvents" (
  "id" TEXT PRIMARY KEY,
  "deduplicationKey" TEXT NOT NULL UNIQUE,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "bookingId" TEXT REFERENCES "bookings" ("id") ON DELETE SET NULL,
  "classId" TEXT REFERENCES "gymClasses" ("id") ON DELETE SET NULL,
  "memberUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "trainerUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN (
    'baseline_import',
    'booking_created',
    'waitlist_promoted',
    'promotion_expired',
    'booking_cancelled',
    'attendance_intention_changed',
    'attendance_recorded',
    'attendance_corrected'
  )),
  "source" TEXT NOT NULL CHECK ("source" IN ('baseline', 'live')),
  "fromState" TEXT,
  "toState" TEXT NOT NULL,
  "activityName" TEXT NOT NULL,
  "scheduledAt" BIGINT NOT NULL,
  "capacitySnapshot" INTEGER NOT NULL CHECK ("capacitySnapshot" >= 0),
  "occurredAt" BIGINT NOT NULL,
  "recordedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_bookingAnalyticsEvents_facility_occurred"
  ON "bookingAnalyticsEvents" ("facilityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "idx_bookingAnalyticsEvents_facility_scheduled"
  ON "bookingAnalyticsEvents" ("facilityId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "idx_bookingAnalyticsEvents_member_scheduled"
  ON "bookingAnalyticsEvents" ("facilityId", "memberUserId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "idx_bookingAnalyticsEvents_class_event"
  ON "bookingAnalyticsEvents" ("facilityId", "classId", "eventType", "occurredAt");

INSERT INTO "bookingAnalyticsEvents" (
  "id",
  "deduplicationKey",
  "facilityId",
  "bookingId",
  "classId",
  "memberUserId",
  "trainerUserId",
  "eventType",
  "source",
  "fromState",
  "toState",
  "activityName",
  "scheduledAt",
  "capacitySnapshot",
  "occurredAt",
  "recordedAt"
)
SELECT
  'baseline:' || bookings."id",
  'baseline:' || bookings."id",
  classes."facilityId",
  bookings."id",
  bookings."classId",
  bookings."userId",
  (SELECT "id" FROM "users" WHERE "id" = classes."trainerId"),
  'baseline_import',
  'baseline',
  NULL,
  COALESCE(
    lifecycles."lifecycleStatus",
    CASE bookings."status"
      WHEN 'waitlist' THEN 'waitlisted'
      WHEN 'cancelled' THEN 'cancelled_on_time'
      ELSE 'confirmation_pending'
    END
  ),
  classes."name",
  classes."scheduledAt",
  classes."maxCapacity",
  bookings."createdAt",
  (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
FROM "bookings" AS bookings
INNER JOIN "gymClasses" AS classes ON classes."id" = bookings."classId"
LEFT JOIN "bookingLifecycles" AS lifecycles
  ON lifecycles."bookingId" = bookings."id"
ON CONFLICT ("deduplicationKey") DO NOTHING;
`,
  },
  {
    version: 26,
    name: "corporate-manager-console-roles",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "corporateRoleAssignments" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "profileId" TEXT NOT NULL CHECK ("profileId" IN (
    'manager-core',
    'manager-coordinator',
    'manager-flow-administrator',
    'manager-account',
    'manager-security',
    'manager-resource',
    'manager-encryption',
    'manager-environment',
    'manager-email',
    'manager-notification',
    'manager-support'
  )),
  "assignedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_corporateRoleAssignments_active"
  ON "corporateRoleAssignments" ("userId", "profileId")
  WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_corporateRoleAssignments_user"
  ON "corporateRoleAssignments" ("userId", "status");

CREATE TABLE IF NOT EXISTS "managerTerminalAccess" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "accessMode" TEXT NOT NULL CHECK ("accessMode" IN ('internal', 'external')),
  "credentialHash" TEXT NOT NULL UNIQUE,
  "terminalSessionHash" TEXT UNIQUE,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT,
  "lastActivityAt" BIGINT NOT NULL,
  "lastHeartbeatAt" BIGINT NOT NULL,
  "consumedAt" BIGINT,
  "terminalSessionExpiresAt" BIGINT,
  "revokedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_managerTerminalAccess_user"
  ON "managerTerminalAccess" ("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "idx_managerTerminalAccess_session"
  ON "managerTerminalAccess" ("terminalSessionHash", "terminalSessionExpiresAt");
`,
  },
  {
    version: 27,
    name: "dynamic-manager-organizational-access",
    sql: String.raw`
ALTER TABLE "managerTerminalAccess"
  ADD COLUMN IF NOT EXISTS "scopeProfileId" TEXT,
  ADD COLUMN IF NOT EXISTS "allowTemporaryPermissions" INTEGER NOT NULL DEFAULT 0
    CHECK ("allowTemporaryPermissions" IN (0, 1));

CREATE TABLE IF NOT EXISTS "managerOrganizationalUnits" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('department', 'workgroup')),
  "parentUnitId" TEXT REFERENCES "managerOrganizationalUnits" ("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'archived')),
  "createdByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_managerOrganizationalUnits_parent"
  ON "managerOrganizationalUnits" ("parentUnitId", "status");

CREATE TABLE IF NOT EXISTS "managerOrganizationalMemberships" (
  "id" TEXT PRIMARY KEY,
  "unitId" TEXT NOT NULL REFERENCES "managerOrganizationalUnits" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "membershipRole" TEXT NOT NULL DEFAULT 'member' CHECK ("membershipRole" IN ('lead', 'member')),
  "assignedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_managerOrganizationalMemberships_active"
  ON "managerOrganizationalMemberships" ("unitId", "userId")
  WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_managerOrganizationalMemberships_user"
  ON "managerOrganizationalMemberships" ("userId", "status");

CREATE TABLE IF NOT EXISTS "managerTemporaryPermissions" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "profileId" TEXT NOT NULL CHECK ("profileId" IN (
    'manager-core',
    'manager-coordinator',
    'manager-flow-administrator',
    'manager-account',
    'manager-security',
    'manager-resource',
    'manager-encryption',
    'manager-environment',
    'manager-email',
    'manager-notification',
    'manager-support'
  )),
  "unitId" TEXT REFERENCES "managerOrganizationalUnits" ("id") ON DELETE CASCADE,
  "accessMode" TEXT NOT NULL DEFAULT 'any' CHECK ("accessMode" IN ('internal', 'external', 'any')),
  "grantedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "startsAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT,
  CHECK ("expiresAt" > "startsAt")
);
CREATE INDEX IF NOT EXISTS "idx_managerTemporaryPermissions_user"
  ON "managerTemporaryPermissions" ("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "idx_managerTemporaryPermissions_unit"
  ON "managerTemporaryPermissions" ("unitId", "status", "expiresAt");
`,
  },
  {
    version: 28,
    name: "commercial-corporate-support-application-tenancy",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "applicationTenants" (
  "id" TEXT PRIMARY KEY CHECK ("id" IN ('commercial', 'corporate-support')),
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('commercial', 'corporate_support')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);

INSERT INTO "applicationTenants"
  ("id", "name", "kind", "status", "createdAt", "updatedAt")
VALUES
  ('commercial', 'Umbravia Forge Commercial', 'commercial', 'active', 0, 0),
  ('corporate-support', 'Umbravia Forge Corporate Support', 'corporate_support', 'active', 0, 0)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "supportTickets"
  ADD COLUMN IF NOT EXISTS "applicationTenantId" TEXT NOT NULL DEFAULT 'corporate-support'
    CHECK ("applicationTenantId" IN ('commercial', 'corporate-support'));
ALTER TABLE "supportAgents"
  ADD COLUMN IF NOT EXISTS "applicationTenantId" TEXT NOT NULL DEFAULT 'corporate-support'
    CHECK ("applicationTenantId" IN ('commercial', 'corporate-support'));
ALTER TABLE "supportKnowledgeArticles"
  ADD COLUMN IF NOT EXISTS "applicationTenantId" TEXT NOT NULL DEFAULT 'corporate-support'
    CHECK ("applicationTenantId" IN ('commercial', 'corporate-support'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportTickets_applicationTenantId_fkey'
  ) THEN
    ALTER TABLE "supportTickets"
      ADD CONSTRAINT "supportTickets_applicationTenantId_fkey"
      FOREIGN KEY ("applicationTenantId") REFERENCES "applicationTenants" ("id")
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportAgents_applicationTenantId_fkey'
  ) THEN
    ALTER TABLE "supportAgents"
      ADD CONSTRAINT "supportAgents_applicationTenantId_fkey"
      FOREIGN KEY ("applicationTenantId") REFERENCES "applicationTenants" ("id")
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supportKnowledge_applicationTenantId_fkey'
  ) THEN
    ALTER TABLE "supportKnowledgeArticles"
      ADD CONSTRAINT "supportKnowledge_applicationTenantId_fkey"
      FOREIGN KEY ("applicationTenantId") REFERENCES "applicationTenants" ("id")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_supportTickets_application_queue"
  ON "supportTickets"
  ("applicationTenantId", "facilityId", "status", "priority", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_supportAgents_application_active"
  ON "supportAgents"
  ("applicationTenantId", "facilityId", "active", "role");
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_application_status"
  ON "supportKnowledgeArticles"
  ("applicationTenantId", "facilityId", "status", "category", "updatedAt" DESC);
`,
  },
  {
    version: 29,
    name: "tenant-monthly-analytics-surveys",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "analyticsSurveyDefinitions" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "seriesKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "privacyMode" TEXT NOT NULL CHECK ("privacyMode" IN ('anonymous', 'confidential', 'identified')),
  "minimumResponses" INTEGER NOT NULL DEFAULT 5 CHECK ("minimumResponses" BETWEEN 5 AND 50),
  "status" TEXT NOT NULL DEFAULT 'published' CHECK ("status" IN ('published', 'archived')),
  "createdByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "seriesKey", "version")
);

CREATE TABLE IF NOT EXISTS "analyticsSurveyQuestions" (
  "id" TEXT PRIMARY KEY,
  "surveyId" TEXT NOT NULL REFERENCES "analyticsSurveyDefinitions" ("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 1 AND 10),
  "prompt" TEXT NOT NULL,
  "questionType" TEXT NOT NULL CHECK ("questionType" IN ('scale_1_5', 'single_choice', 'multiple_choice')),
  "optionsJson" TEXT NOT NULL DEFAULT '[]',
  "required" INTEGER NOT NULL DEFAULT 1 CHECK ("required" IN (0, 1)),
  "createdAt" BIGINT NOT NULL,
  UNIQUE ("surveyId", "position")
);

CREATE TABLE IF NOT EXISTS "analyticsSurveyCampaigns" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "surveyId" TEXT NOT NULL REFERENCES "analyticsSurveyDefinitions" ("id") ON DELETE RESTRICT,
  "periodKey" TEXT NOT NULL,
  "opensAt" BIGINT NOT NULL,
  "closesAt" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled' CHECK ("status" IN ('scheduled', 'active', 'closed')),
  "createdByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CHECK ("closesAt" > "opensAt"),
  UNIQUE ("facilityId", "periodKey")
);

CREATE TABLE IF NOT EXISTS "analyticsSurveyResponses" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "campaignId" TEXT NOT NULL REFERENCES "analyticsSurveyCampaigns" ("id") ON DELETE CASCADE,
  "respondentUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "submittedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "analyticsSurveyAnswers" (
  "id" TEXT PRIMARY KEY,
  "responseId" TEXT NOT NULL REFERENCES "analyticsSurveyResponses" ("id") ON DELETE CASCADE,
  "questionId" TEXT NOT NULL REFERENCES "analyticsSurveyQuestions" ("id") ON DELETE RESTRICT,
  "valueJson" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  UNIQUE ("responseId", "questionId")
);

CREATE TABLE IF NOT EXISTS "analyticsSurveyParticipations" (
  "campaignId" TEXT NOT NULL REFERENCES "analyticsSurveyCampaigns" ("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "completedAt" BIGINT NOT NULL,
  PRIMARY KEY ("campaignId", "userId")
);

CREATE INDEX IF NOT EXISTS "idx_analyticsSurveyDefinitions_facility_status"
  ON "analyticsSurveyDefinitions" ("facilityId", "status", "seriesKey", "version" DESC);
CREATE INDEX IF NOT EXISTS "idx_analyticsSurveyCampaigns_facility_window"
  ON "analyticsSurveyCampaigns" ("facilityId", "status", "opensAt", "closesAt");
CREATE INDEX IF NOT EXISTS "idx_analyticsSurveyResponses_campaign"
  ON "analyticsSurveyResponses" ("campaignId", "submittedAt");
CREATE INDEX IF NOT EXISTS "idx_analyticsSurveyAnswers_question"
  ON "analyticsSurveyAnswers" ("questionId", "createdAt");
`,
  },
  {
    version: 30,
    name: "tenant-member-crm-foundation",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "crmMemberProfiles" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "memberUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "manualSegment" TEXT CHECK ("manualSegment" IS NULL OR "manualSegment" IN ('onboarding', 'engaged', 'attention', 'reengagement')),
  "assignedToUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "nextFollowUpAt" BIGINT,
  "updatedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("facilityId", "memberUserId")
);

CREATE TABLE IF NOT EXISTS "crmFollowUps" (
  "id" TEXT PRIMARY KEY,
  "facilityId" TEXT NOT NULL REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "memberUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "assignedToUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('onboarding', 'check_in', 'retention', 'service')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'completed', 'dismissed')),
  "dueAt" BIGINT NOT NULL,
  "completedAt" BIGINT,
  "createdByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_crmMemberProfiles_facility_segment"
  ON "crmMemberProfiles" ("facilityId", "manualSegment", "nextFollowUpAt");
CREATE INDEX IF NOT EXISTS "idx_crmFollowUps_facility_status_due"
  ON "crmFollowUps" ("facilityId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "idx_crmFollowUps_member"
  ON "crmFollowUps" ("facilityId", "memberUserId", "createdAt" DESC);
`,
  },
  {
    version: 31,
    name: "activity-domain-neutralization",
    sql: String.raw`
DO $$
BEGIN
  IF to_regclass('public."activitySessions"') IS NULL
     AND to_regclass('public."gymClasses"') IS NOT NULL THEN
    ALTER TABLE "gymClasses" RENAME TO "activitySessions";
  END IF;
  IF to_regclass('public."activitySessionBookingConfigurations"') IS NULL
     AND to_regclass('public."classBookingConfigurations"') IS NOT NULL THEN
    ALTER TABLE "classBookingConfigurations"
      RENAME TO "activitySessionBookingConfigurations";
  END IF;
  IF to_regclass('public."activitySessionContents"') IS NULL
     AND to_regclass('public."classSessionContents"') IS NOT NULL THEN
    ALTER TABLE "classSessionContents" RENAME TO "activitySessionContents";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activitySessionBookingConfigurations'
      AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activitySessionBookingConfigurations'
      AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "activitySessionBookingConfigurations"
      RENAME COLUMN "classId" TO "activitySessionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "bookings" RENAME COLUMN "classId" TO "activitySessionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waitlistEntries' AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waitlistEntries' AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "waitlistEntries" RENAME COLUMN "classId" TO "activitySessionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activitySessionContents' AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activitySessionContents' AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "activitySessionContents"
      RENAME COLUMN "classId" TO "activitySessionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessionContentProgress' AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessionContentProgress' AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "sessionContentProgress"
      RENAME COLUMN "classId" TO "activitySessionId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookingAnalyticsEvents' AND column_name = 'classId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookingAnalyticsEvents' AND column_name = 'activitySessionId'
  ) THEN
    ALTER TABLE "bookingAnalyticsEvents"
      RENAME COLUMN "classId" TO "activitySessionId";
  END IF;
END $$;

DO $$
DECLARE
  index_names TEXT[];
BEGIN
  FOREACH index_names SLICE 1 IN ARRAY ARRAY[
    ARRAY['idx_gymClasses_scheduledAt', 'idx_activitySessions_scheduledAt'],
    ARRAY['idx_gymClasses_facility_scheduled', 'idx_activitySessions_facility_scheduled'],
    ARRAY['idx_classBookingConfigurations_series', 'idx_activitySessionBookingConfigurations_series'],
    ARRAY['idx_bookings_classId', 'idx_bookings_activitySessionId'],
    ARRAY['idx_bookings_active_user_class', 'idx_bookings_active_user_activitySession'],
    ARRAY['idx_waitlistEntries_classId', 'idx_waitlistEntries_activitySessionId'],
    ARRAY['idx_waitlistEntries_class_expiry', 'idx_waitlistEntries_activitySession_expiry'],
    ARRAY['idx_bookingAnalyticsEvents_class_event', 'idx_bookingAnalyticsEvents_activitySession_event']
  ] LOOP
    IF to_regclass(format('public.%I', index_names[1])) IS NOT NULL
       AND to_regclass(format('public.%I', index_names[2])) IS NULL THEN
      EXECUTE format(
        'ALTER INDEX %I RENAME TO %I',
        index_names[1],
        index_names[2]
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  constraint_names TEXT[];
BEGIN
  FOREACH constraint_names SLICE 1 IN ARRAY ARRAY[
    ARRAY['activitySessions', 'gymClasses_pkey', 'activitySessions_pkey'],
    ARRAY['activitySessions', 'gymClasses_facilityId_fkey', 'activitySessions_facilityId_fkey'],
    ARRAY['activitySessionBookingConfigurations', 'classBookingConfigurations_pkey', 'activitySessionBookingConfigurations_pkey'],
    ARRAY['activitySessionBookingConfigurations', 'classBookingConfigurations_classId_fkey', 'activitySessionBookingConfigurations_activitySessionId_fkey'],
    ARRAY['activitySessionBookingConfigurations', 'classBookingConfigurations_lifecycleState_check', 'activitySessionBookingConfigurations_lifecycleState_check'],
    ARRAY['bookings', 'bookings_classId_fkey', 'bookings_activitySessionId_fkey'],
    ARRAY['waitlistEntries', 'waitlistEntries_classId_fkey', 'waitlistEntries_activitySessionId_fkey'],
    ARRAY['waitlistEntries', 'waitlistEntries_classId_userId_key', 'waitlistEntries_activitySessionId_userId_key'],
    ARRAY['activitySessionContents', 'classSessionContents_pkey', 'activitySessionContents_pkey'],
    ARRAY['activitySessionContents', 'classSessionContents_classId_fkey', 'activitySessionContents_activitySessionId_fkey'],
    ARRAY['activitySessionContents', 'classSessionContents_commentsEnabled_check', 'activitySessionContents_commentsEnabled_check'],
    ARRAY['sessionContentProgress', 'sessionContentProgress_pkey', 'sessionContentProgress_activitySession_user_pkey'],
    ARRAY['sessionContentProgress', 'sessionContentProgress_classId_fkey', 'sessionContentProgress_activitySessionId_fkey'],
    ARRAY['bookingAnalyticsEvents', 'bookingAnalyticsEvents_classId_fkey', 'bookingAnalyticsEvents_activitySessionId_fkey']
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('public.%I', constraint_names[1]))
        AND conname = constraint_names[2]
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('public.%I', constraint_names[1]))
        AND conname = constraint_names[3]
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
        constraint_names[1],
        constraint_names[2],
        constraint_names[3]
      );
    END IF;
  END LOOP;
END $$;
`,
  },
  {
    version: 32,
    name: "stripe-commercial-subscriptions",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "facilityCommercialSubscriptions" (
  "facilityId" TEXT PRIMARY KEY REFERENCES "facilityProfiles" ("id") ON DELETE CASCADE,
  "stripeCustomerId" TEXT UNIQUE,
  "stripeSubscriptionId" TEXT UNIQUE,
  "stripePriceId" TEXT,
  "planKey" TEXT CHECK ("planKey" IS NULL OR "planKey" IN ('monthly', 'annual')),
  "status" TEXT NOT NULL DEFAULT 'inactive' CHECK ("status" IN (
    'inactive', 'checkout_pending', 'trialing', 'active', 'past_due',
    'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired'
  )),
  "currentPeriodEnd" BIGINT,
  "cancelAtPeriodEnd" INTEGER NOT NULL DEFAULT 0 CHECK ("cancelAtPeriodEnd" IN (0, 1)),
  "lastStripeEventCreatedAt" BIGINT,
  "lastStripeEventId" TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_facilityCommercialSubscriptions_status"
  ON "facilityCommercialSubscriptions" ("status", "currentPeriodEnd");

CREATE TABLE IF NOT EXISTS "stripeWebhookEvents" (
  "eventId" TEXT PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "facilityId" TEXT REFERENCES "facilityProfiles" ("id") ON DELETE SET NULL,
  "stripeCreatedAt" BIGINT NOT NULL,
  "livemode" INTEGER NOT NULL CHECK ("livemode" IN (0, 1)),
  "receivedAt" BIGINT NOT NULL,
  "processedAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_stripeWebhookEvents_received"
  ON "stripeWebhookEvents" ("receivedAt" DESC);
`,
  },
  {
    version: 33,
    name: "canonical-facility-boundary-and-stripe-checkout-lifecycle",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "platformOperators" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL CHECK ("source" = 'controlled_provisioning'),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_platformOperators_status"
  ON "platformOperators" ("status", "userId");

ALTER TABLE "facilityCommercialSubscriptions"
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_facilityCommercialSubscriptions_checkout"
  ON "facilityCommercialSubscriptions" ("stripeCheckoutSessionId");

UPDATE "facilityMemberships"
SET "status" = 'suspended', "updatedAt" = GREATEST("updatedAt", 0)
WHERE "facilityId" IN (
  SELECT "id" FROM "facilityProfiles" WHERE "id" NOT LIKE 'facility-%'
) AND "status" IN ('active', 'invited');

UPDATE "facilityProfiles"
SET "status" = 'closed', "updatedAt" = GREATEST("updatedAt", 0)
WHERE "id" NOT LIKE 'facility-%' AND "status" <> 'closed';

CREATE OR REPLACE FUNCTION "enforceActiveFacilityScope"()
RETURNS trigger AS $$
BEGIN
  IF NEW."facilityId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "facilityProfiles"
    WHERE "id" = NEW."facilityId"
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Facility scope is not active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  scoped_table record;
  trigger_name text;
BEGIN
  FOR scoped_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'facilityId'
      AND table_name <> 'facilityProfiles'
  LOOP
    trigger_name := 'trg_' || scoped_table.table_name || '_active_facility';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, scoped_table.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "facilityId" ON %I FOR EACH ROW EXECUTE FUNCTION "enforceActiveFacilityScope"()',
      trigger_name,
      scoped_table.table_name
    );
  END LOOP;
END $$;
`,
  },
  {
    version: 34,
    name: "stripe-test-live-boundary",
    sql: String.raw`
ALTER TABLE "facilityCommercialSubscriptions"
  ADD COLUMN IF NOT EXISTS "stripeLivemode" INTEGER NOT NULL DEFAULT 0
  CHECK ("stripeLivemode" IN (0, 1));
`,
  },
  {
    version: 35,
    name: "stripe-billing-operational-state",
    sql: String.raw`
ALTER TABLE "facilityCommercialSubscriptions"
  ADD COLUMN IF NOT EXISTS "billingAttention" TEXT NOT NULL DEFAULT 'none'
  CHECK ("billingAttention" IN (
    'none', 'payment_failed', 'payment_action_required',
    'invoice_finalization_failed'
  )),
  ADD COLUMN IF NOT EXISTS "lastInvoiceEventAt" BIGINT,
  ADD COLUMN IF NOT EXISTS "lastReconciledAt" BIGINT;
`,
  },
  {
    version: 36,
    name: "umf-support-corporate-application",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "umfSupportStaff" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('director', 'agent')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "approvedByUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT
);
CREATE INDEX IF NOT EXISTS "idx_umfSupportStaff_status"
  ON "umfSupportStaff" ("status", "role", "userId");

CREATE TABLE IF NOT EXISTS "umfSupportAccessRequests" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "locale" TEXT NOT NULL CHECK ("locale" IN ('es', 'en', 'de', 'de-CH')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'activated', 'expired')),
  "activationCodeHash" TEXT,
  "activationAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("activationAttempts" >= 0),
  "activationExpiresAt" BIGINT,
  "reviewedByUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "reviewedAt" BIGINT,
  "activatedUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_umfSupportAccessRequests_open_email"
  ON "umfSupportAccessRequests" ("email")
  WHERE "status" IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS "idx_umfSupportAccessRequests_status"
  ON "umfSupportAccessRequests" ("status", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "umfSupportTickets" (
  "id" TEXT PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "requesterUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "requesterEmail" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL DEFAULT '',
  "assigneeUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('account', 'billing', 'privacy', 'technical', 'security', 'general')),
  "priority" TEXT NOT NULL CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed')),
  "source" TEXT NOT NULL CHECK ("source" IN ('web', 'email', 'internal')),
  "firstResponseDueAt" BIGINT NOT NULL,
  "resolutionDueAt" BIGINT NOT NULL,
  "firstRespondedAt" BIGINT,
  "resolvedAt" BIGINT,
  "closedAt" BIGINT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_umfSupportTickets_queue"
  ON "umfSupportTickets" ("status", "priority", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_umfSupportTickets_requester"
  ON "umfSupportTickets" ("requesterEmail", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "umfSupportMessages" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "umfSupportTickets" ("id") ON DELETE CASCADE,
  "authorUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('inbound', 'outbound', 'internal')),
  "channel" TEXT NOT NULL CHECK ("channel" IN ('web', 'email')),
  "sender" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "deliveryId" TEXT REFERENCES "emailDeliveries" ("id") ON DELETE SET NULL,
  "inboundMessageIdHash" TEXT,
  "createdAt" BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_umfSupportMessages_inbound_id"
  ON "umfSupportMessages" ("inboundMessageIdHash")
  WHERE "inboundMessageIdHash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_umfSupportMessages_mailbox"
  ON "umfSupportMessages" ("direction", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_umfSupportMessages_ticket"
  ON "umfSupportMessages" ("ticketId", "createdAt");
`,
  },
  {
    version: 37,
    name: "company-staff-directory",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "companyStaffProfiles" (
  "userId" TEXT PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "position" TEXT NOT NULL CHECK ("position" IN (
    'platform_head',
    'area_head',
    'team_lead',
    'staff',
    'external_collaborator'
  )),
  "reportsToUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'revoked')),
  "appointedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "revokedAt" BIGINT,
  CHECK ("reportsToUserId" IS NULL OR "reportsToUserId" <> "userId")
);
CREATE INDEX IF NOT EXISTS "idx_companyStaffProfiles_directory"
  ON "companyStaffProfiles" ("status", "position", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_companyStaffProfiles_active_head"
  ON "companyStaffProfiles" ("position")
  WHERE "position" = 'platform_head' AND "status" = 'active';
`,
  },
  {
    version: 38,
    name: "corporate-role-delegations",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "corporateRoleDelegations" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL CHECK ("profileId" IN (
    'manager-core',
    'manager-coordinator',
    'manager-flow-administrator',
    'manager-account',
    'manager-security',
    'manager-resource',
    'manager-encryption',
    'manager-environment',
    'manager-email',
    'manager-notification',
    'manager-support'
  )),
  "delegatedByUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "recipientUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN (
    'pending', 'accepted', 'rejected', 'withdrawn', 'renounced'
  )),
  "assignmentId" TEXT REFERENCES "corporateRoleAssignments" ("id") ON DELETE SET NULL,
  "createdAt" BIGINT NOT NULL,
  "respondedAt" BIGINT,
  "updatedAt" BIGINT NOT NULL,
  CHECK ("delegatedByUserId" <> "recipientUserId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_corporateRoleDelegations_pending"
  ON "corporateRoleDelegations" ("recipientUserId", "profileId")
  WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "idx_corporateRoleDelegations_recipient"
  ON "corporateRoleDelegations" ("recipientUserId", "status", "createdAt" DESC);
`,
  },
  {
    version: 39,
    name: "company-head-bootstrap-and-verified-email-change",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS "corporateBootstrapState" (
  "id" TEXT PRIMARY KEY CHECK ("id" = 'company_head'),
  "claimedByUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "claimedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "emailChangeChallenges" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE,
  "newEmail" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_emailChangeChallenges_expiry"
  ON "emailChangeChallenges" ("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_emailChangeChallenges_new_email"
  ON "emailChangeChallenges" ("newEmail");
`,
  },
];

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "schemaMigrations" (
      "version" INTEGER PRIMARY KEY,
      "name" TEXT NOT NULL,
      "appliedAt" BIGINT NOT NULL
    )
  `);
}

export async function runPostgresMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [1_480_977_583]);
    await ensureMigrationTable(client);
    const applied = await client.query<{ version: number }>(
      'SELECT "version" FROM "schemaMigrations"',
    );
    const versions = new Set(applied.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (versions.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO "schemaMigrations" ("version", "name", "appliedAt") VALUES ($1, $2, $3)',
        [migration.version, migration.name, Date.now()],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function postgresMigrationVersions(): number[] {
  return migrations.map((migration) => migration.version);
}

export function postgresMigrationSql(): string[] {
  return migrations.map((migration) => migration.sql);
}

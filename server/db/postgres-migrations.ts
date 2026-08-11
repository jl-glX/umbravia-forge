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
  "facilityId" TEXT NOT NULL DEFAULT 'primary',
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
  "facilityId" TEXT NOT NULL DEFAULT 'primary',
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
  "slug" TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_status" ON "supportKnowledgeArticles" ("status", "category", "updatedAt" DESC);

INSERT INTO "facilityProfiles" ("id", "name", "logoDataUrl", "accentColor", "updatedAt")
VALUES ('primary', 'Centro Umbravia Forge', '', '#2563eb', 0)
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
  "sourceFacilityId" TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS "parentalControls" (
  "id" TEXT PRIMARY KEY,
  "childUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "guardianUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "settings" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL CHECK ("status" IN ('parental_control_inactive','parental_control_pending','parental_control_active','parental_control_under_review','parental_control_transitioning','parental_control_ended')),
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  UNIQUE ("childUserId", "guardianUserId")
);

CREATE TABLE IF NOT EXISTS "moderationCases" (
  "id" TEXT PRIMARY KEY,
  "reporterUserId" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "subjectUserId" TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "messageId" TEXT REFERENCES "communityMessages" ("id") ON DELETE SET NULL,
  "facilityId" TEXT NOT NULL DEFAULT 'primary',
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
  ON "moderationCases" ("status", "urgency", "createdAt" DESC);

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
  "facilityId" TEXT NOT NULL DEFAULT 'primary',
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
  "facilityId" TEXT NOT NULL DEFAULT 'primary',
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
  "slug" TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS "idx_supportKnowledge_status" ON "supportKnowledgeArticles" ("status", "category", "updatedAt" DESC);
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
  ('primary', 'primary', 'Centro Umbravia Forge', '', '#2563eb', 'active', 0, 0)
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
  'primary:' || "id",
  'primary',
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
  WHERE membership."facilityId" = 'primary'
    AND membership."status" = 'active'
    AND account."role" = 'admin'
  ORDER BY account."createdAt" ASC, account."id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1
  FROM "facilityMemberships"
  WHERE "facilityId" = 'primary'
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
  ADD COLUMN IF NOT EXISTS "facilityId" TEXT NOT NULL DEFAULT 'primary';

ALTER TABLE "gymClasses"
  ADD CONSTRAINT "gymClasses_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facilityProfiles" ("id")
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "idx_gymClasses_facility_scheduled"
  ON "gymClasses" ("facilityId", "scheduledAt");
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

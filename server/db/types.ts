import type { Generated } from "kysely";

interface User {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  lastName: Generated<string>;
  countryCode: Generated<string>;
  locale: Generated<string>;
  accountStatus: Generated<
    "pending_verification" | "active" | "security_review"
  >;
  emailVerifiedAt: Generated<number | null>;
  termsVersion: Generated<string>;
  termsAcceptedAt: Generated<number | null>;
  privacyVersion: Generated<string>;
  privacyAcceptedAt: Generated<number | null>;
  avatarDataUrl: string;
  password: string;
  role: "member" | "trainer" | "admin";
  sessionIdleTimeoutMinutes: number;
  createdAt: number;
}

interface AccountSupportIdentifier {
  id: string;
  userId: string;
  publicId: string;
  status: "active" | "revoked";
  rotationReason:
    | "account_recovery"
    | "security_incident"
    | "administrative_correction"
    | null;
  createdAt: number;
  revokedAt: number | null;
}

interface EmailVerificationChallenge {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
}

interface AccountRecoveryChallenge {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
}

interface EmailDelivery {
  id: string;
  userId: string | null;
  kind:
    | "email_verification"
    | "account_recovery"
    | "support_update"
    | "security_notice";
  recipient: string;
  locale: string;
  payloadEncrypted: string;
  status: "queued" | "processing" | "retry" | "sent" | "failed" | "superseded";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  messageId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  expiresAt: number;
}

interface AntiAutomationChallenge {
  id: string;
  action: "login" | "signup" | "recovery" | "form_access" | "feedback";
  nonce: string;
  difficulty: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

interface AccountDeletionPreference {
  userId: string;
  inactivityMonths: number | null;
  lastMeaningfulActivityAt: number;
  updatedAt: number;
}

interface AccountDeletionRequest {
  id: string;
  userId: string;
  trigger: "manual" | "inactivity";
  status: "scheduled" | "cancelled" | "processing" | "completed";
  requestedAt: number;
  graceEndsAt: number;
  cancelledAt: number | null;
  completedAt: number | null;
}

interface AccountDeletionJob {
  id: string;
  requestId: string;
  userId: string;
  status: "planned" | "blocked_retention_review" | "cancelled" | "completed";
  executionEnabled: 0 | 1;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface AccountDataDeletionDraft {
  userId: string;
  selectedCategories: string;
  intent: "selected_data" | "account_closure";
  updatedAt: number;
}

interface AccountRepresentative {
  id: string;
  ownerUserId: string;
  representativeUserId: string;
  scopes: string;
  reason:
    | "hospitalization"
    | "temporary_incapacity"
    | "permanent_incapacity"
    | "death_contingency"
    | "other";
  status: "draft" | "pending_review" | "approved" | "revoked" | "expired";
  startsAt: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

interface DataRetentionPolicy {
  id: string;
  name: string;
  jurisdiction: string;
  dataCategory: string;
  retentionDays: number | null;
  legalBasisReference: string;
  status: "draft" | "active" | "retired";
  version: number;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface DataRetentionRecord {
  id: string;
  userId: string | null;
  policyId: string;
  sourceType: string;
  sourceId: string;
  status: "retained" | "legal_hold" | "scheduled_deletion" | "released";
  retainUntil: number | null;
  createdAt: number;
  updatedAt: number;
  releasedAt: number | null;
}

interface GymClass {
  id: string;
  facilityId: Generated<string>;
  name: string;
  description: string;
  trainerId: string;
  trainerName: string;
  maxCapacity: number;
  scheduledAt: number;
}

interface ClassBookingConfiguration {
  classId: string;
  configuration: string;
  lifecycleState: "active" | "suspended" | "cancelled";
  seriesId: string | null;
  updatedAt: number;
}

export type BookingLifecycleStatus =
  | "requested"
  | "confirmed"
  | "confirmation_pending"
  | "uncertain"
  | "waitlisted"
  | "promoted"
  | "promotion_expired"
  | "cancelled_on_time"
  | "cancelled_neutral"
  | "cancelled_late"
  | "attended"
  | "absent"
  | "excused";

export type AttendanceIntention = "unanswered" | "yes" | "no" | "uncertain";

interface Booking {
  id: string;
  classId: string;
  userId: string;
  status: "confirmed" | "cancelled" | "waitlist";
  createdAt: number;
  cancelledAt: number | null;
}

interface BookingLifecycle {
  bookingId: string;
  lifecycleStatus: BookingLifecycleStatus;
  attendanceIntention: AttendanceIntention;
  intentionUpdatedAt: number | null;
  confirmedAt: number | null;
  lastReminderAt: number | null;
  reminderCount: number;
  updatedAt: number;
}

interface WaitlistEntry {
  id: string;
  classId: string;
  userId: string;
  position: number;
  createdAt: number;
  promotedAt: number | null;
  promotionExpiresAt: number | null;
}

export type BookingReputationEventType =
  | "attended"
  | "confirmed_attended"
  | "cancelled_on_time"
  | "cancelled_neutral"
  | "cancelled_late"
  | "absent"
  | "excused"
  | "uncertain"
  | "penalty_cleared"
  | "manual_adjustment";

interface BookingReputation {
  facilityId: string;
  userId: string;
  score: number;
  penaltyUntil: number | null;
  updatedAt: number;
}

interface BookingReputationEvent {
  id: string;
  facilityId: string;
  userId: string;
  bookingId: string | null;
  type: BookingReputationEventType;
  pointsDelta: number;
  reason: string;
  createdAt: number;
}

export type SessionBlockType =
  | "warmup"
  | "mobility"
  | "strength"
  | "technique"
  | "conditioning"
  | "main"
  | "cooldown"
  | "custom";

export interface SessionContentBlock {
  id: string;
  type: SessionBlockType;
  title: string;
  instructions: string;
  exercises: string[];
  sets: string;
  repetitions: string;
  duration: string;
  rest: string;
  percentage: string;
  load: string;
  material: string[];
  adaptations: string;
  mediaUrls: string[];
  notes: string;
}

interface ClassSessionContent {
  classId: string;
  terminology: string;
  blocks: string;
  commentsEnabled: number;
  updatedAt: number;
}

interface SessionContentProgress {
  classId: string;
  userId: string;
  completedBlockIds: string;
  notes: string;
  updatedAt: number;
}

interface Session {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  userAgent: string;
  remembered: number;
  formVerifiedAt: number;
}

interface MfaCredential {
  userId: string;
  secretEncrypted: string;
  recoveryCodeHashes: string;
  createdAt: number;
  updatedAt: number;
  enabledAt: number | null;
}

interface AuthChallenge {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  rememberDevice: number;
}

interface PasskeyCredential {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports: string;
  deviceType: string;
  backedUp: number;
  createdAt: number;
}

interface WebauthnChallenge {
  id: string;
  userId: string;
  challenge: string;
  type: "registration" | "authentication";
  rememberDevice: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

interface SecurityEvent {
  id: string;
  userId: string | null;
  type: string;
  createdAt: number;
  metadata: string;
}

interface Feedback {
  id: string;
  userId: string | null;
  category: "suggestion" | "problem" | "accessibility" | "other";
  message: string;
  status: "new" | "reviewed" | "closed";
  createdAt: number;
}

export type SupportTicketStatus =
  "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

interface SupportTicket {
  id: string;
  publicId: string;
  facilityId: string;
  requesterUserId: string;
  assigneeUserId: string | null;
  subject: string;
  category:
    "account" | "billing" | "reservations" | "technical" | "safety" | "general";
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  source: "web" | "api" | "system";
  relatedType: string | null;
  relatedId: string | null;
  context: string;
  firstResponseDueAt: number;
  resolutionDueAt: number;
  firstRespondedAt: number | null;
  resolvedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface SupportAgent {
  id: string;
  facilityId: string;
  userId: string;
  role: "agent" | "manager";
  active: number;
  createdAt: number;
  updatedAt: number;
}

interface SupportMessage {
  id: string;
  ticketId: string;
  authorUserId: string | null;
  visibility: "requester" | "internal";
  body: string;
  createdAt: number;
}

interface SupportAttachment {
  id: string;
  ticketId: string;
  messageId: string | null;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  checksumSha256: string;
  createdAt: number;
}

interface SupportEvent {
  id: string;
  ticketId: string;
  actorUserId: string | null;
  type: string;
  metadata: string;
  createdAt: number;
}

interface SupportKnowledgeArticle {
  id: string;
  facilityId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  status: "draft" | "published" | "archived";
  authorUserId: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

interface BillingRecord {
  id: string;
  facilityId: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  concept: string;
  billingCycle:
    "monthly" | "quarterly" | "semiannual" | "annual" | "trial_day" | "custom";
  customCycleLabel: string;
  amountCents: number;
  currency: string;
  status: "paid" | "unpaid" | "pending";
  dueAt: number | null;
  paidAt: number | null;
  invoiceNumber: string | null;
  notes: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface SocialProfile {
  userId: string;
  username: string;
  bio: string;
  displayRealName: number;
  birthDate: string | null;
  privacy: string;
  createdAt: number;
  updatedAt: number;
}

interface InternalContact {
  id: string;
  requesterUserId: string;
  recipientUserId: string;
  status:
    | "contact_requested"
    | "contact_accepted"
    | "contact_rejected"
    | "contact_blocked"
    | "contact_removed";
  createdAt: number;
  updatedAt: number;
}

interface E2eeDevice {
  id: string;
  userId: string;
  clientDeviceId: string;
  registrationId: number;
  identityKey: string;
  signedPrekeyId: number;
  signedPrekey: string;
  signedPrekeySignature: string;
  capabilityVersion: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

interface E2eeOneTimePrekey {
  deviceId: string;
  keyId: number;
  publicKey: string;
  createdAt: number;
  consumedAt: number | null;
  consumedByDeviceId: string | null;
}

interface E2eeConversation {
  id: string;
  participantAUserId: string;
  participantBUserId: string;
  createdAt: number;
  updatedAt: number;
}

interface E2eeEnvelope {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  clientMessageId: string;
  envelopeType: "prekey" | "signal";
  ciphertext: string;
  associatedData: string;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  expiresAt: number | null;
}

interface E2eeAttachment {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  clientAttachmentId: string;
  storageKey: string;
  sizeBytes: number;
  checksumSha256: string;
  associatedData: string;
  createdAt: number;
  downloadedAt: number | null;
  expiresAt: number | null;
}

interface CommunityChannel {
  id: string;
  scope: "facility" | "class" | "community";
  scopeId: string;
  name: string;
  status:
    | "community_active"
    | "community_read_only"
    | "community_suspended"
    | "community_closed";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface CommunityMessage {
  id: string;
  channelId: string;
  authorUserId: string;
  parentId: string | null;
  body: string;
  protectedBody: string | null;
  kind: "public" | "private_justification";
  pinned: number;
  status: "active" | "reported" | "removed";
  createdAt: number;
  updatedAt: number;
}

interface CommunityAttachment {
  id: string;
  channelId: string;
  messageId: string | null;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  checksumSha256: string;
  createdAt: number;
}

interface CommunityMember {
  channelId: string;
  userId: string;
  role: "owner" | "member";
  createdAt: number;
}

interface FacilityLink {
  id: string;
  sourceFacilityId: string;
  targetFacilityName: string;
  reason: string;
  mode: "temporary" | "permanent";
  sharedSpaces: string;
  status:
    | "facility_link_requested"
    | "facility_link_accepted"
    | "facility_link_rejected"
    | "facility_link_active"
    | "facility_link_suspended"
    | "facility_link_expired"
    | "facility_link_terminated";
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface ParentalControl {
  id: string;
  childUserId: string;
  guardianUserId: string;
  settings: string;
  status:
    | "parental_control_inactive"
    | "parental_control_pending"
    | "parental_control_active"
    | "parental_control_under_review"
    | "parental_control_transitioning"
    | "parental_control_ended";
  createdAt: number;
  updatedAt: number;
}

interface ModerationCase {
  id: string;
  reporterUserId: string;
  subjectUserId: string | null;
  messageId: string | null;
  facilityId: string;
  category: string;
  description: string;
  evidence: string;
  urgency: "normal" | "high" | "critical";
  status: "open" | "in_review" | "resolved" | "rejected" | "appeal_open";
  resolution: string;
  createdAt: number;
  updatedAt: number;
}

interface ModerationAction {
  id: string;
  caseId: string;
  actorUserId: string;
  subjectUserId: string;
  state:
    | "unrestricted"
    | "muted"
    | "removed_from_chat"
    | "temporarily_blocked"
    | "blocked_by_facility"
    | "under_central_review"
    | "appeal_open"
    | "platform_suspended";
  reason: string;
  durationMinutes: number | null;
  createdAt: number;
}

interface ModerationAppeal {
  id: string;
  caseId: string;
  appellantUserId: string;
  context: string;
  evidence: string;
  status: "open" | "accepted" | "rejected";
  resolution: string;
  createdAt: number;
  updatedAt: number;
}

interface FacilityProfile {
  id: string;
  slug: Generated<string>;
  name: string;
  logoDataUrl: string;
  accentColor: string;
  status: Generated<"active" | "suspended" | "closed">;
  createdAt: Generated<number>;
  updatedAt: number;
}

export type FacilityRole = "owner" | "admin" | "trainer" | "member";

interface FacilityMembership {
  id: string;
  facilityId: string;
  userId: string;
  role: FacilityRole;
  status: "active" | "invited" | "suspended" | "left";
  createdAt: number;
  updatedAt: number;
}

export type CommercialFacilityType =
  | "traditional_gym"
  | "crossfit"
  | "hyrox"
  | "functional_training"
  | "personal_training"
  | "powerlifting"
  | "strongman"
  | "bodybuilding"
  | "martial_arts"
  | "yoga"
  | "pilates"
  | "indoor_cycling"
  | "multidisciplinary"
  | "custom";

export type CommercialTrialStatus =
  | "trial_created"
  | "trial_active"
  | "trial_paused_support"
  | "trial_conversion_review"
  | "trial_expired"
  | "trial_converted"
  | "trial_closed";

export type RealDataDeclaration = "undeclared" | "yes" | "no" | "assistance";

interface CommercialTrial {
  id: string;
  ownerUserId: string;
  facilityName: string;
  facilityType: CommercialFacilityType;
  approximateMembers: number | null;
  trainerCount: number | null;
  spaceCount: number | null;
  usualCapacity: number | null;
  classTypes: string;
  scheduleNotes: string;
  locale: "es" | "en" | "de" | "de-CH";
  currency: string;
  usesBookings: number;
  usesWaitlist: number;
  templateKey: string;
  status: CommercialTrialStatus;
  subdomain: string;
  realDataDeclaration: RealDataDeclaration;
  conversionDraft: string;
  startedAt: number;
  expiresAt: number;
  pausedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface CommercialRequest {
  id: string;
  trialId: string;
  requesterUserId: string;
  kind: "commercial_contact" | "support" | "problem";
  status: Generated<"open" | "in_review" | "resolved" | "cancelled">;
  name: string;
  facilityName: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  preferredChannel: "email" | "phone" | "whatsapp";
  preferredTime: string;
  contactConsent: number;
  includeEnvironmentSummary: number;
  environmentSummary: string | null;
  problemCategory: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

interface CommercialTrialEvent {
  id: string;
  trialId: string;
  actorUserId: string;
  type: string;
  metadata: string;
  createdAt: number;
}

interface DelegationGrant {
  id: string;
  ownerUserId: string;
  delegateUserId: string | null;
  tokenHash: string;
  tokenPreview: string;
  scope: "bookings";
  duration: "24h" | "7d" | "30d" | "indefinite";
  expiresAt: number | null;
  createdAt: number;
  redeemedAt: number | null;
  revokedAt: number | null;
  ownerHiddenAt: number | null;
  delegateHiddenAt: number | null;
}

export interface Database {
  users: User;
  accountSupportIdentifiers: AccountSupportIdentifier;
  emailVerificationChallenges: EmailVerificationChallenge;
  accountRecoveryChallenges: AccountRecoveryChallenge;
  emailDeliveries: EmailDelivery;
  antiAutomationChallenges: AntiAutomationChallenge;
  accountDeletionPreferences: AccountDeletionPreference;
  accountDeletionRequests: AccountDeletionRequest;
  accountDeletionJobs: AccountDeletionJob;
  accountDataDeletionDrafts: AccountDataDeletionDraft;
  accountRepresentatives: AccountRepresentative;
  dataRetentionPolicies: DataRetentionPolicy;
  dataRetentionRecords: DataRetentionRecord;
  gymClasses: GymClass;
  classBookingConfigurations: ClassBookingConfiguration;
  bookings: Booking;
  bookingLifecycles: BookingLifecycle;
  waitlistEntries: WaitlistEntry;
  bookingReputations: BookingReputation;
  bookingReputationEvents: BookingReputationEvent;
  classSessionContents: ClassSessionContent;
  sessionContentProgress: SessionContentProgress;
  sessions: Session;
  mfaCredentials: MfaCredential;
  authChallenges: AuthChallenge;
  passkeyCredentials: PasskeyCredential;
  webauthnChallenges: WebauthnChallenge;
  securityEvents: SecurityEvent;
  feedback: Feedback;
  supportTickets: SupportTicket;
  supportAgents: SupportAgent;
  supportMessages: SupportMessage;
  supportAttachments: SupportAttachment;
  supportEvents: SupportEvent;
  supportKnowledgeArticles: SupportKnowledgeArticle;
  billingRecords: BillingRecord;
  socialProfiles: SocialProfile;
  internalContacts: InternalContact;
  e2eeDevices: E2eeDevice;
  e2eeOneTimePrekeys: E2eeOneTimePrekey;
  e2eeConversations: E2eeConversation;
  e2eeEnvelopes: E2eeEnvelope;
  e2eeAttachments: E2eeAttachment;
  communityChannels: CommunityChannel;
  communityMessages: CommunityMessage;
  communityAttachments: CommunityAttachment;
  communityMembers: CommunityMember;
  facilityLinks: FacilityLink;
  parentalControls: ParentalControl;
  moderationCases: ModerationCase;
  moderationActions: ModerationAction;
  moderationAppeals: ModerationAppeal;
  facilityProfiles: FacilityProfile;
  facilityMemberships: FacilityMembership;
  commercialTrials: CommercialTrial;
  commercialTrialEvents: CommercialTrialEvent;
  commercialRequests: CommercialRequest;
  delegationGrants: DelegationGrant;
}

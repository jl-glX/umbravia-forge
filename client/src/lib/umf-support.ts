import { authFetch } from "./api";

const API_BASE = import.meta.env.VITE_API_URL || "";

export type UmfSupportRole = "director" | "agent";
export type UmfTicketStatus =
  "open" | "in_progress" | "waiting_on_requester" | "resolved" | "closed";
export type UmfTicketPriority = "low" | "normal" | "high" | "urgent";
export type UmfTicketCategory =
  "account" | "billing" | "privacy" | "technical" | "security" | "general";

export interface UmfSupportCapabilities {
  role: UmfSupportRole;
  workspaceName: string | null;
  canManageAdministrators: boolean;
  canManageCollaborationSpaces: boolean;
  canManageCommercialTrials: boolean;
  commercialTrialProvisioningEnabled: boolean;
  operationalWorkspaceEnabled: boolean;
  isPlatformHead: boolean;
  email: {
    outbound: boolean;
    inbound: boolean;
    address: string | null;
    addressConfigured: boolean;
    configurationValid: boolean;
    outboundState: "configured" | "disabled" | "missing" | "invalid";
    queueState: "configured" | "development_fallback" | "missing" | "invalid";
    inboundState: "configured" | "disabled" | "invalid";
    outboundOperationallyVerified: boolean;
    inboundOperationallyVerified: boolean;
  };
  deliveryOperationallyVerified: boolean;
}

export interface CommercialTrialAdministratorAccount {
  userId: string;
  name: string;
  lastName: string;
  email: string;
  accountStatus: "pending_verification" | "active" | "security_review";
  emailVerifiedAt: number | null;
  emailAssessment: "real" | "fictitious" | "indeterminate";
  createdAt: number;
  pendingProvisioning: {
    facilityName: string;
    facilityType: string;
  } | null;
  deletionRequest: {
    status: "scheduled";
    requestedAt: number;
    graceEndsAt: number;
  } | null;
  trial: {
    id: string;
    facilityName: string;
    facilityType: string;
    status: string;
    realDataDeclaration: string;
    startedAt: number;
    expiresAt: number;
  } | null;
}

export interface CommercialAccountMetrics {
  measuredAt: number;
  activeAdministratorAccounts: number;
  pendingVerificationAccounts: number;
  activeTrials: number;
  abandonedTrials: number;
  deletedAdministratorAccounts: number;
  historicalCoverage: "from_schema_v52";
  firstRetainedFactAt: number | null;
}

export interface UmfSupportDistribution {
  stage: "production";
  channel: "web";
  path: "/umf-support/access";
  available: boolean;
  installer: null;
}

export interface UmfSupportIdentityUser {
  id: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: "admin";
  accountStatus: "pending_verification" | "active" | "security_review";
  identityRealm: "corporate_support";
}

export interface UmfSupportSessionUser extends UmfSupportIdentityUser {
  accessApproved: boolean;
}

export interface UmfSupportAccessRequest {
  id: string;
  email: string;
  name: string;
  lastName: string;
  requestedRole: UmfSupportRole;
  locale: string;
  status: "pending" | "approved" | "rejected" | "activated" | "expired";
  activationExpiresAt: number | null;
  createdAt: number;
}

export interface UmfSupportStaffMember {
  userId: string;
  name: string;
  lastName: string;
  email: string;
  role: UmfSupportRole;
  workspaceName: string | null;
  status: "active" | "revoked";
  createdAt: number;
}

export interface UmfSupportAdministratorAccount {
  userId: string;
  name: string;
  lastName: string;
  email: string;
  accountStatus: "pending_verification" | "active" | "security_review";
  emailVerifiedAt: number | null;
  createdAt: number;
  role: UmfSupportRole | null;
  staffStatus: "active" | "revoked" | null;
}

export interface UmfSupportCollaborationSpace {
  id: string;
  name: string;
  description: string;
  visibility: "hidden" | "staff";
  status: "draft" | "published";
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export interface UmfSupportTicketSummary {
  id: string;
  publicId: string;
  requesterEmail: string;
  requesterName: string;
  organizationName: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  subject: string;
  category: UmfTicketCategory;
  priority: UmfTicketPriority;
  status: UmfTicketStatus;
  source: "web" | "email" | "internal";
  firstResponseDueAt: number;
  resolutionDueAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface UmfSupportMessage {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  channel: "web" | "email";
  sender: string;
  recipient: string;
  body: string;
  deliveryStatus: string | null;
  authorName: string | null;
  createdAt: number;
}

export interface UmfSupportTicket extends UmfSupportTicketSummary {
  messages: UmfSupportMessage[];
}

export interface UmfMailboxMessage {
  id: string;
  ticketId: string;
  publicId: string;
  subject: string;
  sender: string;
  recipient: string;
  body: string;
  channel: "web" | "email";
  deliveryStatus: string | null;
  createdAt: number;
}

export type UmfSupportMailStatus =
  | "draft"
  | "scheduled"
  | "outbox"
  | "sent"
  | "partially_failed"
  | "failed"
  | "cancelled";

export interface UmfSupportMailDraft {
  id: string;
  authorUserId: string;
  authorName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  status: UmfSupportMailStatus;
  scheduledAt: number | null;
  sentAt: number | null;
  deliveryIssueCount: number;
  attachments: UmfSupportMailAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface UmfSupportMailAttachment {
  id: string;
  draftId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export type UmfSupportNotificationEvent =
  | "ticket_created"
  | "conversation_received"
  | "inbound_email"
  | "feedback_received"
  | "problem_reported";

export type UmfSupportBrowserFamily =
  "edge" | "firefox" | "brave" | "duckduckgo" | "chrome" | "librewolf";

export interface UmfSupportNotificationSettings {
  enabled: boolean;
  preferences: Record<
    UmfSupportNotificationEvent,
    { email: boolean; push: boolean }
  >;
  push: {
    available: boolean;
    publicKey: string | null;
    devices: Array<{
      id: string;
      browserFamily: UmfSupportBrowserFamily;
      deviceName: string;
      status: "active" | "revoked";
      createdAt: number;
      updatedAt: number;
    }>;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_BASE}/api/umf-support${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok)
    throw new Error(payload.code ?? payload.error ?? "UMF_SUPPORT_FAILED");
  return payload;
}

export function registerSupportAccount(input: {
  email: string;
  name: string;
  lastName: string;
  password: string;
  countryCode: string;
  locale: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  captchaToken: string;
}) {
  return request<{
    user: UmfSupportIdentityUser;
    verificationRequired: true;
    verificationEmailSent: boolean;
  }>("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function verifySupportEmail(code: string) {
  return request<{
    verified: true;
    access: "company_head_approved" | "awaiting_administrator_approval";
  }>("/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export function resendSupportVerification() {
  return request<{ sent: boolean; queued: boolean }>("/resend-verification", {
    method: "POST",
  });
}

export function loginSupport(input: {
  email: string;
  password: string;
  rememberDevice: boolean;
  captchaToken: string;
}) {
  return request<{
    user?: UmfSupportIdentityUser;
    mfaRequired: boolean;
  }>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function verifySupportMfa(code: string) {
  return request<{ user: UmfSupportIdentityUser }>("/mfa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export function beginSupportPasskey(email: string, rememberDevice = false) {
  return request<unknown>("/passkeys/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, rememberDevice }),
  });
}

export function finishSupportPasskey(response: unknown) {
  return request<{ user: UmfSupportIdentityUser }>("/passkeys/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  });
}

export async function fetchSupportSession() {
  return (await request<{ user: UmfSupportSessionUser }>("/session")).user;
}

export function logoutSupport() {
  return request<{ message: string }>("/logout", { method: "POST" });
}

export async function fetchCapabilities() {
  return (
    await request<{ capabilities: UmfSupportCapabilities }>("/capabilities")
  ).capabilities;
}

export function updateWorkspaceName(workspaceName: string) {
  return request<{ workspaceName: string }>("/workspace", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceName }),
  });
}

export async function fetchNotificationSettings() {
  return (
    await request<{ settings: UmfSupportNotificationSettings }>(
      "/notification-settings",
    )
  ).settings;
}

export function updateNotificationSettings(input: {
  enabled: boolean;
  preferences: UmfSupportNotificationSettings["preferences"];
}) {
  return request<{ updated: true }>("/notification-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function registerPushSubscription(input: {
  subscription: PushSubscriptionJSON;
  deviceName: string;
  browserFamily: UmfSupportBrowserFamily;
}) {
  return request<{ id: string }>("/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function revokePushSubscription(subscriptionId: string) {
  return request<{ revoked: true }>(
    `/push-subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE" },
  );
}

export async function fetchTickets(filters?: { status?: string; q?: string }) {
  const query = new URLSearchParams();
  if (filters?.status) query.set("status", filters.status);
  if (filters?.q) query.set("q", filters.q);
  return (
    await request<{ tickets: UmfSupportTicketSummary[] }>(
      `/tickets${query.size ? `?${query.toString()}` : ""}`,
    )
  ).tickets;
}

export async function fetchTicket(ticketId: string) {
  return (
    await request<{ ticket: UmfSupportTicket }>(
      `/tickets/${encodeURIComponent(ticketId)}`,
    )
  ).ticket;
}

export async function createTicket(input: {
  requesterEmail: string;
  requesterName: string;
  organizationName: string;
  subject: string;
  message: string;
  category: UmfTicketCategory;
  priority: UmfTicketPriority;
}) {
  return (
    await request<{ ticket: UmfSupportTicketSummary }>("/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  ).ticket;
}

export async function updateTicket(
  ticketId: string,
  input: {
    status?: UmfTicketStatus;
    priority?: UmfTicketPriority;
    category?: UmfTicketCategory;
    assigneeUserId?: string | null;
  },
) {
  return (
    await request<{ ticket: UmfSupportTicket }>(
      `/tickets/${encodeURIComponent(ticketId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    )
  ).ticket;
}

export async function replyTicket(
  ticketId: string,
  input: { body: string; internal: boolean; sendEmail: boolean },
) {
  return (
    await request<{ ticket: UmfSupportTicket }>(
      `/tickets/${encodeURIComponent(ticketId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    )
  ).ticket;
}

export async function fetchMailbox(direction: "inbound" | "outbound") {
  return (
    await request<{ messages: UmfMailboxMessage[] }>(`/mailbox/${direction}`)
  ).messages;
}

export async function fetchMailDrafts() {
  return (await request<{ drafts: UmfSupportMailDraft[] }>("/mail/drafts"))
    .drafts;
}

export function saveMailDraft(
  input: {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
  },
  draftId?: string,
) {
  return request<{ draft: { id: string } }>(
    draftId ? `/mail/drafts/${encodeURIComponent(draftId)}` : "/mail/drafts",
    {
      method: draftId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function uploadUmfSupportMailAttachment(
  draftId: string,
  file: File,
) {
  const response = await fetch(
    `${API_BASE}/api/umf-support/mail/drafts/${encodeURIComponent(draftId)}/attachments`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": file.name,
      },
      body: file,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    attachment?: UmfSupportMailAttachment;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new Error(payload.code || payload.error || "REQUEST_ERROR");
  }
  return payload.attachment!;
}

export function umfSupportMailAttachmentUrl(
  draftId: string,
  attachmentId: string,
) {
  return `${API_BASE}/api/umf-support/mail/drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function deleteUmfSupportMailAttachment(
  draftId: string,
  attachmentId: string,
) {
  const response = await fetch(
    umfSupportMailAttachmentUrl(draftId, attachmentId),
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new Error(payload.code || payload.error || "REQUEST_ERROR");
  }
}

export function submitMailDraft(draftId: string, scheduledAt?: number) {
  return request<{ queued: true; scheduledAt: number | null }>(
    `/mail/drafts/${encodeURIComponent(draftId)}/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scheduledAt === undefined ? {} : { scheduledAt }),
    },
  );
}

export function cancelScheduledMail(draftId: string) {
  return request<{ cancelled: true }>(
    `/mail/drafts/${encodeURIComponent(draftId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function fetchStaff() {
  return (await request<{ staff: UmfSupportStaffMember[] }>("/staff")).staff;
}

export async function fetchAdministratorAccounts() {
  return (
    await request<{ accounts: UmfSupportAdministratorAccount[] }>(
      "/administrator-accounts",
    )
  ).accounts;
}

export function approveAdministratorAccount(userId: string) {
  return request<void>(
    `/administrator-accounts/${encodeURIComponent(userId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function fetchCommercialTrialAdministratorAccounts() {
  return (
    await request<{ accounts: CommercialTrialAdministratorAccount[] }>(
      "/commercial-trial-administrators",
    )
  ).accounts;
}

export function fetchCommercialAccountMetrics() {
  return request<CommercialAccountMetrics>("/commercial-account-metrics");
}

export function resendCommercialTrialAdministratorVerification(userId: string) {
  return request<{ sent: boolean; queued: boolean }>(
    `/commercial-trial-administrators/${encodeURIComponent(userId)}/resend-verification`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export function updateCommercialTrialFromSupport(
  trialId: string,
  action: "resume" | "cancel",
) {
  return request<void>(
    `/commercial-trials/${encodeURIComponent(trialId)}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
}

export function deleteCommercialTrialFromSupport(
  trialId: string,
  confirmation: string,
) {
  return request<{ deleted: true; accountDeleted: false }>(
    `/commercial-trials/${encodeURIComponent(trialId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }),
    },
  );
}

export async function fetchCollaborationSpaces() {
  return (
    await request<{ spaces: UmfSupportCollaborationSpace[] }>(
      "/collaboration-spaces",
    )
  ).spaces;
}

export function createCollaborationSpace(input: {
  name: string;
  description: string;
}) {
  return request<{ space: UmfSupportCollaborationSpace }>(
    "/collaboration-spaces",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function updateCollaborationSpace(
  spaceId: string,
  input: {
    visibility: "hidden" | "staff";
    status: "draft" | "published";
  },
) {
  return request<void>(`/collaboration-spaces/${encodeURIComponent(spaceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateStaff(
  userId: string,
  input: { role: UmfSupportRole; status: "active" | "revoked" },
) {
  return request<void>(`/staff/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

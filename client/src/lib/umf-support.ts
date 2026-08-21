import { authFetch } from "./api";

const API_BASE = import.meta.env.VITE_API_URL || "";

export type UmfSupportRole = "director" | "agent";
export type CompanyPosition =
  | "platform_head"
  | "area_head"
  | "team_lead"
  | "staff"
  | "external_collaborator";
export type CorporateModuleProfile =
  | "manager-core"
  | "manager-coordinator"
  | "manager-flow-administrator"
  | "manager-account"
  | "manager-security"
  | "manager-resource"
  | "manager-encryption"
  | "manager-environment"
  | "manager-email"
  | "manager-notification"
  | "manager-support";
export type UmfTicketStatus =
  "open" | "in_progress" | "waiting_on_requester" | "resolved" | "closed";
export type UmfTicketPriority = "low" | "normal" | "high" | "urgent";
export type UmfTicketCategory =
  "account" | "billing" | "privacy" | "technical" | "security" | "general";

export interface UmfSupportCapabilities {
  role: UmfSupportRole;
  canReviewAccess: boolean;
  canManageTeam: boolean;
  canManageCompanyRoles: boolean;
  email: {
    outbound: boolean;
    inbound: boolean;
    addressConfigured: boolean;
    configurationValid: boolean;
  };
  deliveryOperationallyVerified: boolean;
}

export interface UmfSupportDistribution {
  stage: "production";
  channel: "web";
  path: "/umf-support/access";
  available: boolean;
  installer: null;
}

export interface UmfSupportSessionUser {
  id: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: "admin";
  accountStatus: "active";
  identityRealm: "corporate_support";
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
  status: "active" | "revoked";
  createdAt: number;
}

export interface CompanyStaffMember {
  userId: string;
  name: string;
  lastName: string;
  email: string;
  position: CompanyPosition;
  reportsToUserId: string | null;
  managerName: string | null;
  managerLastName: string | null;
  status: "active" | "revoked";
  createdAt: number;
}

export interface CompanyRoleDelegation {
  id: string;
  profileId: CorporateModuleProfile;
  recipientUserId: string;
  recipientName: string;
  recipientLastName: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "renounced";
  createdAt: number;
  respondedAt: number | null;
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

export function requestAccess(input: {
  email: string;
  name: string;
  lastName: string;
  requestedRole: UmfSupportRole;
  locale: string;
  captchaToken: string;
}) {
  return request<{ accepted: true }>("/access-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function activateAccount(input: {
  email: string;
  code: string;
  password: string;
  countryCode: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  captchaToken: string;
}) {
  return request<{ user: unknown }>("/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function loginSupport(input: {
  email: string;
  password: string;
  rememberDevice: boolean;
  captchaToken: string;
}) {
  return request<{
    user?: UmfSupportSessionUser;
    mfaRequired: boolean;
  }>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function verifySupportMfa(code: string) {
  return request<{ user: UmfSupportSessionUser }>("/mfa/verify", {
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
  return request<{ user: UmfSupportSessionUser }>("/passkeys/verify", {
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

export async function fetchAccessRequests() {
  return (
    await request<{ requests: UmfSupportAccessRequest[] }>("/access-requests")
  ).requests;
}

export function approveAccess(requestId: string) {
  return request<{
    code: string;
    expiresAt: number;
    delivered: boolean;
    queued: boolean;
  }>(`/access-requests/${encodeURIComponent(requestId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function rejectAccess(requestId: string) {
  return request<void>(
    `/access-requests/${encodeURIComponent(requestId)}/reject`,
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

export async function fetchCompanyStaff() {
  return (await request<{ staff: CompanyStaffMember[] }>("/company-staff"))
    .staff;
}

export function updateCompanyStaff(
  userId: string,
  input: {
    position: Exclude<CompanyPosition, "platform_head">;
    reportsToUserId?: string | null;
    status: "active" | "revoked";
  },
) {
  return request<void>(`/company-staff/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchCompanyRoleDelegations() {
  return (
    await request<{ delegations: CompanyRoleDelegation[] }>(
      "/company-delegations",
    )
  ).delegations;
}

export function delegateCompanyRole(input: {
  profileId: CorporateModuleProfile;
  recipientUserId: string;
}) {
  return request<{ id: string; pending: true }>("/company-delegations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function respondToCompanyRoleDelegation(
  delegationId: string,
  decision: "accept" | "reject",
) {
  return request<{ status: "accepted" | "rejected" }>(
    `/company-delegations/${encodeURIComponent(delegationId)}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

export function renounceCompanyRole(profileId: CorporateModuleProfile) {
  return request<void>(
    `/company-roles/${encodeURIComponent(profileId)}/renounce`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export function selfEnableCompanyRole(profileId: CorporateModuleProfile) {
  return request<void>(
    `/company-roles/${encodeURIComponent(profileId)}/self-enable`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
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

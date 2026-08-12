import { authFetch } from "./api";

const API_BASE = import.meta.env.VITE_API_URL || "";

export type SupportTicketStatus =
  "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export interface SupportTicketSummary {
  id: string;
  publicId: string;
  subject: string;
  category: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  assigneeUserId: string | null;
  requesterName: string;
  assigneeName: string | null;
  firstResponseDueAt: number;
  resolutionDueAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface SupportMessage {
  id: string;
  authorUserId: string | null;
  authorName: string | null;
  authorRole: string | null;
  visibility: "requester" | "internal";
  body: string;
  createdAt: number;
}

export interface SupportAttachment {
  id: string;
  uploadedByUserId: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: number;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  requesterUserId: string;
  context: Record<string, unknown>;
  messages: SupportMessage[];
  attachments: SupportAttachment[];
  events: Array<{
    id: string;
    type: string;
    metadata: string;
    createdAt: number;
  }>;
  staff: boolean;
}

export interface KnowledgeArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  status: "draft" | "published" | "archived";
  updatedAt: number;
  publishedAt: number | null;
}

export interface SupportAgent {
  id: string;
  userId: string;
  role: "agent" | "manager";
  active: number;
  name: string;
  email: string;
}

export interface SupportCapabilities {
  staff: boolean;
  administrator: boolean;
  supportRole: "agent" | "manager" | null;
  canManageKnowledge: boolean;
  canManageTeam: boolean;
}

async function supportRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_BASE}/api/support${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok)
    throw new Error(payload.error || "Forge Support request failed");
  return payload;
}

export async function fetchSupportTickets(filters?: {
  status?: string;
  q?: string;
}): Promise<SupportTicketSummary[]> {
  const query = new URLSearchParams();
  if (filters?.status) query.set("status", filters.status);
  if (filters?.q) query.set("q", filters.q);
  const suffix = query.size ? `?${query.toString()}` : "";
  const result = await supportRequest<{ tickets: SupportTicketSummary[] }>(
    `/tickets${suffix}`,
  );
  return result.tickets;
}

export async function fetchSupportCapabilities(): Promise<SupportCapabilities> {
  const result = await supportRequest<{ capabilities: SupportCapabilities }>(
    "/capabilities",
  );
  return result.capabilities;
}

export async function fetchSupportTicket(
  id: string,
): Promise<SupportTicketDetail> {
  const result = await supportRequest<{ ticket: SupportTicketDetail }>(
    `/tickets/${encodeURIComponent(id)}`,
  );
  return result.ticket;
}

export async function createSupportTicket(input: {
  subject: string;
  message: string;
  category: string;
  priority: SupportTicketPriority;
  context?: Record<string, unknown>;
}): Promise<SupportTicketSummary> {
  const result = await supportRequest<{ ticket: SupportTicketSummary }>(
    "/tickets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.ticket;
}

export async function addSupportMessage(
  id: string,
  body: string,
  visibility: "requester" | "internal",
): Promise<void> {
  await supportRequest(`/tickets/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, visibility }),
  });
}

export async function updateSupportTicket(
  id: string,
  input: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    assigneeUserId?: string | null;
  },
): Promise<SupportTicketDetail> {
  const result = await supportRequest<{ ticket: SupportTicketDetail }>(
    `/tickets/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.ticket;
}

export async function uploadSupportAttachment(
  ticketId: string,
  file: File,
): Promise<void> {
  const response = await authFetch(
    `${API_BASE}/api/support/tickets/${encodeURIComponent(ticketId)}/attachments`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": file.name,
      },
      body: file,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error || "Attachment upload failed");
}

export function supportAttachmentUrl(
  ticketId: string,
  attachmentId: string,
): string {
  return `${API_BASE}/api/support/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function deleteSupportAttachment(
  ticketId: string,
  attachmentId: string,
): Promise<void> {
  await supportRequest(
    `/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

export async function fetchKnowledgeArticles(
  q = "",
): Promise<KnowledgeArticle[]> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  const result = await supportRequest<{ articles: KnowledgeArticle[] }>(
    `/knowledge${suffix}`,
  );
  return result.articles;
}

export async function saveKnowledgeArticle(input: {
  title: string;
  summary: string;
  body: string;
  category: string;
  status: "draft" | "published" | "archived";
}): Promise<KnowledgeArticle> {
  const result = await supportRequest<{ article: KnowledgeArticle }>(
    "/knowledge",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.article;
}

export async function fetchSupportAgents(): Promise<SupportAgent[]> {
  const result = await supportRequest<{ agents: SupportAgent[] }>("/agents");
  return result.agents;
}

export async function saveSupportAgent(input: {
  userId: string;
  role: "agent" | "manager";
  active: boolean;
}): Promise<void> {
  await supportRequest("/agents", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

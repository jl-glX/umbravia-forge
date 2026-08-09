import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client.js";
import type {
  SupportTicketPriority,
  SupportTicketStatus,
} from "../db/types.js";
import type { AuthenticatedUser } from "../middleware/authorization.js";
import {
  deliverQueuedEmail,
  queueSupportStaffNotificationEmail,
  queueSupportUpdateEmail,
} from "./email-delivery.js";
import { publishManagerSignal } from "./manager-coordinator.js";
import {
  protectPrivateBytes,
  revealPrivateBytes,
} from "../lib/private-content-crypto.js";

export class SupportAccessError extends Error {
  readonly statusCode = 403;
}

export class SupportNotFoundError extends Error {
  readonly statusCode = 404;
}

export class SupportValidationError extends Error {
  readonly statusCode = 400;
}

const categories = new Set([
  "account",
  "billing",
  "reservations",
  "technical",
  "safety",
  "general",
]);
const priorities = new Set<SupportTicketPriority>([
  "low",
  "normal",
  "high",
  "urgent",
]);
const statuses = new Set<SupportTicketStatus>([
  "open",
  "in_progress",
  "waiting_on_user",
  "resolved",
  "closed",
]);
const allowedAttachmentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const slaByPriority: Record<
  SupportTicketPriority,
  { firstResponseMs: number; resolutionMs: number }
> = {
  low: { firstResponseMs: 24 * 60 * 60 * 1000, resolutionMs: 7 * 86400000 },
  normal: { firstResponseMs: 8 * 60 * 60 * 1000, resolutionMs: 3 * 86400000 },
  high: { firstResponseMs: 2 * 60 * 60 * 1000, resolutionMs: 86400000 },
  urgent: { firstResponseMs: 30 * 60 * 1000, resolutionMs: 4 * 60 * 60 * 1000 },
};

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string")
    throw new SupportValidationError(`${name} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SupportValidationError(
      `${name} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new SupportValidationError(
      `Optional text must not exceed ${maxLength} characters`,
    );
  }
  return value.trim();
}

function parseContext(value: unknown): string {
  if (value === undefined) return "{}";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupportValidationError("context must be an object");
  }
  const encoded = JSON.stringify(value);
  if (encoded.length > 8_000)
    throw new SupportValidationError("context is too large");
  return encoded;
}

function isControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
}

function normalizedSearch(value: string | undefined): string {
  const search = value?.trim().slice(0, 120) ?? "";
  if (/[\\%_]/.test(search) || Array.from(search).some(isControlCharacter)) {
    throw new SupportValidationError("Search contains unsupported characters");
  }
  return search;
}

function publicTicketId(): string {
  return `UFS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function supportAgentRole(
  userId: string,
  facilityId = "primary",
): Promise<"agent" | "manager" | null> {
  const row = await db
    .selectFrom("supportAgents")
    .select("role")
    .where("userId", "=", userId)
    .where("facilityId", "=", facilityId)
    .where("active", "=", 1)
    .executeTakeFirst();
  return row?.role ?? null;
}

export async function isSupportStaff(
  auth: AuthenticatedUser,
): Promise<boolean> {
  return (
    auth.role === "admin" || (await supportAgentRole(auth.userId)) !== null
  );
}

export async function getSupportCapabilities(auth: AuthenticatedUser) {
  const supportRole = await supportAgentRole(auth.userId);
  const administrator = auth.role === "admin";
  const staff = administrator || supportRole !== null;

  return {
    staff,
    administrator,
    supportRole: administrator ? "manager" : supportRole,
    canManageKnowledge: staff,
    canManageTeam: administrator,
  };
}

async function requireTicketAccess(auth: AuthenticatedUser, ticketId: string) {
  const ticket = await db
    .selectFrom("supportTickets")
    .selectAll()
    .where("id", "=", ticketId)
    .executeTakeFirst();
  if (!ticket) throw new SupportNotFoundError("Support ticket not found");
  const staff = await isSupportStaff(auth);
  if (!staff && ticket.requesterUserId !== auth.userId) {
    throw new SupportAccessError("Support ticket access denied");
  }
  return { ticket, staff };
}

async function recordSupportEvent(
  ticketId: string,
  actorUserId: string | null,
  type: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insertInto("supportEvents")
    .values({
      id: `support-event-${randomUUID()}`,
      ticketId,
      actorUserId,
      type,
      metadata: JSON.stringify(metadata),
      createdAt: Date.now(),
    })
    .execute();
}

async function notifySupportInbox(
  ticket: { publicId: string; subject: string },
  message: string,
): Promise<void> {
  const email = process.env.SUPPORT_NOTIFICATION_EMAIL?.trim();
  if (!email) return;
  try {
    const deliveryId = await queueSupportStaffNotificationEmail({
      email,
      ticketPublicId: ticket.publicId,
      subject: ticket.subject,
      message,
    });
    void deliverQueuedEmail(deliveryId).catch(() => {
      publishManagerSignal(
        "support",
        "warning",
        "SUPPORT_INBOX_NOTIFICATION_FAILED",
        `Inbox notification for ${ticket.publicId} remains queued.`,
      );
    });
  } catch {
    publishManagerSignal(
      "support",
      "warning",
      "SUPPORT_INBOX_NOTIFICATION_FAILED",
      `Inbox notification for ${ticket.publicId} could not be queued.`,
    );
  }
}

export async function createSupportTicket(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  const subject = requiredText(input.subject, "subject", 160);
  const message = requiredText(input.message, "message", 10_000);
  const category = requiredText(input.category ?? "general", "category", 32);
  const priority = requiredText(
    input.priority ?? "normal",
    "priority",
    16,
  ) as SupportTicketPriority;
  if (!categories.has(category))
    throw new SupportValidationError("Invalid support category");
  if (!priorities.has(priority))
    throw new SupportValidationError("Invalid support priority");
  const now = Date.now();
  const id = `support-ticket-${randomUUID()}`;
  const messageId = `support-message-${randomUUID()}`;
  const sla = slaByPriority[priority];
  const ticket = {
    id,
    publicId: publicTicketId(),
    facilityId: "primary",
    requesterUserId: auth.userId,
    assigneeUserId: null,
    subject,
    category: category as
      | "account"
      | "billing"
      | "reservations"
      | "technical"
      | "safety"
      | "general",
    priority,
    status: "open" as const,
    source: (input.source === "system" && auth.role === "admin"
      ? "system"
      : "web") as "web" | "system",
    relatedType: optionalText(input.relatedType, 64),
    relatedId: optionalText(input.relatedId, 128),
    context: parseContext(input.context),
    firstResponseDueAt: now + sla.firstResponseMs,
    resolutionDueAt: now + sla.resolutionMs,
    firstRespondedAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction().execute(async (transaction) => {
    await transaction.insertInto("supportTickets").values(ticket).execute();
    await transaction
      .insertInto("supportMessages")
      .values({
        id: messageId,
        ticketId: id,
        authorUserId: auth.userId,
        visibility: "requester",
        body: message,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("supportEvents")
      .values({
        id: `support-event-${randomUUID()}`,
        ticketId: id,
        actorUserId: auth.userId,
        type: "ticket_created",
        metadata: JSON.stringify({ priority, category, source: ticket.source }),
        createdAt: now,
      })
      .execute();
  });
  if (priority === "urgent") {
    publishManagerSignal(
      "support",
      "critical",
      "URGENT_SUPPORT_TICKET",
      `${ticket.publicId} requires urgent attention.`,
    );
  } else {
    publishManagerSignal(
      "support",
      "info",
      "SUPPORT_TICKET_CREATED",
      `${ticket.publicId} entered the support queue.`,
    );
  }
  await notifySupportInbox(ticket, message);
  return ticket;
}

export async function listSupportTickets(
  auth: AuthenticatedUser,
  filters: { status?: string; q?: string } = {},
) {
  const staff = await isSupportStaff(auth);
  let query = db
    .selectFrom("supportTickets")
    .leftJoin(
      "users as requester",
      "requester.id",
      "supportTickets.requesterUserId",
    )
    .leftJoin(
      "users as assignee",
      "assignee.id",
      "supportTickets.assigneeUserId",
    )
    .select([
      "supportTickets.id",
      "supportTickets.publicId",
      "supportTickets.subject",
      "supportTickets.category",
      "supportTickets.priority",
      "supportTickets.status",
      "supportTickets.assigneeUserId",
      "supportTickets.firstResponseDueAt",
      "supportTickets.resolutionDueAt",
      "supportTickets.createdAt",
      "supportTickets.updatedAt",
      "requester.name as requesterName",
      "assignee.name as assigneeName",
    ]);
  if (!staff)
    query = query.where("supportTickets.requesterUserId", "=", auth.userId);
  if (filters.status && statuses.has(filters.status as SupportTicketStatus)) {
    query = query.where(
      "supportTickets.status",
      "=",
      filters.status as SupportTicketStatus,
    );
  }
  const search = normalizedSearch(filters.q);
  if (search) {
    query = query.where((expression) =>
      expression.or([
        expression("supportTickets.publicId", "like", `%${search}%`),
        expression("supportTickets.subject", "like", `%${search}%`),
      ]),
    );
  }
  return query.orderBy("supportTickets.updatedAt", "desc").limit(200).execute();
}

export async function getSupportTicket(
  auth: AuthenticatedUser,
  ticketId: string,
) {
  const { ticket, staff } = await requireTicketAccess(auth, ticketId);
  let messageQuery = db
    .selectFrom("supportMessages")
    .leftJoin("users", "users.id", "supportMessages.authorUserId")
    .select([
      "supportMessages.id",
      "supportMessages.authorUserId",
      "supportMessages.visibility",
      "supportMessages.body",
      "supportMessages.createdAt",
      "users.name as authorName",
      "users.role as authorRole",
    ])
    .where("supportMessages.ticketId", "=", ticketId);
  if (!staff)
    messageQuery = messageQuery.where(
      "supportMessages.visibility",
      "=",
      "requester",
    );
  let attachmentQuery = db
    .selectFrom("supportAttachments")
    .leftJoin(
      "supportMessages",
      "supportMessages.id",
      "supportAttachments.messageId",
    )
    .select([
      "supportAttachments.id",
      "supportAttachments.messageId",
      "supportAttachments.fileName",
      "supportAttachments.mimeType",
      "supportAttachments.sizeBytes",
      "supportAttachments.checksumSha256",
      "supportAttachments.createdAt",
    ])
    .where("supportAttachments.ticketId", "=", ticketId);
  if (!staff) {
    attachmentQuery = attachmentQuery.where((expression) =>
      expression.or([
        expression("supportAttachments.messageId", "is", null),
        expression("supportMessages.visibility", "=", "requester"),
      ]),
    );
  }
  const [messages, attachments, events] = await Promise.all([
    messageQuery.orderBy("supportMessages.createdAt", "asc").execute(),
    attachmentQuery.orderBy("supportAttachments.createdAt", "asc").execute(),
    staff
      ? db
          .selectFrom("supportEvents")
          .selectAll()
          .where("ticketId", "=", ticketId)
          .orderBy("createdAt", "asc")
          .execute()
      : Promise.resolve([]),
  ]);
  return {
    ...ticket,
    context: JSON.parse(ticket.context),
    messages,
    attachments,
    events,
    staff,
  };
}

export async function addSupportMessage(
  auth: AuthenticatedUser,
  ticketId: string,
  input: Record<string, unknown>,
) {
  const { ticket, staff } = await requireTicketAccess(auth, ticketId);
  if (ticket.status === "closed")
    throw new SupportValidationError("Closed tickets cannot receive messages");
  const body = requiredText(input.body, "body", 10_000);
  const visibility = input.visibility === "internal" ? "internal" : "requester";
  if (visibility === "internal" && !staff)
    throw new SupportAccessError("Internal notes require support staff access");
  const now = Date.now();
  const message = {
    id: `support-message-${randomUUID()}`,
    ticketId,
    authorUserId: auth.userId,
    visibility: visibility as "internal" | "requester",
    body,
    createdAt: now,
  };
  const nextStatus: SupportTicketStatus = staff
    ? visibility === "requester"
      ? "waiting_on_user"
      : ticket.status
    : "open";
  await db.transaction().execute(async (transaction) => {
    await transaction.insertInto("supportMessages").values(message).execute();
    await transaction
      .updateTable("supportTickets")
      .set({
        status: nextStatus,
        firstRespondedAt:
          staff &&
          visibility === "requester" &&
          ticket.firstRespondedAt === null
            ? now
            : ticket.firstRespondedAt,
        updatedAt: now,
      })
      .where("id", "=", ticketId)
      .execute();
    await transaction
      .insertInto("supportEvents")
      .values({
        id: `support-event-${randomUUID()}`,
        ticketId,
        actorUserId: auth.userId,
        type:
          visibility === "internal" ? "internal_note_added" : "message_added",
        metadata: JSON.stringify({ status: nextStatus, staff }),
        createdAt: now,
      })
      .execute();
  });
  if (staff && visibility === "requester") {
    const requester = await db
      .selectFrom("users")
      .select(["email", "locale"])
      .where("id", "=", ticket.requesterUserId)
      .executeTakeFirst();
    if (requester) {
      try {
        const deliveryId = await queueSupportUpdateEmail({
          userId: ticket.requesterUserId,
          email: requester.email,
          locale: (["es", "en", "de", "de-CH"].includes(requester.locale)
            ? requester.locale
            : "es") as "es" | "en" | "de" | "de-CH",
          ticketPublicId: ticket.publicId,
          subject: ticket.subject,
          message: body,
        });
        void deliverQueuedEmail(deliveryId).catch(() => {
          publishManagerSignal(
            "support",
            "warning",
            "SUPPORT_NOTIFICATION_FAILED",
            `Notification for ${ticket.publicId} remains queued.`,
          );
        });
      } catch {
        publishManagerSignal(
          "support",
          "warning",
          "SUPPORT_NOTIFICATION_FAILED",
          `Notification for ${ticket.publicId} remains unavailable.`,
        );
      }
    }
  } else if (!staff && visibility === "requester") {
    await notifySupportInbox(ticket, body);
  }
  return message;
}

export async function updateSupportTicket(
  auth: AuthenticatedUser,
  ticketId: string,
  input: Record<string, unknown>,
) {
  const { ticket, staff } = await requireTicketAccess(auth, ticketId);
  if (!staff) throw new SupportAccessError("Support staff access required");
  const status =
    input.status === undefined
      ? ticket.status
      : (requiredText(input.status, "status", 32) as SupportTicketStatus);
  const priority =
    input.priority === undefined
      ? ticket.priority
      : (requiredText(input.priority, "priority", 16) as SupportTicketPriority);
  if (!statuses.has(status))
    throw new SupportValidationError("Invalid support status");
  if (!priorities.has(priority))
    throw new SupportValidationError("Invalid support priority");
  const assigneeUserId =
    input.assigneeUserId === null
      ? null
      : (optionalText(input.assigneeUserId, 128) ?? ticket.assigneeUserId);
  if (assigneeUserId) {
    const agent = await db
      .selectFrom("supportAgents")
      .select("id")
      .where("userId", "=", assigneeUserId)
      .where("facilityId", "=", ticket.facilityId)
      .where("active", "=", 1)
      .executeTakeFirst();
    const user = await db
      .selectFrom("users")
      .select("role")
      .where("id", "=", assigneeUserId)
      .executeTakeFirst();
    if (!agent && user?.role !== "admin")
      throw new SupportValidationError(
        "Assignee is not an active support agent",
      );
  }
  const now = Date.now();
  const sla = slaByPriority[priority];
  await db
    .updateTable("supportTickets")
    .set({
      status,
      priority,
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
  await recordSupportEvent(ticketId, auth.userId, "ticket_updated", {
    status,
    priority,
    assigneeUserId: assigneeUserId ?? "",
  });
  return getSupportTicket(auth, ticketId);
}

function attachmentRoot(): string {
  return path.resolve(
    process.env.SUPPORT_STORAGE_DIRECTORY ??
      path.join(
        process.env.DATA_DIRECTORY ?? path.join(process.cwd(), "data"),
        "support-attachments",
      ),
  );
}

export function supportAttachmentLimitBytes(): number {
  const configured = Number.parseInt(
    process.env.SUPPORT_ATTACHMENT_MAX_BYTES ?? "5242880",
    10,
  );
  return Number.isInteger(configured)
    ? Math.min(Math.max(configured, 1024), 10 * 1024 * 1024)
    : 5 * 1024 * 1024;
}

export async function storeSupportAttachment(
  auth: AuthenticatedUser,
  ticketId: string,
  input: {
    body: Buffer;
    fileName: string;
    mimeType: string;
    messageId?: string | null;
  },
) {
  const { staff } = await requireTicketAccess(auth, ticketId);
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.length === 0 ||
    input.body.length > supportAttachmentLimitBytes()
  ) {
    throw new SupportValidationError("Attachment size is invalid");
  }
  if (!allowedAttachmentTypes.has(input.mimeType))
    throw new SupportValidationError("Attachment type is not allowed");
  const fileName = Array.from(requiredText(input.fileName, "fileName", 180))
    .map((character) =>
      character === "\\" || character === "/" || isControlCharacter(character)
        ? "_"
        : character,
    )
    .join("");
  const messageId = input.messageId ?? null;
  if (messageId) {
    const message = await db
      .selectFrom("supportMessages")
      .select(["id", "visibility"])
      .where("id", "=", messageId)
      .where("ticketId", "=", ticketId)
      .executeTakeFirst();
    if (!message)
      throw new SupportValidationError(
        "Attachment message does not belong to the ticket",
      );
    if (!staff && message.visibility === "internal") {
      throw new SupportAccessError(
        "Internal support attachments require staff access",
      );
    }
  }
  const id = `support-attachment-${randomUUID()}`;
  const storageKey = `${randomUUID()}.bin`;
  const root = attachmentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, storageKey);
  const protectedBody = protectPrivateBytes(
    input.body,
    `support-attachment:${id}`,
  );
  await writeFile(target, protectedBody, { flag: "wx", mode: 0o600 });
  try {
    const attachment = {
      id,
      ticketId,
      messageId,
      uploadedByUserId: auth.userId,
      fileName,
      mimeType: input.mimeType,
      sizeBytes: input.body.length,
      storageKey,
      checksumSha256: createHash("sha256").update(input.body).digest("hex"),
      createdAt: Date.now(),
    };
    await db.insertInto("supportAttachments").values(attachment).execute();
    await recordSupportEvent(ticketId, auth.userId, "attachment_added", {
      attachmentId: id,
      sizeBytes: input.body.length,
    });
    return attachment;
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function readSupportAttachment(
  auth: AuthenticatedUser,
  ticketId: string,
  attachmentId: string,
) {
  const { staff } = await requireTicketAccess(auth, ticketId);
  const attachment = await db
    .selectFrom("supportAttachments")
    .leftJoin(
      "supportMessages",
      "supportMessages.id",
      "supportAttachments.messageId",
    )
    .selectAll("supportAttachments")
    .select("supportMessages.visibility as messageVisibility")
    .where("supportAttachments.id", "=", attachmentId)
    .where("supportAttachments.ticketId", "=", ticketId)
    .executeTakeFirst();
  if (!attachment)
    throw new SupportNotFoundError("Support attachment not found");
  if (!staff && attachment.messageVisibility === "internal") {
    throw new SupportAccessError("Support attachment access denied");
  }
  const filePath = path.join(attachmentRoot(), attachment.storageKey);
  const storedBody = await readFile(filePath);
  return {
    attachment,
    body: revealPrivateBytes(storedBody, `support-attachment:${attachment.id}`),
  };
}

export async function listKnowledgeArticles(auth: AuthenticatedUser, q = "") {
  const staff = await isSupportStaff(auth);
  let query = db.selectFrom("supportKnowledgeArticles").selectAll();
  if (!staff) query = query.where("status", "=", "published");
  const search = normalizedSearch(q);
  if (search) {
    query = query.where((expression) =>
      expression.or([
        expression("title", "like", `%${search}%`),
        expression("summary", "like", `%${search}%`),
        expression("body", "like", `%${search}%`),
      ]),
    );
  }
  return query.orderBy("updatedAt", "desc").limit(100).execute();
}

export async function saveKnowledgeArticle(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
  articleId?: string,
) {
  const staff = await isSupportStaff(auth);
  if (!staff) throw new SupportAccessError("Support staff access required");
  const title = requiredText(input.title, "title", 180);
  const summary = requiredText(input.summary, "summary", 500);
  const body = requiredText(input.body, "body", 50_000);
  const category = requiredText(input.category ?? "general", "category", 64);
  const status = requiredText(input.status ?? "draft", "status", 16) as
    "draft" | "published" | "archived";
  if (!["draft", "published", "archived"].includes(status))
    throw new SupportValidationError("Invalid article status");
  const slug = requiredText(
    input.slug ??
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    "slug",
    180,
  );
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new SupportValidationError("Article slug is invalid");
  const now = Date.now();
  const id = articleId ?? `support-article-${randomUUID()}`;
  if (articleId) {
    const existing = await db
      .selectFrom("supportKnowledgeArticles")
      .select(["id", "publishedAt"])
      .where("id", "=", articleId)
      .executeTakeFirst();
    if (!existing)
      throw new SupportNotFoundError("Knowledge article not found");
    await db
      .updateTable("supportKnowledgeArticles")
      .set({
        title,
        summary,
        body,
        category,
        slug,
        status,
        updatedAt: now,
        publishedAt:
          status === "published" ? (existing.publishedAt ?? now) : null,
      })
      .where("id", "=", articleId)
      .execute();
  } else {
    await db
      .insertInto("supportKnowledgeArticles")
      .values({
        id,
        title,
        summary,
        body,
        category,
        slug,
        status,
        authorUserId: auth.userId,
        createdAt: now,
        updatedAt: now,
        publishedAt: status === "published" ? now : null,
      })
      .execute();
  }
  return db
    .selectFrom("supportKnowledgeArticles")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

export async function listSupportAgents(auth: AuthenticatedUser) {
  if (!(await isSupportStaff(auth))) {
    throw new SupportAccessError("Support staff access required");
  }
  return db
    .selectFrom("supportAgents")
    .innerJoin("users", "users.id", "supportAgents.userId")
    .select([
      "supportAgents.id",
      "supportAgents.userId",
      "supportAgents.role",
      "supportAgents.active",
      "supportAgents.createdAt",
      "users.name",
      "users.email",
    ])
    .where("supportAgents.facilityId", "=", "primary")
    .orderBy("users.name")
    .execute();
}

export async function saveSupportAgent(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  if (auth.role !== "admin")
    throw new SupportAccessError("Administrator access required");
  const userId = requiredText(input.userId, "userId", 128);
  const role = requiredText(input.role ?? "agent", "role", 16) as
    "agent" | "manager";
  if (!["agent", "manager"].includes(role))
    throw new SupportValidationError("Invalid support role");
  const user = await db
    .selectFrom("users")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user) throw new SupportValidationError("Support user does not exist");
  const now = Date.now();
  const existing = await db
    .selectFrom("supportAgents")
    .select("id")
    .where("facilityId", "=", "primary")
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable("supportAgents")
      .set({ role, active: input.active === false ? 0 : 1, updatedAt: now })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }
  const id = `support-agent-${randomUUID()}`;
  await db
    .insertInto("supportAgents")
    .values({
      id,
      facilityId: "primary",
      userId,
      role,
      active: input.active === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

export async function auditSupportSla(): Promise<{
  count: number;
  summary: string;
  findings: string[];
}> {
  const now = Date.now();
  const overdue = await db
    .selectFrom("supportTickets")
    .select([
      "publicId",
      "status",
      "firstRespondedAt",
      "firstResponseDueAt",
      "resolutionDueAt",
    ])
    .where("status", "not in", ["resolved", "closed"])
    .where((expression) =>
      expression.or([
        expression("resolutionDueAt", "<", now),
        expression.and([
          expression("firstRespondedAt", "is", null),
          expression("firstResponseDueAt", "<", now),
        ]),
      ]),
    )
    .limit(100)
    .execute();
  if (overdue.length > 0) {
    publishManagerSignal(
      "support",
      "warning",
      "SUPPORT_SLA_AT_RISK",
      `${overdue.length} support ticket(s) exceeded an SLA target.`,
    );
  }
  return {
    count: overdue.length,
    summary: `${overdue.length} support ticket(s) outside an SLA target.`,
    findings: overdue.map((ticket) => `${ticket.publicId}:${ticket.status}`),
  };
}

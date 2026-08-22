import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
import { notifyUmfSupportAdministrators } from "./umf-support-notifications.js";
import { publishManagerSignal } from "./manager-coordinator.js";
import {
  privateContentNeedsRewrap,
  protectPrivateBytes,
  protectPrivateText,
  rewrapPrivateBytes,
  rewrapPrivateText,
  revealPrivateBytes,
  revealPrivateText,
} from "../lib/private-content-crypto.js";
import {
  buildSupportReplyAddress,
  extractUnquotedSupportReply,
  parseSupportEmailRecipient,
  resolveSupportEmailInboundConfiguration,
  verifySupportReplyToken,
  type SupportEmailInboundConfiguration,
  type SupportInboundEmailPayload,
} from "../lib/support-email-inbound.js";
import { getManagedEmailChannelCapabilities } from "./email-manager.js";
import { stageStoredFilesForRemoval } from "../lib/staged-file-removal.js";
import { SUPPORT_DATA_APPLICATION_TENANT_ID } from "../lib/application-tenancy.js";
import { resolveFacilityContext } from "./facility-context.js";

export class SupportAccessError extends Error {
  readonly statusCode = 403;
}

export class SupportNotFoundError extends Error {
  readonly statusCode = 404;
}

export class SupportValidationError extends Error {
  readonly statusCode = 400;
}

class SupportIntegrityError extends Error {
  readonly statusCode = 500;
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

type ProtectedSupportField =
  "ticket-context" | "message-body" | "knowledge-body";

function supportFieldContext(
  field: ProtectedSupportField,
  recordId: string,
): string {
  return `application-tenant:${SUPPORT_DATA_APPLICATION_TENANT_ID}:support:${field}:${recordId}`;
}

function protectSupportText(
  value: string,
  field: ProtectedSupportField,
  recordId: string,
): string {
  return protectPrivateText(value, supportFieldContext(field, recordId));
}

function revealSupportText(
  value: string,
  field: ProtectedSupportField,
  recordId: string,
): string {
  return revealPrivateText(value, supportFieldContext(field, recordId));
}

async function supportAgentRole(
  userId: string,
  facilityId: string,
): Promise<"agent" | "manager" | null> {
  const row = await db
    .selectFrom("supportAgents")
    .select("role")
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
    .where("userId", "=", userId)
    .where("facilityId", "=", facilityId)
    .where("active", "=", 1)
    .executeTakeFirst();
  return row?.role ?? null;
}

function facilityIdFor(auth: AuthenticatedUser): string {
  if (!auth.facility) {
    throw new SupportAccessError("An active facility membership is required");
  }
  return auth.facility.id;
}

function isFacilityAdministrator(auth: AuthenticatedUser): boolean {
  return auth.facility?.role === "owner" || auth.facility?.role === "admin";
}

export async function isSupportStaff(
  auth: AuthenticatedUser,
): Promise<boolean> {
  const facilityId = facilityIdFor(auth);
  return (
    isFacilityAdministrator(auth) ||
    (await supportAgentRole(auth.userId, facilityId)) !== null
  );
}

export async function getSupportCapabilities(auth: AuthenticatedUser) {
  const facilityId = facilityIdFor(auth);
  const supportRole = await supportAgentRole(auth.userId, facilityId);
  const administrator = isFacilityAdministrator(auth);
  const staff = administrator || supportRole !== null;
  const email = getManagedEmailChannelCapabilities("support");

  return {
    staff,
    administrator,
    supportRole: administrator ? "manager" : supportRole,
    canManageKnowledge: staff,
    canManageTeam: administrator,
    email: {
      inbound: email.supportInbound,
      replies: email.supportReplies,
      notifications: email.supportNotifications,
    },
  };
}

async function requireTicketAccess(auth: AuthenticatedUser, ticketId: string) {
  const facilityId = facilityIdFor(auth);
  const ticket = await db
    .selectFrom("supportTickets")
    .selectAll()
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
    .where("id", "=", ticketId)
    .executeTakeFirst();
  if (!ticket) throw new SupportNotFoundError("Support ticket not found");
  const staff =
    ticket.facilityId === facilityId && (await isSupportStaff(auth));
  if (ticket.requesterUserId === auth.userId) {
    return { ticket, staff };
  }
  if (ticket.facilityId !== facilityId) {
    throw new SupportNotFoundError("Support ticket not found");
  }
  if (!staff) {
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
  if (
    email.toLowerCase() ===
    process.env.SUPPORT_EMAIL_ADDRESS?.trim().toLowerCase()
  ) {
    return;
  }
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
        "commercial",
        "warning",
        "SUPPORT_INBOX_NOTIFICATION_FAILED",
        `Inbox notification for ${ticket.publicId} remains queued.`,
      );
    });
  } catch {
    publishManagerSignal(
      "support",
      "commercial",
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
  const facilityId = facilityIdFor(auth);
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
    applicationTenantId: SUPPORT_DATA_APPLICATION_TENANT_ID,
    facilityId,
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
    source: (input.source === "system" && isFacilityAdministrator(auth)
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
    await transaction
      .insertInto("supportTickets")
      .values({
        ...ticket,
        context: protectSupportText(ticket.context, "ticket-context", id),
      })
      .execute();
    await transaction
      .insertInto("supportMessages")
      .values({
        id: messageId,
        ticketId: id,
        authorUserId: auth.userId,
        visibility: "requester",
        body: protectSupportText(message, "message-body", messageId),
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
      "commercial",
      "critical",
      "URGENT_SUPPORT_TICKET",
      `${ticket.publicId} requires urgent attention.`,
    );
  } else {
    publishManagerSignal(
      "support",
      "commercial",
      "info",
      "SUPPORT_TICKET_CREATED",
      `${ticket.publicId} entered the support queue.`,
    );
  }
  await notifySupportInbox(ticket, message);
  void notifyUmfSupportAdministrators({
    event:
      category === "technical" || category === "safety"
        ? "problem_reported"
        : "ticket_created",
    title: `Nuevo aviso ${ticket.publicId}`,
    message: `${ticket.subject} · prioridad ${ticket.priority}`,
    url: "/umf-support",
    excludeUserId: auth.userId,
  }).catch(() => undefined);
  return ticket;
}

export async function listSupportTickets(
  auth: AuthenticatedUser,
  filters: { status?: string; q?: string } = {},
) {
  const facilityId = facilityIdFor(auth);
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
    ])
    .where(
      "supportTickets.applicationTenantId",
      "=",
      SUPPORT_DATA_APPLICATION_TENANT_ID,
    );
  query = staff
    ? query.where((expression) =>
        expression.or([
          expression("supportTickets.facilityId", "=", facilityId),
          expression("supportTickets.requesterUserId", "=", auth.userId),
        ]),
      )
    : query.where("supportTickets.requesterUserId", "=", auth.userId);
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
      "supportAttachments.uploadedByUserId",
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
  const context = revealSupportText(
    ticket.context,
    "ticket-context",
    ticket.id,
  );
  const decodedMessages = messages.map((message) => ({
    ...message,
    body: revealSupportText(message.body, "message-body", message.id),
  }));
  await db.transaction().execute(async (transaction) => {
    if (privateContentNeedsRewrap(ticket.context)) {
      await transaction
        .updateTable("supportTickets")
        .set({
          context: rewrapPrivateText(
            ticket.context,
            supportFieldContext("ticket-context", ticket.id),
          ),
        })
        .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
        .where("id", "=", ticket.id)
        .where("context", "=", ticket.context)
        .execute();
    }
    for (const message of messages) {
      if (!privateContentNeedsRewrap(message.body)) continue;
      await transaction
        .updateTable("supportMessages")
        .set({
          body: rewrapPrivateText(
            message.body,
            supportFieldContext("message-body", message.id),
          ),
        })
        .where("id", "=", message.id)
        .where("body", "=", message.body)
        .execute();
    }
  });
  return {
    ...ticket,
    context: JSON.parse(context),
    messages: decodedMessages,
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
    await transaction
      .insertInto("supportMessages")
      .values({
        ...message,
        body: protectSupportText(body, "message-body", message.id),
      })
      .execute();
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
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
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
        const inboundConfiguration = resolveSupportEmailInboundConfiguration();
        const deliveryId = await queueSupportUpdateEmail({
          userId: ticket.requesterUserId,
          email: requester.email,
          locale: (["es", "en", "de", "de-CH"].includes(requester.locale)
            ? requester.locale
            : "es") as "es" | "en" | "de" | "de-CH",
          ticketPublicId: ticket.publicId,
          subject: ticket.subject,
          message: body,
          replyTo: inboundConfiguration
            ? buildSupportReplyAddress(
                ticket.publicId,
                ticket.requesterUserId,
                inboundConfiguration,
              )
            : undefined,
        });
        void deliverQueuedEmail(deliveryId).catch(() => {
          publishManagerSignal(
            "support",
            "commercial",
            "warning",
            "SUPPORT_NOTIFICATION_FAILED",
            `Notification for ${ticket.publicId} remains queued.`,
          );
        });
      } catch {
        publishManagerSignal(
          "support",
          "commercial",
          "warning",
          "SUPPORT_NOTIFICATION_FAILED",
          `Notification for ${ticket.publicId} remains unavailable.`,
        );
      }
    }
  } else if (!staff && visibility === "requester") {
    await notifySupportInbox(ticket, body);
    void notifyUmfSupportAdministrators({
      event: "conversation_received",
      title: `Nueva respuesta en ${ticket.publicId}`,
      message: ticket.subject,
      url: "/umf-support",
      excludeUserId: auth.userId,
    }).catch(() => undefined);
  }
  return message;
}

function normalizedInboundMailbox(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new SupportValidationError("Inbound sender is not a valid mailbox");
  }
  return normalized;
}

export async function ingestSupportInboundEmail(
  input: SupportInboundEmailPayload,
  configuration: SupportEmailInboundConfiguration,
): Promise<{
  duplicate: boolean;
  ticketPublicId: string;
}> {
  if (input.attachmentCount !== 0) {
    throw new SupportValidationError(
      "Inbound support attachments are not accepted until malware scanning is available",
    );
  }
  const recipient = parseSupportEmailRecipient(input.envelopeTo, configuration);
  if (!recipient) {
    throw new SupportValidationError("Inbound support recipient is invalid");
  }
  const sender = normalizedInboundMailbox(input.from);
  const body = requiredText(
    extractUnquotedSupportReply(input.text),
    "message",
    10_000,
  );

  if (recipient.kind === "new_ticket") {
    const requester = await db
      .selectFrom("users")
      .select([
        "id",
        "email",
        "name",
        "avatarDataUrl",
        "role",
        "accountStatus",
        "emailVerifiedAt",
      ])
      .where("email", "=", sender)
      .where("identityRealm", "=", "commercial")
      .executeTakeFirst();
    if (
      !requester ||
      requester.accountStatus !== "active" ||
      requester.emailVerifiedAt === null
    ) {
      throw new SupportAccessError(
        "Inbound support email requires an active verified account",
      );
    }
    const messageIdHash = createHash("sha256")
      .update(input.messageId.trim().toLowerCase())
      .digest("hex");
    const inboundIdentity = createHash("sha256")
      .update(`${sender}\n${messageIdHash}`)
      .digest("hex");
    const facility = await resolveFacilityContext(requester.id);
    if (!facility) {
      throw new SupportAccessError(
        "Inbound support email requires an active facility membership",
      );
    }
    const now = Date.now();
    const ticket = {
      id: `support-ticket-email-${inboundIdentity}`,
      publicId: publicTicketId(),
      applicationTenantId: SUPPORT_DATA_APPLICATION_TENANT_ID,
      facilityId: facility.id,
      requesterUserId: requester.id,
      assigneeUserId: null,
      subject: requiredText(
        input.subject || "Solicitud recibida por correo",
        "subject",
        160,
      ),
      category: "general" as const,
      priority: "normal" as const,
      status: "open" as const,
      source: "api" as const,
      relatedType: null,
      relatedId: null,
      context: JSON.stringify({ channel: "email" }),
      firstResponseDueAt: now + slaByPriority.normal.firstResponseMs,
      resolutionDueAt: now + slaByPriority.normal.resolutionMs,
      firstRespondedAt: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await db.transaction().execute(async (transaction) => {
      const created = await transaction
        .insertInto("supportTickets")
        .values({
          ...ticket,
          context: protectSupportText(
            ticket.context,
            "ticket-context",
            ticket.id,
          ),
        })
        .onConflict((conflict) => conflict.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!created) return false;
      await transaction
        .insertInto("supportMessages")
        .values({
          id: `support-email-${inboundIdentity}`,
          ticketId: ticket.id,
          authorUserId: requester.id,
          visibility: "requester",
          body: protectSupportText(
            body,
            "message-body",
            `support-email-${inboundIdentity}`,
          ),
          createdAt: now,
        })
        .execute();
      await transaction
        .insertInto("supportEvents")
        .values([
          {
            id: `support-event-${randomUUID()}`,
            ticketId: ticket.id,
            actorUserId: requester.id,
            type: "ticket_created",
            metadata: JSON.stringify({
              priority: "normal",
              category: "general",
              source: "api",
            }),
            createdAt: now,
          },
          {
            id: `support-event-${randomUUID()}`,
            ticketId: ticket.id,
            actorUserId: requester.id,
            type: "email_ticket_received",
            metadata: JSON.stringify({
              channel: "cloudflare_email_worker",
              messageIdHash,
            }),
            createdAt: now,
          },
        ])
        .execute();
      return true;
    });
    if (!inserted) {
      const existing = await db
        .selectFrom("supportTickets")
        .select("publicId")
        .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
        .where("id", "=", ticket.id)
        .executeTakeFirstOrThrow();
      return { duplicate: true, ticketPublicId: existing.publicId };
    }
    publishManagerSignal(
      "support",
      "commercial",
      "info",
      "SUPPORT_EMAIL_TICKET_CREATED",
      `${ticket.publicId} entered the support queue by authenticated email.`,
    );
    await notifySupportInbox(ticket, body);
    return { duplicate: false, ticketPublicId: ticket.publicId };
  }

  const ticket = await db
    .selectFrom("supportTickets")
    .innerJoin(
      "users as requester",
      "requester.id",
      "supportTickets.requesterUserId",
    )
    .select([
      "supportTickets.id as ticketId",
      "supportTickets.publicId as publicId",
      "supportTickets.requesterUserId as requesterUserId",
      "supportTickets.subject as subject",
      "supportTickets.status as status",
      "requester.email as requesterEmail",
      "requester.accountStatus as requesterAccountStatus",
      "requester.emailVerifiedAt as requesterEmailVerifiedAt",
    ])
    .where(
      "supportTickets.applicationTenantId",
      "=",
      SUPPORT_DATA_APPLICATION_TENANT_ID,
    )
    .where("supportTickets.publicId", "=", recipient.publicId)
    .executeTakeFirst();
  if (!ticket) throw new SupportNotFoundError("Support ticket not found");
  if (
    ticket.requesterAccountStatus !== "active" ||
    ticket.requesterEmailVerifiedAt === null ||
    ticket.requesterEmail.toLowerCase() !== sender ||
    !verifySupportReplyToken(recipient, ticket.requesterUserId, configuration)
  ) {
    throw new SupportAccessError("Inbound support reply was not authorized");
  }
  if (ticket.status === "closed") {
    throw new SupportValidationError("Closed tickets cannot receive messages");
  }

  const messageIdHash = createHash("sha256")
    .update(input.messageId.trim().toLowerCase())
    .digest("hex");
  const deterministicMessageId = `support-email-${createHash("sha256")
    .update(`${ticket.ticketId}\n${messageIdHash}`)
    .digest("hex")}`;
  const now = Date.now();
  const inserted = await db.transaction().execute(async (transaction) => {
    const message = await transaction
      .insertInto("supportMessages")
      .values({
        id: deterministicMessageId,
        ticketId: ticket.ticketId,
        authorUserId: ticket.requesterUserId,
        visibility: "requester",
        body: protectSupportText(body, "message-body", deterministicMessageId),
        createdAt: now,
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!message) return false;
    await transaction
      .updateTable("supportTickets")
      .set({ status: "open", updatedAt: now })
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
      .where("id", "=", ticket.ticketId)
      .execute();
    await transaction
      .insertInto("supportEvents")
      .values({
        id: `support-event-${randomUUID()}`,
        ticketId: ticket.ticketId,
        actorUserId: ticket.requesterUserId,
        type: "email_reply_received",
        metadata: JSON.stringify({
          channel: "cloudflare_email_worker",
          messageIdHash,
          status: "open",
        }),
        createdAt: now,
      })
      .execute();
    return true;
  });

  if (!inserted) {
    return { duplicate: true, ticketPublicId: ticket.publicId };
  }
  publishManagerSignal(
    "support",
    "commercial",
    "info",
    "SUPPORT_EMAIL_REPLY_RECEIVED",
    `${ticket.publicId} received an authenticated email reply.`,
  );
  await notifySupportInbox(ticket, body);
  return { duplicate: false, ticketPublicId: ticket.publicId };
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
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
      .where("userId", "=", assigneeUserId)
      .where("facilityId", "=", ticket.facilityId)
      .where("active", "=", 1)
      .executeTakeFirst();
    const membership = await db
      .selectFrom("facilityMemberships")
      .select("role")
      .where("facilityId", "=", ticket.facilityId)
      .where("userId", "=", assigneeUserId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!agent && membership?.role !== "owner" && membership?.role !== "admin")
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
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
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

export function stageSupportAttachmentFilesRemoval(storageKeys: string[]) {
  return stageStoredFilesForRemoval(attachmentRoot(), storageKeys);
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
  const body = revealPrivateBytes(
    storedBody,
    `support-attachment:${attachment.id}`,
  );
  const checksum = createHash("sha256").update(body).digest("hex");
  if (checksum !== attachment.checksumSha256) {
    throw new SupportIntegrityError(
      "Support attachment integrity verification failed",
    );
  }
  if (privateContentNeedsRewrap(storedBody)) {
    const temporary = `${filePath}.rewrap-${randomUUID()}`;
    await writeFile(
      temporary,
      rewrapPrivateBytes(storedBody, `support-attachment:${attachment.id}`),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await rename(temporary, filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  return {
    attachment,
    body,
  };
}

export async function deleteSupportAttachment(
  auth: AuthenticatedUser,
  ticketId: string,
  attachmentId: string,
): Promise<void> {
  const { staff } = await requireTicketAccess(auth, ticketId);
  const attachment = await db
    .selectFrom("supportAttachments")
    .selectAll()
    .where("id", "=", attachmentId)
    .where("ticketId", "=", ticketId)
    .executeTakeFirst();
  if (!attachment)
    throw new SupportNotFoundError("Support attachment not found");
  if (!staff && attachment.uploadedByUserId !== auth.userId)
    throw new SupportAccessError("Support attachment deletion denied");

  const staged = await stageSupportAttachmentFilesRemoval([
    attachment.storageKey,
  ]);
  try {
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom("supportAttachments")
        .where("id", "=", attachment.id)
        .execute();
      await transaction
        .insertInto("supportEvents")
        .values({
          id: `support-event-${randomUUID()}`,
          ticketId,
          actorUserId: auth.userId,
          type: "attachment_removed",
          metadata: JSON.stringify({ attachmentId }),
          createdAt: Date.now(),
        })
        .execute();
    });
  } catch (error) {
    await staged.rollback();
    throw error;
  }
  // Once the database no longer references the attachment, restoring the
  // encrypted file would create an unreachable live copy. A failed physical
  // cleanup therefore remains staged and becomes visible to the coordinator.
  try {
    await staged.commit();
  } catch {
    try {
      publishManagerSignal(
        "support",
        "commercial",
        "warning",
        "SUPPORT_ATTACHMENT_CLEANUP_DEFERRED",
        "Encrypted support attachment cleanup remains staged for maintenance.",
      );
    } catch {
      console.error("Support attachment cleanup remains staged.");
    }
  }
}

export async function listKnowledgeArticles(auth: AuthenticatedUser, q = "") {
  const facilityId = facilityIdFor(auth);
  const staff = await isSupportStaff(auth);
  let query = db
    .selectFrom("supportKnowledgeArticles")
    .selectAll()
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
    .where("facilityId", "=", facilityId);
  if (!staff) query = query.where("status", "=", "published");
  const search = normalizedSearch(q);
  if (search) {
    query = query.where((expression) =>
      expression.or([
        expression("title", "like", `%${search}%`),
        expression("summary", "like", `%${search}%`),
      ]),
    );
  }
  const articles = await query
    .orderBy("updatedAt", "desc")
    .limit(100)
    .execute();
  return Promise.all(
    articles.map(async (article) => {
      const body = revealSupportText(
        article.body,
        "knowledge-body",
        article.id,
      );
      if (privateContentNeedsRewrap(article.body)) {
        await db
          .updateTable("supportKnowledgeArticles")
          .set({
            body: rewrapPrivateText(
              article.body,
              supportFieldContext("knowledge-body", article.id),
            ),
          })
          .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
          .where("id", "=", article.id)
          .where("body", "=", article.body)
          .execute();
      }
      return { ...article, body };
    }),
  );
}

export async function saveKnowledgeArticle(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
  articleId?: string,
) {
  const facilityId = facilityIdFor(auth);
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
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
      .where("id", "=", articleId)
      .where("facilityId", "=", facilityId)
      .executeTakeFirst();
    if (!existing)
      throw new SupportNotFoundError("Knowledge article not found");
    await db
      .updateTable("supportKnowledgeArticles")
      .set({
        title,
        summary,
        body: protectSupportText(body, "knowledge-body", articleId),
        category,
        slug,
        status,
        updatedAt: now,
        publishedAt:
          status === "published" ? (existing.publishedAt ?? now) : null,
      })
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
      .where("id", "=", articleId)
      .where("facilityId", "=", facilityId)
      .execute();
  } else {
    await db
      .insertInto("supportKnowledgeArticles")
      .values({
        id,
        applicationTenantId: SUPPORT_DATA_APPLICATION_TENANT_ID,
        facilityId,
        title,
        summary,
        body: protectSupportText(body, "knowledge-body", id),
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
  const article = await db
    .selectFrom("supportKnowledgeArticles")
    .selectAll()
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
    .where("id", "=", id)
    .where("facilityId", "=", facilityId)
    .executeTakeFirstOrThrow();
  return {
    ...article,
    body: revealSupportText(article.body, "knowledge-body", article.id),
  };
}

export async function listSupportAgents(auth: AuthenticatedUser) {
  const facilityId = facilityIdFor(auth);
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
    .where(
      "supportAgents.applicationTenantId",
      "=",
      SUPPORT_DATA_APPLICATION_TENANT_ID,
    )
    .where("supportAgents.facilityId", "=", facilityId)
    .orderBy("users.name")
    .execute();
}

export async function saveSupportAgent(
  auth: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  const facilityId = facilityIdFor(auth);
  if (!isFacilityAdministrator(auth))
    throw new SupportAccessError("Administrator access required");
  const userId = requiredText(input.userId, "userId", 128);
  const role = requiredText(input.role ?? "agent", "role", 16) as
    "agent" | "manager";
  if (!["agent", "manager"].includes(role))
    throw new SupportValidationError("Invalid support role");
  const membership = await db
    .selectFrom("facilityMemberships")
    .select("id")
    .where("facilityId", "=", facilityId)
    .where("userId", "=", userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!membership)
    throw new SupportValidationError(
      "Support user must be an active facility member",
    );
  const now = Date.now();
  const existing = await db
    .selectFrom("supportAgents")
    .select("id")
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
    .where("facilityId", "=", facilityId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable("supportAgents")
      .set({ role, active: input.active === false ? 0 : 1, updatedAt: now })
      .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }
  const id = `support-agent-${randomUUID()}`;
  await db
    .insertInto("supportAgents")
    .values({
      id,
      applicationTenantId: SUPPORT_DATA_APPLICATION_TENANT_ID,
      facilityId,
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
    .where("applicationTenantId", "=", SUPPORT_DATA_APPLICATION_TENANT_ID)
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
      "commercial",
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

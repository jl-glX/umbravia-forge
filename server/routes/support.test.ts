import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";
import {
  buildSupportReplyAddress,
  resolveSupportEmailInboundConfiguration,
  signSupportEmailWebhook,
} from "../lib/support-email-inbound.js";

describe("Forge Support API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;
  let peerCookie: string;
  let agentCookie: string;
  let ticketId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-support-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("INTERNAL_SUPPORT_TICKETS_ENABLED", "true");
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_ENABLED", "true");
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_PROVIDER", "cloudflare");
    vi.stubEnv("SUPPORT_EMAIL_INBOUND_ENABLED", "true");
    vi.stubEnv("SUPPORT_EMAIL_ADDRESS", "support@example.com");
    vi.stubEnv(
      "SUPPORT_EMAIL_REPLY_TOKEN_KEY",
      Buffer.alloc(32, 41).toString("base64"),
    );
    vi.stubEnv(
      "SUPPORT_EMAIL_WEBHOOK_SECRET",
      Buffer.alloc(32, 43).toString("base64"),
    );
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      "c3VwcG9ydC10ZXN0LWtleS0zMi1ieXRlcy1sb25nISE",
    );
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "support-admin",
          email: "support-admin@example.com",
          phone: null,
          name: "Support Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("SupportAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "support-member",
          email: "support-member@example.com",
          phone: null,
          name: "Support Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("SupportMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "support-peer",
          email: "support-peer@example.com",
          phone: null,
          name: "Support Peer",
          avatarDataUrl: "",
          password: await auth.hashPassword("SupportPeer123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
        {
          id: "support-agent",
          email: "support-agent@example.com",
          phone: null,
          name: "Support Agent",
          avatarDataUrl: "",
          password: await auth.hashPassword("SupportAgent123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10080,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.initializeDatabase();
    const now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "secondary:support-admin",
          facilityId: "secondary",
          userId: "support-admin",
          role: "admin",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:support-member",
          facilityId: "secondary",
          userId: "support-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:support-peer",
          facilityId: "secondary",
          userId: "support-peer",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:support-agent",
          facilityId: "secondary",
          userId: "support-agent",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:support-admin",
          facilityId: "facility-alpha",
          userId: "support-admin",
          role: "admin",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:support-member",
          facilityId: "facility-alpha",
          userId: "support-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:support-peer",
          facilityId: "facility-alpha",
          userId: "support-peer",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:support-agent",
          facilityId: "facility-alpha",
          userId: "support-agent",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: Date.now() })
      .where("id", "=", "support-member")
      .execute();
    await database.db
      .insertInto("supportAgents")
      .values({
        id: "support-agent-membership",
        facilityId: "facility-alpha",
        userId: "support-agent",
        role: "agent",
        active: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .execute();
    app = (await import("../index.js")).app;
    const login = async (
      identifier: string,
      password: string,
      portal: "member" | "staff",
    ) =>
      (
        await request(app).post("/api/auth/login").send({
          identifier,
          password,
          accessPortal: portal,
          rememberDevice: false,
        })
      ).headers["set-cookie"][0];
    adminCookie = await login(
      "support-admin@example.com",
      "SupportAdmin123",
      "staff",
    );
    memberCookie = await login(
      "support-member@example.com",
      "SupportMember123",
      "member",
    );
    peerCookie = await login(
      "support-peer@example.com",
      "SupportPeer123",
      "member",
    );
    agentCookie = await login(
      "support-agent@example.com",
      "SupportAgent123",
      "member",
    );
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a private, auditable ticket and rejects unknown fields", async () => {
    await request(app)
      .post("/api/support/tickets")
      .set("Cookie", memberCookie)
      .send({
        subject: "No puedo confirmar una reserva",
        message: "La reserva permanece pendiente después de confirmar.",
        category: "reservations",
        priority: "high",
        arbitrary: "must be rejected",
      })
      .expect(400);

    const created = await request(app)
      .post("/api/support/tickets")
      .set("Cookie", memberCookie)
      .send({
        subject: "No puedo confirmar una reserva",
        message: "La reserva permanece pendiente después de confirmar.",
        category: "reservations",
        priority: "high",
        context: { route: "/my-bookings", release: "test" },
      })
      .expect(201);
    ticketId = created.body.ticket.id;
    expect(created.body.ticket.publicId).toMatch(/^UFS-[A-F0-9]{10}$/);

    await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", peerCookie)
      .expect(403);

    const own = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", memberCookie)
      .expect(200);
    expect(own.body.ticket.messages).toHaveLength(1);
    expect(own.body.ticket.context.route).toBe("/my-bookings");

    const storedTicket = await database.db
      .selectFrom("supportTickets")
      .select("context")
      .where("id", "=", ticketId)
      .executeTakeFirstOrThrow();
    const storedMessage = await database.db
      .selectFrom("supportMessages")
      .select("body")
      .where("ticketId", "=", ticketId)
      .executeTakeFirstOrThrow();
    expect(storedTicket.context).toMatch(/^agc3\./);
    expect(storedMessage.body).toMatch(/^agc3\./);
  });

  it("isolates tickets, agents and knowledge by facility", async () => {
    const secondaryTicket = await request(app)
      .post("/api/support/tickets")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        subject: "Secondary support request",
        message: "This request must remain inside the secondary facility.",
        category: "general",
        priority: "normal",
      })
      .expect(201);

    await request(app)
      .get(`/api/support/tickets/${secondaryTicket.body.ticket.id}`)
      .set("Cookie", adminCookie)
      .expect(404);
    await request(app)
      .get(`/api/support/tickets/${secondaryTicket.body.ticket.id}`)
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);

    const facility_alphaQueue = await request(app)
      .get("/api/support/tickets")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(
      facility_alphaQueue.body.tickets.map(
        (ticket: { id: string }) => ticket.id,
      ),
    ).not.toContain(secondaryTicket.body.ticket.id);

    const secondaryAgentCapabilities = await request(app)
      .get("/api/support/capabilities")
      .set("Cookie", agentCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(secondaryAgentCapabilities.body.capabilities.staff).toBe(false);

    const articleInput = {
      title: "Tenant-specific guide",
      summary: "Facility-scoped support guidance.",
      body: "Only members of the selected facility may discover this guide.",
      category: "general",
      status: "published",
      slug: "tenant-specific-guide",
    };
    await request(app)
      .post("/api/support/knowledge")
      .set("Cookie", adminCookie)
      .send(articleInput)
      .expect(201);
    await request(app)
      .post("/api/support/knowledge")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send(articleInput)
      .expect(201);

    const facility_alphaKnowledge = await request(app)
      .get("/api/support/knowledge?q=Tenant-specific")
      .set("Cookie", memberCookie)
      .expect(200);
    const secondaryKnowledge = await request(app)
      .get("/api/support/knowledge?q=Tenant-specific")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(facility_alphaKnowledge.body.articles).toHaveLength(1);
    expect(secondaryKnowledge.body.articles).toHaveLength(1);
    expect(facility_alphaKnowledge.body.articles[0].facilityId).toBe(
      "facility-alpha",
    );
    expect(secondaryKnowledge.body.articles[0].facilityId).toBe("secondary");
  });

  it("lets staff triage tickets while hiding internal notes", async () => {
    const capabilities = await request(app)
      .get("/api/support/capabilities")
      .set("Cookie", agentCookie)
      .expect(200);
    expect(capabilities.body.capabilities).toMatchObject({
      staff: true,
      administrator: false,
      supportRole: "agent",
      canManageKnowledge: true,
      canManageTeam: false,
    });
    await request(app)
      .get("/api/support/agents")
      .set("Cookie", agentCookie)
      .expect(200);

    await request(app)
      .patch(`/api/support/tickets/${ticketId}`)
      .set("Cookie", adminCookie)
      .send({
        status: "in_progress",
        priority: "urgent",
        assigneeUserId: "support-admin",
      })
      .expect(200);

    await request(app)
      .post(`/api/support/tickets/${ticketId}/messages`)
      .set("Cookie", adminCookie)
      .send({
        body: "Revisar la transición de estado.",
        visibility: "internal",
      })
      .expect(201);

    await request(app)
      .post(`/api/support/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Intento de nota interna.", visibility: "internal" })
      .expect(403);

    const memberView = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", memberCookie)
      .expect(200);
    expect(memberView.body.ticket.messages).toHaveLength(1);

    const staffView = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(staffView.body.ticket.messages).toHaveLength(2);
    expect(staffView.body.ticket.events.length).toBeGreaterThanOrEqual(3);
  });

  it("stores attachments outside the public tree and checks ticket access", async () => {
    const uploaded = await request(app)
      .post(`/api/support/tickets/${ticketId}/attachments`)
      .set("Cookie", memberCookie)
      .set("Content-Type", "text/plain")
      .set("X-File-Name", "diagnostico.txt")
      .send(Buffer.from("support diagnostic"))
      .expect(201);

    await request(app)
      .get(
        `/api/support/tickets/${ticketId}/attachments/${uploaded.body.attachment.id}`,
      )
      .set("Cookie", peerCookie)
      .expect(403);

    const downloaded = await request(app)
      .get(
        `/api/support/tickets/${ticketId}/attachments/${uploaded.body.attachment.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(200);
    expect(downloaded.text).toBe("support diagnostic");
    expect(downloaded.headers["content-disposition"]).toContain(
      "diagnostico.txt",
    );
    const storedAttachment = await database.db
      .selectFrom("supportAttachments")
      .select("storageKey")
      .where("id", "=", uploaded.body.attachment.id)
      .executeTakeFirstOrThrow();
    const storedBytes = await readFile(
      join(directory, "support-attachments", storedAttachment.storageKey),
    );
    expect(storedBytes.toString("utf8")).toMatch(/^agc3\./);
    expect(storedBytes.toString("utf8")).not.toContain("support diagnostic");

    const integrityUpload = await request(app)
      .post(`/api/support/tickets/${ticketId}/attachments`)
      .set("Cookie", memberCookie)
      .set("Content-Type", "text/plain")
      .set("X-File-Name", "integridad.txt")
      .send(Buffer.from("integrity protected"))
      .expect(201);
    await database.db
      .updateTable("supportAttachments")
      .set({ checksumSha256: "0".repeat(64) })
      .where("id", "=", integrityUpload.body.attachment.id)
      .execute();
    await request(app)
      .get(
        `/api/support/tickets/${ticketId}/attachments/${integrityUpload.body.attachment.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(500);
    await request(app)
      .delete(
        `/api/support/tickets/${ticketId}/attachments/${integrityUpload.body.attachment.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(204);

    const staffView = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", adminCookie)
      .expect(200);
    const internalMessage = staffView.body.ticket.messages.find(
      (message: { visibility: string }) => message.visibility === "internal",
    );
    const internalUpload = await request(app)
      .post(`/api/support/tickets/${ticketId}/attachments`)
      .set("Cookie", adminCookie)
      .set("Content-Type", "text/plain")
      .set("X-File-Name", "nota-interna.txt")
      .set("X-Message-Id", internalMessage.id)
      .send(Buffer.from("staff only"))
      .expect(201);
    await request(app)
      .get(
        `/api/support/tickets/${ticketId}/attachments/${internalUpload.body.attachment.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(403);

    const memberView = await request(app)
      .get(`/api/support/tickets/${ticketId}`)
      .set("Cookie", memberCookie)
      .expect(200);
    expect(memberView.body.ticket.attachments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: internalUpload.body.attachment.id }),
      ]),
    );

    await request(app)
      .delete(
        `/api/support/tickets/${ticketId}/attachments/${uploaded.body.attachment.id}`,
      )
      .set("Cookie", peerCookie)
      .expect(403);
    await request(app)
      .delete(
        `/api/support/tickets/${ticketId}/attachments/${uploaded.body.attachment.id}`,
      )
      .set("Cookie", memberCookie)
      .expect(204);
    await expect(
      access(
        join(directory, "support-attachments", storedAttachment.storageKey),
      ),
    ).rejects.toThrow();
    expect(
      await database.db
        .selectFrom("supportAttachments")
        .select("id")
        .where("id", "=", uploaded.body.attachment.id)
        .executeTakeFirst(),
    ).toBeUndefined();

    await request(app)
      .delete(
        `/api/support/tickets/${ticketId}/attachments/${internalUpload.body.attachment.id}`,
      )
      .set("Cookie", adminCookie)
      .expect(204);
    const removalEvents = await database.db
      .selectFrom("supportEvents")
      .select("id")
      .where("ticketId", "=", ticketId)
      .where("type", "=", "attachment_removed")
      .execute();
    expect(removalEvents).toHaveLength(3);
  });

  it("publishes searchable knowledge without exposing drafts", async () => {
    await request(app)
      .post("/api/support/knowledge")
      .set("Cookie", adminCookie)
      .send({
        title: "Confirmar una reserva",
        summary: "Pasos para confirmar la asistencia.",
        body: "Abre Mis reservas y confirma la asistencia disponible.",
        category: "reservations",
        status: "published",
      })
      .expect(201);

    await request(app)
      .post("/api/support/knowledge")
      .set("Cookie", adminCookie)
      .send({
        title: "Borrador privado",
        summary: "No debe aparecer a socios.",
        body: "Contenido interno de soporte.",
        category: "internal",
        status: "draft",
      })
      .expect(201);

    const search = await request(app)
      .get("/api/support/search?q=reserva")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(search.body.articles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Confirmar una reserva" }),
      ]),
    );
    expect(search.body.articles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Borrador privado" }),
      ]),
    );
    await request(app)
      .get("/api/support/search?q=%25_")
      .set("Cookie", memberCookie)
      .expect(400);
  });

  it("keeps commercial application data outside the corporate support bridge", async () => {
    const now = Date.now();
    await database.db
      .insertInto("supportTickets")
      .values({
        id: "commercial-application-ticket",
        publicId: "UFS-COMMERCIAL",
        applicationTenantId: "commercial",
        facilityId: "facility-alpha",
        requesterUserId: "support-member",
        assigneeUserId: null,
        subject: "Commercial application internal record",
        category: "technical",
        priority: "normal",
        status: "open",
        source: "system",
        relatedType: null,
        relatedId: null,
        context: "{}",
        firstResponseDueAt: now + 60_000,
        resolutionDueAt: now + 120_000,
        firstRespondedAt: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("supportKnowledgeArticles")
      .values({
        id: "commercial-application-article",
        applicationTenantId: "commercial",
        facilityId: "facility-alpha",
        slug: "commercial-internal-record",
        title: "Commercial application internal record",
        summary: "Must not cross the corporate support boundary.",
        body: "Commercial-only content.",
        category: "internal",
        status: "published",
        authorUserId: "support-admin",
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
      })
      .execute();

    const tickets = await request(app)
      .get("/api/support/tickets")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(
      tickets.body.tickets.map((item: { publicId: string }) => item.publicId),
    ).not.toContain("UFS-COMMERCIAL");
    await request(app)
      .get("/api/support/tickets/commercial-application-ticket")
      .set("Cookie", memberCookie)
      .expect(404);

    const knowledge = await request(app)
      .get("/api/support/search?q=Commercial")
      .set("Cookie", memberCookie)
      .expect(200);
    expect(
      knowledge.body.articles.map((item: { id: string }) => item.id),
    ).not.toContain("commercial-application-article");
  });

  it("creates and replies to a ticket through an authenticated email webhook", async () => {
    const configuration = resolveSupportEmailInboundConfiguration();
    expect(configuration).not.toBeNull();
    const sendInbound = async (payload: Record<string, unknown>) => {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signSupportEmailWebhook(
        Buffer.from(body),
        timestamp,
        configuration!.webhookSecret,
      );
      return request(app)
        .post("/api/internal/support-email")
        .set("Content-Type", "application/json")
        .set("X-Umbravia-Timestamp", timestamp)
        .set("X-Umbravia-Signature", signature)
        .send(body);
    };

    await request(app)
      .post("/api/internal/support-email")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(401);

    const newTicketPayload = {
      version: 1,
      envelopeTo: "support@example.com",
      from: "support-member@example.com",
      messageId: "<new-ticket@example.com>",
      subject: "Consulta recibida por correo",
      text: "Necesito ayuda desde mi cuenta verificada.",
      attachmentCount: 0,
    };
    const created = await sendInbound(newTicketPayload);
    expect(created.status).toBe(202);
    expect(created.body.ticketPublicId).toMatch(/^UFS-[A-F0-9]{10}$/);
    const duplicateTicket = await sendInbound(newTicketPayload);
    expect(duplicateTicket.status).toBe(200);
    expect(duplicateTicket.body).toMatchObject({
      duplicate: true,
      ticketPublicId: created.body.ticketPublicId,
    });

    const ticket = await database.db
      .selectFrom("supportTickets")
      .select(["id", "publicId", "requesterUserId"])
      .where("publicId", "=", created.body.ticketPublicId)
      .executeTakeFirstOrThrow();
    const visibleFromSecondary = await request(app)
      .get("/api/support/tickets")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(
      visibleFromSecondary.body.tickets.map(
        (item: { publicId: string }) => item.publicId,
      ),
    ).toContain(ticket.publicId);
    await request(app)
      .get(`/api/support/tickets/${ticket.id}`)
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    const hiddenFromPeer = await request(app)
      .get("/api/support/tickets")
      .set("Cookie", peerCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(
      hiddenFromPeer.body.tickets.map(
        (item: { publicId: string }) => item.publicId,
      ),
    ).not.toContain(ticket.publicId);
    const replyAddress = buildSupportReplyAddress(
      ticket.publicId,
      ticket.requesterUserId,
      configuration!,
    );
    const replyPayload = {
      version: 1,
      envelopeTo: replyAddress,
      from: "support-member@example.com",
      messageId: "<ticket-reply@example.com>",
      subject: `Re: [${ticket.publicId}] Consulta recibida por correo`,
      text: "Añado un detalle.\n\nEl equipo escribió:\n> Respuesta anterior",
      attachmentCount: 0,
    };
    const firstReply = await sendInbound(replyPayload);
    expect(firstReply.status).toBe(202);
    expect(firstReply.body.duplicate).toBe(false);
    const duplicateReply = await sendInbound(replyPayload);
    expect(duplicateReply.status).toBe(200);
    expect(duplicateReply.body.duplicate).toBe(true);

    const messages = await database.db
      .selectFrom("supportMessages")
      .select(["body", "authorUserId"])
      .where("ticketId", "=", ticket.id)
      .orderBy("createdAt", "asc")
      .execute();
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.body.startsWith("agc3."))).toBe(
      true,
    );
    expect(
      messages.every((message) => message.authorUserId === "support-member"),
    ).toBe(true);

    const visibleTicket = await request(app)
      .get(`/api/support/tickets/${ticket.id}`)
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(
      visibleTicket.body.ticket.messages.map(
        (message: { body: string }) => message.body,
      ),
    ).toEqual([
      "Necesito ayuda desde mi cuenta verificada.",
      "Añado un detalle.",
    ]);
  });

  it("routes new ticket operations externally while preserving the internal data", async () => {
    vi.stubEnv("INTERNAL_SUPPORT_TICKETS_ENABLED", "false");
    try {
      await request(app)
        .get("/api/support/contact")
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            internalTicketingEnabled: false,
            contacts: {
              helpdeskPortalEnabled: false,
              helpdeskEmail: "umbravia-forge-scrf@support.openhelpdesk.dev",
              legalRightsEmail: "umbraviaforge@gmail.com",
            },
          });
        });
      await request(app)
        .get("/api/support/tickets")
        .set("Cookie", memberCookie)
        .set("X-Facility-Id", "facility-alpha")
        .expect(503)
        .expect(({ body }) => {
          expect(body.code).toBe("SUPPORT_TICKETS_EXTERNALLY_ROUTED");
        });
    } finally {
      vi.stubEnv("INTERNAL_SUPPORT_TICKETS_ENABLED", "true");
    }
  });
});

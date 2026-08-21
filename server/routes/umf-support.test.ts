import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signSupportEmailWebhook } from "../lib/support-email-inbound.js";
import {
  buildUmfSupportReplyAddress,
  resolveUmfSupportEmailConfiguration,
} from "../lib/umf-support-email.js";

describe("UMF Support corporate API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let directorCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-corporate-support-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      Buffer.alloc(32, 31).toString("base64url"),
    );
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_ENABLED", "true");
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_PROVIDER", "cloudflare");
    vi.stubEnv("UMF_SUPPORT_EMAIL_INBOUND_ENABLED", "true");
    vi.stubEnv("UMF_SUPPORT_EMAIL_ADDRESS", "privacy@example.com");
    vi.stubEnv(
      "UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY",
      Buffer.alloc(32, 17).toString("base64"),
    );
    vi.stubEnv(
      "UMF_SUPPORT_EMAIL_WEBHOOK_SECRET",
      Buffer.alloc(32, 29).toString("base64"),
    );
    vi.stubEnv(
      "UMF_SUPPORT_WINDOWS_ZIP_URL",
      "https://downloads.example.com/umf-support-test.zip",
    );
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "umf-director",
          email: "director@example.com",
          phone: null,
          name: "Director",
          avatarDataUrl: "",
          password: await auth.hashPassword("DirectorPassword123"),
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
        {
          id: "tenant-admin-only",
          email: "tenant-admin@example.com",
          phone: null,
          name: "Tenant Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("TenantAdminPassword123"),
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("platformOperators")
      .values({
        userId: "umf-director",
        source: "controlled_provisioning",
        status: "active",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    app = (await import("../index.js")).app;
    const login = await request(app).post("/api/auth/login").send({
      identifier: "director@example.com",
      password: "DirectorPassword123",
      accessPortal: "support",
      rememberDevice: false,
    });
    directorCookie = login.headers["set-cookie"][0];
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps tenant administrators outside the corporate support program", async () => {
    const distribution = await request(app)
      .get("/api/umf-support/distribution")
      .expect(200);
    expect(distribution.body.distribution).toMatchObject({
      available: true,
      testPackage: true,
      url: "https://downloads.example.com/umf-support-test.zip",
    });

    const login = await request(app).post("/api/auth/login").send({
      identifier: "tenant-admin@example.com",
      password: "TenantAdminPassword123",
      accessPortal: "support",
      rememberDevice: false,
    });
    expect(login.status).toBe(401);
  });

  it("requires manual approval and consumes the activation code once", async () => {
    await request(app)
      .post("/api/umf-support/access-requests")
      .send({
        email: "new-agent@example.com",
        name: "New",
        lastName: "Agent",
        locale: "es",
      })
      .expect(202);

    const pending = await request(app)
      .get("/api/umf-support/access-requests")
      .set("Cookie", directorCookie)
      .expect(200);
    expect(pending.body.requests).toHaveLength(1);
    expect(pending.body.requests[0].status).toBe("pending");

    const approved = await request(app)
      .post(
        `/api/umf-support/access-requests/${pending.body.requests[0].id}/approve`,
      )
      .set("Cookie", directorCookie)
      .send({})
      .expect(200);
    expect(approved.body.code).toMatch(/^\d{6}$/);

    const stored = await database.db
      .selectFrom("umfSupportAccessRequests")
      .select(["activationCodeHash", "status"])
      .where("id", "=", pending.body.requests[0].id)
      .executeTakeFirstOrThrow();
    expect(stored.activationCodeHash).not.toContain(approved.body.code);
    expect(stored.status).toBe("approved");

    const activated = await request(app)
      .post("/api/umf-support/activate")
      .send({
        email: "new-agent@example.com",
        code: approved.body.code,
        password: "NewAgentPassword123",
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    expect(activated.body.user.email).toBe("new-agent@example.com");

    await request(app)
      .post("/api/umf-support/activate")
      .send({
        email: "new-agent@example.com",
        code: approved.body.code,
        password: "AnotherPassword123",
        countryCode: "ES",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(400);

    const login = await request(app).post("/api/auth/login").send({
      identifier: "new-agent@example.com",
      password: "NewAgentPassword123",
      accessPortal: "support",
      rememberDevice: false,
    });
    expect(login.status).toBe(200);
    const agentCookie = login.headers["set-cookie"][0];
    const capabilities = await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", agentCookie)
      .expect(200);
    expect(capabilities.body.capabilities.role).toBe("agent");
    expect(capabilities.body.capabilities.canReviewAccess).toBe(false);

    const events = await database.db
      .selectFrom("securityEvents")
      .select("type")
      .where("type", "in", [
        "umf_support_access_requested",
        "umf_support_access_approved",
        "umf_support_account_activated",
      ])
      .execute();
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set([
        "umf_support_access_requested",
        "umf_support_access_approved",
        "umf_support_account_activated",
      ]),
    );
  });

  it("keeps tickets and mailboxes inside the corporate application", async () => {
    const created = await request(app)
      .post("/api/umf-support/tickets")
      .set("Cookie", directorCookie)
      .send({
        requesterEmail: "centre@example.com",
        requesterName: "Centre Owner",
        organizationName: "Centre One",
        subject: "Production access question",
        message: "We need help with the platform configuration.",
        category: "technical",
        priority: "high",
      })
      .expect(201);
    expect(created.body.ticket.publicId).toMatch(/^UMF-/);

    await request(app)
      .post(`/api/umf-support/tickets/${created.body.ticket.id}/messages`)
      .set("Cookie", directorCookie)
      .send({ body: "We are reviewing the configuration.", sendEmail: false })
      .expect(201);

    const outgoing = await request(app)
      .get("/api/umf-support/mailbox/outbound")
      .set("Cookie", directorCookie)
      .expect(200);
    expect(outgoing.body.messages).toHaveLength(1);
    expect(outgoing.body.messages[0].recipient).toBe("centre@example.com");

    const facilitySupportRows = await database.db
      .selectFrom("supportTickets")
      .select("id")
      .execute();
    expect(facilitySupportRows).toHaveLength(0);
  });

  it("authenticates, classifies and deduplicates privacy email", async () => {
    const payload = {
      version: 1,
      envelopeTo: "privacy@example.com",
      from: "person@example.net",
      messageId: "<privacy-right-1@example.net>",
      subject: "Ejercicio del derecho de acceso a mis datos",
      text: "Quiero conocer los datos personales que trata la plataforma.",
      attachmentCount: 0,
    };
    const send = (input: typeof payload) => {
      const body = JSON.stringify(input);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signSupportEmailWebhook(
        Buffer.from(body),
        timestamp,
        Buffer.alloc(32, 29),
      );
      return request(app)
        .post("/api/internal/umf-support-email")
        .set("Content-Type", "application/json")
        .set("X-Umbravia-Timestamp", timestamp)
        .set("X-Umbravia-Signature", signature)
        .send(body);
    };

    await request(app)
      .post("/api/internal/umf-support-email")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(401);

    const created = await send(payload);
    expect(created.status).toBe(202);
    expect(created.body.ticketPublicId).toMatch(/^UMF-[A-F0-9]{10}$/);
    const duplicate = await send(payload);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      duplicate: true,
      ticketPublicId: created.body.ticketPublicId,
    });

    const ticket = await database.db
      .selectFrom("umfSupportTickets")
      .select(["id", "category", "requesterEmail"])
      .where("publicId", "=", created.body.ticketPublicId)
      .executeTakeFirstOrThrow();
    expect(ticket).toMatchObject({
      category: "privacy",
      requesterEmail: "person@example.net",
    });

    const configuration = resolveUmfSupportEmailConfiguration();
    const replyAddress = buildUmfSupportReplyAddress(
      created.body.ticketPublicId,
      payload.from,
      configuration!,
    );
    const reply = await send({
      ...payload,
      envelopeTo: replyAddress,
      messageId: "<privacy-right-reply-1@example.net>",
      subject: `Re: ${payload.subject}`,
      text: "Añado una precisión a mi solicitud.",
    });
    expect(reply.status).toBe(202);

    const attackerReply = await send({
      ...payload,
      envelopeTo: replyAddress,
      from: "attacker@example.net",
      messageId: "<privacy-right-attacker@example.net>",
      subject: `Re: ${payload.subject}`,
      text: "Intento de incorporar contenido al ticket ajeno.",
    });
    expect(attackerReply.status).toBe(403);

    const messages = await database.db
      .selectFrom("umfSupportMessages")
      .select("id")
      .where("ticketId", "=", ticket.id)
      .execute();
    expect(messages).toHaveLength(2);
  });
});

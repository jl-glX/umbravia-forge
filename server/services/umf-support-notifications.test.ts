import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PostalMime from "postal-mime";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "../lib/supported-locales.js";

const pushMocks = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("web-push", () => ({ default: pushMocks }));

type ExpectedNotificationCopy = {
  ticket: string;
  problem: string;
  priority: string;
  category: string;
  conversation: string;
  inbound: string;
  inboundBody: string;
  feedback: string;
  feedbackBody: string;
  cta: string;
};

const expectedCopy: Record<SupportedLocale, ExpectedNotificationCopy> = {
  es: {
    ticket: "Nuevo aviso",
    problem: "Nuevo problema",
    priority: "prioridad",
    category: "categoría",
    conversation: "Nueva respuesta en",
    inbound: "Correo recibido en",
    inboundBody:
      "UMF Support ha recibido un correo nuevo o una respuesta autenticada.",
    feedback: "Nueva aportación para Umbravia Forge",
    feedbackBody: "Se ha recibido una aportación en la categoría",
    cta: "Abre UMF Support",
  },
  en: {
    ticket: "New alert",
    problem: "New problem report",
    priority: "priority",
    category: "category",
    conversation: "New reply in",
    inbound: "Email received in",
    inboundBody: "UMF Support received a new email or an authenticated reply.",
    feedback: "New feedback for Umbravia Forge",
    feedbackBody: "Feedback was received in the category",
    cta: "Open UMF Support",
  },
  de: {
    ticket: "Neue Meldung",
    problem: "Neue Problemmeldung",
    priority: "Priorität",
    category: "Kategorie",
    conversation: "Neue Antwort in",
    inbound: "E-Mail eingegangen in",
    inboundBody:
      "UMF Support hat eine neue E-Mail oder eine authentifizierte Antwort erhalten.",
    feedback: "Neue Rückmeldung für Umbravia Forge",
    feedbackBody:
      "In der folgenden Kategorie ist eine Rückmeldung eingegangen:",
    cta: "UMF Support öffnen",
  },
  "de-CH": {
    ticket: "Neue Meldung",
    problem: "Neue Problemmeldung",
    priority: "Priorität",
    category: "Kategorie",
    conversation: "Neue Antwort in",
    inbound: "E-Mail eingegangen in",
    inboundBody:
      "UMF Support hat eine neue E-Mail oder eine authentifizierte Antwort erhalten.",
    feedback: "Neue Rückmeldung für Umbravia Forge",
    feedbackBody:
      "In der folgenden Kategorie ist eine Rückmeldung eingegangen:",
    cta: "UMF Support öffnen",
  },
  fr: {
    ticket: "Nouvelle alerte",
    problem: "Nouveau problème signalé",
    priority: "priorité",
    category: "catégorie",
    conversation: "Nouvelle réponse dans",
    inbound: "E-mail reçu dans",
    inboundBody:
      "UMF Support a reçu un nouvel e-mail ou une réponse authentifiée.",
    feedback: "Nouvel avis pour Umbravia Forge",
    feedbackBody: "Un avis a été reçu dans la catégorie",
    cta: "Ouvrir UMF Support",
  },
  it: {
    ticket: "Nuova segnalazione",
    problem: "Nuovo problema segnalato",
    priority: "priorità",
    category: "categoria",
    conversation: "Nuova risposta in",
    inbound: "E-mail ricevuta in",
    inboundBody:
      "UMF Support ha ricevuto una nuova e-mail o una risposta autenticata.",
    feedback: "Nuovo feedback per Umbravia Forge",
    feedbackBody: "È stato ricevuto un feedback nella categoria",
    cta: "Apri UMF Support",
  },
  gl: {
    ticket: "Novo aviso",
    problem: "Novo problema comunicado",
    priority: "prioridade",
    category: "categoría",
    conversation: "Nova resposta en",
    inbound: "Correo recibido en",
    inboundBody:
      "UMF Support recibiu un novo correo ou unha resposta autenticada.",
    feedback: "Nova achega para Umbravia Forge",
    feedbackBody: "Recibiuse unha achega na categoría",
    cta: "Abrir UMF Support",
  },
  ca: {
    ticket: "Nou avís",
    problem: "Nou problema notificat",
    priority: "prioritat",
    category: "categoria",
    conversation: "Nova resposta a",
    inbound: "Correu rebut a",
    inboundBody:
      "UMF Support ha rebut un correu nou o una resposta autenticada.",
    feedback: "Nova aportació per a Umbravia Forge",
    feedbackBody: "S'ha rebut una aportació en la categoria",
    cta: "Obre UMF Support",
  },
  "ca-valencia": {
    ticket: "Nou avís",
    problem: "Nou problema notificat",
    priority: "prioritat",
    category: "categoria",
    conversation: "Nova resposta a",
    inbound: "Correu rebut a",
    inboundBody:
      "UMF Support ha rebut un correu nou o una resposta autenticada.",
    feedback: "Nova aportació per a Umbravia Forge",
    feedbackBody: "S'ha rebut una aportació en la categoria",
    cta: "Obre UMF Support",
  },
  eu: {
    ticket: "Abisu berria",
    problem: "Arazo berri baten jakinarazpena",
    priority: "lehentasuna",
    category: "kategoria",
    conversation: "Erantzun berria hemen:",
    inbound: "Mezua jaso da hemen:",
    inboundBody:
      "UMF Support zerbitzuak mezu berri bat edo autentifikatutako erantzun bat jaso du.",
    feedback: "Umbravia Forge-rentzako ekarpen berria",
    feedbackBody: "Ekarpen bat jaso da kategoria honetan:",
    cta: "Ireki UMF Support",
  },
  "oc-aranes": {
    ticket: "Nau avís",
    problem: "Nau problèma notificat",
    priority: "prioritat",
    category: "categoria",
    conversation: "Naua responsa en",
    inbound: "Corrèu recebut en",
    inboundBody:
      "UMF Support a recebut un corrèu nau o ua responsa autentificada.",
    feedback: "Naua aportacion entà Umbravia Forge",
    feedbackBody: "S'a recebut ua aportacion ena categoria",
    cta: "Daurís UMF Support",
  },
};

function allPreferences(enabled: boolean) {
  return {
    ticket_created: { email: enabled, push: enabled },
    conversation_received: { email: enabled, push: enabled },
    inbound_email: { email: enabled, push: enabled },
    feedback_received: { email: enabled, push: enabled },
    problem_reported: { email: enabled, push: enabled },
  };
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out while waiting for notification delivery state");
}

function startSmtpCapture(messages: string[]): Promise<Server> {
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost UMF notification test SMTP\r\n");
    let buffer = "";
    let message = "";
    let receivingData = false;
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      while (buffer.length > 0) {
        if (receivingData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) {
            message += buffer;
            buffer = "";
            return;
          }
          message += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          messages.push(message);
          message = "";
          receivingData = false;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith("EHLO")) {
          socket.write("250-localhost\r\n250 SIZE 2000000\r\n");
        } else if (line === "DATA") {
          receivingData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (line === "QUIT") {
          socket.end("221 2.0.0 bye\r\n");
        } else {
          socket.write("250 2.0.0 ok\r\n");
        }
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

describe("UMF Support administrator notifications", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let notificationService: typeof import("./umf-support-notifications.js");
  let emailDelivery: typeof import("./email-delivery.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-support-alerts-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.com");
    vi.stubEnv(
      "EMAIL_QUEUE_ENCRYPTION_KEY",
      Buffer.alloc(32, 47).toString("base64"),
    );
    vi.stubEnv("UMF_SUPPORT_PUSH_VAPID_SUBJECT", "mailto:test@example.com");
    vi.stubEnv("UMF_SUPPORT_PUSH_VAPID_PUBLIC_KEY", "test-public-key");
    vi.stubEnv("UMF_SUPPORT_PUSH_VAPID_PRIVATE_KEY", "test-private-key");
    vi.resetModules();
    database = await import("../db/client.js");
    notificationService = await import("./umf-support-notifications.js");
    emailDelivery = await import("./email-delivery.js");
    await database.initializeDatabase();

    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        ...SUPPORTED_LOCALES.map((locale) => ({
          id: `support-admin-${locale}`,
          email: `support-admin-${locale}@example.com`,
          identityRealm: "corporate_support" as const,
          phone: null,
          name: `Support ${locale}`,
          avatarDataUrl: "",
          password: "unused",
          role: "admin" as const,
          locale,
          accountStatus: "active" as const,
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        })),
        {
          id: "unsubscribed-agent",
          email: "unsubscribed@example.com",
          identityRealm: "corporate_support" as const,
          phone: null,
          name: "Unsubscribed",
          avatarDataUrl: "",
          password: "unused",
          role: "admin" as const,
          locale: "fr" as const,
          accountStatus: "active" as const,
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values(
        [...SUPPORTED_LOCALES, "unsubscribed"].map((locale, index) => ({
          userId:
            locale === "unsubscribed"
              ? "unsubscribed-agent"
              : `support-admin-${locale}`,
          role: index === 0 ? ("director" as const) : ("agent" as const),
          status: "active" as const,
          approvedByUserId: "support-admin-es",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })),
      )
      .execute();
    await database.db
      .insertInto("umfSupportNotificationPreferences")
      .values([
        ...SUPPORTED_LOCALES.map((locale) => ({
          userId: `support-admin-${locale}`,
          enabled: 1,
          eventPreferences: JSON.stringify(allPreferences(true)),
          updatedAt: now,
        })),
        {
          userId: "unsubscribed-agent",
          enabled: 0,
          eventPreferences: JSON.stringify(allPreferences(true)),
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportPushSubscriptions")
      .values(
        SUPPORTED_LOCALES.map((locale) => ({
          id: `push-${locale}`,
          userId: `support-admin-${locale}`,
          endpointHash: `endpoint-hash-${locale}`,
          subscriptionProtected: JSON.stringify({
            endpoint: `https://push.example.com/${locale}`,
            expirationTime: null,
            keys: { p256dh: `p256dh-${locale}`, auth: `auth-${locale}` },
          }),
          browserFamily: "firefox" as const,
          deviceName: `Browser ${locale}`,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    emailDelivery.resetEmailTransportForTests();
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("renders every event per supported locale without translating opaque values", () => {
    const opaque = {
      ticketPublicId: "UFS-OPAQUE-0042",
      subject: "USER SUBJECT / no traducir",
      priority: "priority_user_value",
      category: "category_user_value",
    };
    for (const locale of SUPPORTED_LOCALES) {
      const copy = expectedCopy[locale];
      const ticket =
        notificationService.renderUmfSupportAdministratorNotification(
          { event: "ticket_created", ...opaque },
          locale,
        );
      expect(ticket.locale).toBe(locale);
      expect(ticket.title).toBe(`${copy.ticket} ${opaque.ticketPublicId}`);
      expect(ticket.message).toBe(
        `${opaque.subject} · ${copy.priority} ${opaque.priority} · ${copy.category} ${opaque.category}`,
      );
      expect(`${ticket.title}${ticket.message}`).not.toContain("undefined");

      const problem =
        notificationService.renderUmfSupportAdministratorNotification(
          { event: "problem_reported", ...opaque },
          locale,
        );
      expect(problem.title).toBe(`${copy.problem} ${opaque.ticketPublicId}`);
      expect(problem.message).toBe(
        `${opaque.subject} · ${copy.priority} ${opaque.priority} · ${copy.category} ${opaque.category}`,
      );

      const conversation =
        notificationService.renderUmfSupportAdministratorNotification(
          {
            event: "conversation_received",
            ticketPublicId: opaque.ticketPublicId,
            subject: opaque.subject,
          },
          locale,
        );
      expect(conversation.title).toBe(
        `${copy.conversation} ${opaque.ticketPublicId}`,
      );
      expect(conversation.message).toBe(opaque.subject);

      const inbound =
        notificationService.renderUmfSupportAdministratorNotification(
          {
            event: "inbound_email",
            ticketPublicId: opaque.ticketPublicId,
          },
          locale,
        );
      expect(inbound.title).toBe(`${copy.inbound} ${opaque.ticketPublicId}`);
      expect(inbound.message).toBe(copy.inboundBody);

      const feedback =
        notificationService.renderUmfSupportAdministratorNotification(
          { event: "feedback_received", category: opaque.category },
          locale,
        );
      expect(feedback.title).toBe(copy.feedback);
      expect(feedback.message).toBe(`${copy.feedbackBody} ${opaque.category}.`);
    }

    const valencian =
      notificationService.renderUmfSupportAdministratorNotification(
        { event: "ticket_created", ...opaque },
        "ca-valencia",
      );
    const catalan =
      notificationService.renderUmfSupportAdministratorNotification(
        { event: "ticket_created", ...opaque },
        "ca",
      );
    expect({ ...valencian, locale: "ca" }).toEqual(catalan);
    expect(
      notificationService.renderUmfSupportAdministratorNotification(
        { event: "ticket_created", ...opaque },
        "unknown",
      ).locale,
    ).toBe("es");
  });

  it("persists canonical locales, decrypts localized email and captures localized push for every admin", async () => {
    pushMocks.sendNotification.mockClear();
    const opaque = {
      ticketPublicId: "UFS-OPAQUE-9001",
      subject:
        "USER [abre](https://evil.example) <script>alert(1)</script> & literal",
      priority: "urgent_user_value",
      category: "technical_user_value",
    };
    await notificationService.notifyUmfSupportAdministrators({
      event: "ticket_created",
      ...opaque,
      url: "/umf-support?ticket=UFS-OPAQUE-9001",
    });

    await waitFor(async () => {
      const rows = await database.db
        .selectFrom("emailDeliveries")
        .select("status")
        .where("kind", "=", "support_update")
        .execute();
      return (
        rows.length === SUPPORTED_LOCALES.length &&
        rows.every((row) => row.status === "retry")
      );
    });
    const queued = await database.db
      .selectFrom("emailDeliveries")
      .select([
        "id",
        "recipient",
        "locale",
        "payloadEncrypted",
        "platformScope",
      ])
      .where("kind", "=", "support_update")
      .execute();
    expect(queued).toHaveLength(SUPPORTED_LOCALES.length);
    expect(new Set(queued.map((row) => row.locale))).toEqual(
      new Set(SUPPORTED_LOCALES),
    );
    expect(
      queued.every(
        (row) =>
          row.platformScope === "support" &&
          row.payloadEncrypted.startsWith("v2.") &&
          !row.payloadEncrypted.includes(opaque.subject),
      ),
    ).toBe(true);
    expect(
      queued.some((row) => row.recipient === "unsubscribed@example.com"),
    ).toBe(false);

    expect(pushMocks.sendNotification).toHaveBeenCalledTimes(
      SUPPORTED_LOCALES.length,
    );
    const pushByLocale = new Map<SupportedLocale, Record<string, string>>();
    for (const [subscription, rawPayload] of pushMocks.sendNotification.mock
      .calls) {
      const endpoint = (subscription as { endpoint: string }).endpoint;
      const locale = endpoint.split("/").at(-1) as SupportedLocale;
      pushByLocale.set(locale, JSON.parse(String(rawPayload)));
    }
    for (const locale of SUPPORTED_LOCALES) {
      const push = pushByLocale.get(locale);
      expect(push).toMatchObject({
        title: `${expectedCopy[locale].ticket} ${opaque.ticketPublicId}`,
        event: "ticket_created",
        url: "/umf-support?ticket=UFS-OPAQUE-9001",
      });
      expect(push?.body).toContain(opaque.subject);
      expect(push?.body).toContain(opaque.priority);
      expect(push?.body).toContain(opaque.category);
    }

    const smtpMessages: string[] = [];
    const smtp = await startSmtpCapture(smtpMessages);
    const port = (smtp.address() as AddressInfo).port;
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", String(port));
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_REQUIRE_TLS", "false");
    vi.stubEnv("EMAIL_FROM", "Umbravia Forge <no-reply@localhost>");
    emailDelivery.resetEmailTransportForTests();
    try {
      for (const row of queued) {
        await expect(emailDelivery.deliverQueuedEmail(row.id)).resolves.toBe(
          true,
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        smtp.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(smtpMessages).toHaveLength(SUPPORTED_LOCALES.length);
    const parsedMessages = await Promise.all(
      smtpMessages.map((message) => PostalMime.parse(message)),
    );
    const emailByLocale = new Map(
      parsedMessages.map((message) => {
        const address = message.to?.[0]?.address ?? "";
        const locale = address
          .replace("support-admin-", "")
          .replace("@example.com", "") as SupportedLocale;
        return [locale, message] as const;
      }),
    );
    for (const locale of SUPPORTED_LOCALES) {
      const message = emailByLocale.get(locale);
      expect(message?.subject).toBe(
        `${expectedCopy[locale].ticket} ${opaque.ticketPublicId}`,
      );
      expect(message?.text).toContain(opaque.subject);
      expect(message?.text).toContain(opaque.priority);
      expect(message?.text).toContain(opaque.category);
      expect(message?.text).toContain(expectedCopy[locale].cta);
      expect(message?.text).toContain(
        "https://www.umbraviaforge.com/umf-support?ticket=UFS-OPAQUE-9001",
      );
      expect(message?.html).not.toContain("undefined");
      expect(message?.html).toContain("[abre](https://evil.example)");
      expect(message?.html).not.toContain('href="https://evil.example');
      expect(message?.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(message?.html?.match(/<a /g)).toHaveLength(1);
      expect(message?.html).toContain(
        'href="https://www.umbraviaforge.com/umf-support?ticket=UFS-OPAQUE-9001"',
      );
    }
  });

  it("transports every discriminated event shape without altering its opaque fields", async () => {
    await database.db
      .updateTable("umfSupportNotificationPreferences")
      .set({ enabled: 0 })
      .where("userId", "!=", "support-admin-gl")
      .execute();
    pushMocks.sendNotification.mockClear();
    const notifications = [
      {
        event: "problem_reported" as const,
        ticketPublicId: "UFS-PROBLEM-01",
        subject: "PROBLEM SUBJECT / literal",
        priority: "problem_priority_literal",
        category: "problem_category_literal",
      },
      {
        event: "conversation_received" as const,
        ticketPublicId: "UFS-CONVERSATION-02",
        subject: "CONVERSATION SUBJECT / literal",
      },
      {
        event: "inbound_email" as const,
        ticketPublicId: "UFS-INBOUND-03",
      },
      {
        event: "feedback_received" as const,
        category: "feedback_category_literal",
      },
    ];
    const expected = notifications.map((notification) =>
      notificationService.renderUmfSupportAdministratorNotification(
        notification,
        "gl",
      ),
    );
    for (const notification of notifications) {
      await notificationService.notifyUmfSupportAdministrators(notification);
    }
    await waitFor(async () => {
      const rows = await database.db
        .selectFrom("emailDeliveries")
        .select("status")
        .where("kind", "=", "support_update")
        .where("status", "=", "retry")
        .execute();
      return rows.length === notifications.length;
    });
    const queued = await database.db
      .selectFrom("emailDeliveries")
      .select(["id", "locale", "recipient", "payloadEncrypted"])
      .where("kind", "=", "support_update")
      .where("status", "=", "retry")
      .execute();
    expect(queued).toHaveLength(notifications.length);
    expect(
      queued.every(
        (row) =>
          row.locale === "gl" &&
          row.recipient === "support-admin-gl@example.com" &&
          row.payloadEncrypted.startsWith("v2."),
      ),
    ).toBe(true);

    expect(pushMocks.sendNotification).toHaveBeenCalledTimes(
      notifications.length,
    );
    const pushed = pushMocks.sendNotification.mock.calls.map((call) =>
      JSON.parse(String(call[1])),
    );
    for (const rendered of expected) {
      expect(pushed).toContainEqual(
        expect.objectContaining({
          title: rendered.title,
          body: rendered.message,
          event: rendered.event,
        }),
      );
    }

    const smtpMessages: string[] = [];
    const smtp = await startSmtpCapture(smtpMessages);
    vi.stubEnv("SMTP_PORT", String((smtp.address() as AddressInfo).port));
    emailDelivery.resetEmailTransportForTests();
    try {
      for (const row of queued) {
        await expect(emailDelivery.deliverQueuedEmail(row.id)).resolves.toBe(
          true,
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        smtp.close((error) => (error ? reject(error) : resolve())),
      );
    }
    const parsed = await Promise.all(
      smtpMessages.map((message) => PostalMime.parse(message)),
    );
    expect(parsed).toHaveLength(notifications.length);
    for (const rendered of expected) {
      const message = parsed.find(
        (candidate) => candidate.subject === rendered.title,
      );
      expect(message?.text).toContain(rendered.message);
      expect(message?.text).toContain(
        "https://www.umbraviaforge.com/umf-support",
      );
      expect(message?.html).not.toContain("undefined");
    }
  });
});

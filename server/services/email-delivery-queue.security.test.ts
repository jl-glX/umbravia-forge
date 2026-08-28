import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

function decodeQuotedPrintableChunk(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "=" &&
      /^[0-9A-F]{2}$/i.test(value.slice(index + 1, index + 3))
    ) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(value.charCodeAt(index));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function readableSmtpMessage(raw: string): string {
  const separator = raw.indexOf("\r\n\r\n");
  const headers = separator >= 0 ? raw.slice(0, separator) : raw;
  const body = separator >= 0 ? raw.slice(separator + 4) : "";
  const decodedHeaders = headers
    .replace(/(\?=)\r\n[ \t]+(?==\?UTF-8\?Q\?)/gi, "$1")
    .replace(/\r\n[ \t]+/g, " ")
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_match, encoded: string) =>
      decodeQuotedPrintableChunk(encoded.replace(/_/g, " ")),
    );
  const decodedBody = body
    .replace(/=\r\n/g, "")
    .replace(/(?:=[0-9A-F]{2})+/gi, (encoded) =>
      decodeQuotedPrintableChunk(encoded),
    );
  return `${decodedHeaders}\r\n\r\n${decodedBody}`;
}

describe("email delivery queue security", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let auth: typeof import("./auth.js");
  let emailDelivery: typeof import("./email-delivery.js");
  let emailManager: typeof import("./email-manager.js");
  let managerCoordinator: typeof import("./manager-coordinator.js");
  let userId: string;
  let encryptionKey: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-email-queue-security-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    encryptionKey = randomBytes(32).toString("base64");
    vi.stubEnv("EMAIL_QUEUE_ENCRYPTION_KEY", encryptionKey);
    vi.resetModules();
    database = await import("../db/client.js");
    auth = await import("./auth.js");
    emailDelivery = await import("./email-delivery.js");
    emailManager = await import("./email-manager.js");
    managerCoordinator = await import("./manager-coordinator.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "email-queue-security@example.com",
      "Email Queue Security",
      "EmailQueueSecurityPassword123",
      {},
      undefined,
      { requireEmailVerification: false },
    );
    userId = account.user.id;
  }, 20_000);

  afterAll(async () => {
    emailDelivery.resetEmailTransportForTests();
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function queueRecovery(code: string, expiresAt: number) {
    return emailDelivery.queueAccountRecoveryCode({
      userId,
      platformScope: "commercial",
      email: "email-queue-security@example.com",
      name: "Synthetic Recipient",
      code,
      locale: "es",
      expiresAt,
    });
  }

  it("decodes folded UTF-8 subjects without treating header folds as body soft breaks", () => {
    const raw =
      "Subject: =?UTF-8?Q?Recupera_el_teu_compte_d=E2=80=99Umbravi?=\r\n" +
      " =?UTF-8?Q?a_Forge?=\r\nContent-Type: text/plain\r\n\r\nBody=20text";
    const readable = readableSmtpMessage(raw);
    expect(readable).toContain(
      "Subject: Recupera el teu compte d’Umbravia Forge",
    );
    expect(readable).toContain("Body text");
  });

  it("stores recovery contents only inside an authenticated ciphertext", async () => {
    const code = "654321";
    const deliveryId = await queueRecovery(code, Date.now() + 60_000);
    const stored = await database.db
      .selectFrom("emailDeliveries")
      .select([
        "platformScope",
        "recipient",
        "payloadEncrypted",
        "status",
        "attempts",
        "maxAttempts",
      ])
      .where("id", "=", deliveryId)
      .executeTakeFirstOrThrow();

    expect(stored).toMatchObject({
      platformScope: "commercial",
      status: "queued",
      attempts: 0,
      maxAttempts: emailDelivery.MAX_EMAIL_DELIVERY_ATTEMPTS,
    });
    expect(stored.payloadEncrypted).toMatch(/^v2\./);
    expect(stored.payloadEncrypted).not.toContain(code);
    expect(stored.payloadEncrypted).not.toContain("Synthetic Recipient");
    expect(stored.payloadEncrypted).not.toContain(stored.recipient);
  });

  it("canonicalizes variant and unknown locales before encryption and delivery", async () => {
    const receivedMessages: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost Umbravia queue locale test SMTP\r\n");
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
            receivedMessages.push(message);
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
            socket.write("250-localhost\r\n250 SIZE 1000000\r\n");
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
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", String(port));
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_REQUIRE_TLS", "false");
    vi.stubEnv("EMAIL_FROM", "Umbravia Forge <no-reply@localhost>");
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.com");
    emailDelivery.resetEmailTransportForTests();

    try {
      const expectDelivered = async (
        deliveryId: string,
        locale: string,
      ): Promise<void> => {
        await expect(
          database.db
            .selectFrom("emailDeliveries")
            .select("locale")
            .where("id", "=", deliveryId)
            .executeTakeFirstOrThrow(),
        ).resolves.toEqual({ locale });
        await expect(
          emailDelivery.deliverQueuedEmail(deliveryId),
        ).resolves.toBe(true);
        await expect(
          database.db
            .selectFrom("emailDeliveries")
            .select(["status", "lastError"])
            .where("id", "=", deliveryId)
            .executeTakeFirstOrThrow(),
        ).resolves.toEqual({ status: "sent", lastError: null });
      };
      const variants = [
        {
          locale: "ca_ES_valencia",
          canonical: "ca-valencia",
          code: "441122",
          email: "ca-recovery@example.com",
        },
        {
          locale: "xx",
          canonical: "es",
          code: "883344",
          email: "es-fallback-recovery@example.com",
        },
      ] as const;
      for (const variant of variants) {
        const queueInput = {
          userId,
          platformScope: "commercial",
          email: variant.email,
          name: "Synthetic Recipient",
          code: variant.code,
          locale: variant.locale as never,
          expiresAt: Date.now() + 60_000,
        } as const;
        const deliveryId =
          await emailDelivery.queueAccountRecoveryCode(queueInput);
        expect(queueInput.locale).toBe(variant.locale);
        await expectDelivered(deliveryId, variant.canonical);
      }

      await expectDelivered(
        await emailDelivery.queueAccountDeletionVerificationCode({
          userId,
          email: "fr-deletion@example.com",
          name: "Synthetic Recipient",
          code: "771155",
          locale: "FR_fr" as never,
          expiresAt: Date.now() + 60_000,
        }),
        "fr",
      );
      await expectDelivered(
        await emailDelivery.queueEmailChangedNotice({
          userId,
          platformScope: "commercial",
          oldEmail: "it-email-changed@example.com",
          newEmail: "new-email@example.com",
          name: "Synthetic Recipient",
          locale: "it_IT" as never,
          recoveryUrl: "https://www.umbraviaforge.com/recover-account",
        }),
        "it",
      );
      await expectDelivered(
        await emailDelivery.queueAccountInactivityReviewEmail({
          userId,
          email: "oc-inactivity@example.com",
          name: "Synthetic Recipient",
          locale: "oc_ES_aranes" as never,
          actionUrl: "https://www.umbraviaforge.com/account/lifecycle",
        }),
        "oc-aranes",
      );
      await expectDelivered(
        await emailDelivery.queueFacilityInvitationEmail({
          email: "admin-invite@example.com",
          name: "Invited Administrator",
          facilityName: "Umbravia Test",
          role: "admin",
          token: "admin-queue-token",
          locale: "gl",
          expiresAt: Date.now() + 60_000,
        }),
        "gl",
      );
      await expectDelivered(
        await emailDelivery.queueFacilityInvitationEmail({
          email: "worker-invite@example.com",
          name: "Invited Worker",
          facilityName: "Umbravia Test",
          role: "trainer",
          token: "worker-queue-token",
          locale: "CA_es_VALENCIA" as never,
          expiresAt: Date.now() + 60_000,
        }),
        "ca-valencia",
      );
      await expectDelivered(
        await emailDelivery.queueFacilityInvitationEmail({
          email: "member-invite@example.com",
          name: "Invited Member",
          facilityName: "Umbravia Test",
          role: "member",
          token: "member-queue-token",
          locale: "eu",
          expiresAt: Date.now() + 60_000,
        }),
        "eu",
      );
      expect(receivedMessages.join("\n")).toContain("441122");
      expect(receivedMessages.join("\n")).toContain("883344");
      expect(receivedMessages.join("\n")).toContain("771155");
      expect(receivedMessages.join("\n")).toContain("new-email@example.com");
      expect(receivedMessages.join("\n")).toContain("/account/lifecycle");
      expect(receivedMessages.join("\n")).toContain("worker-queue-token");
      expect(receivedMessages.join("\n")).toContain("member-queue-token");
      expect(receivedMessages.join("\n")).toContain("admin-queue-token");
      expect(receivedMessages.join("\n")).not.toContain("undefined");

      const messageFor = (recipient: string): string => {
        const raw = receivedMessages.find((message) =>
          message.includes(`To: ${recipient}`),
        );
        expect(raw, `missing SMTP message for ${recipient}`).toBeDefined();
        return readableSmtpMessage(raw ?? "");
      };
      const catalanRecovery = messageFor("ca-recovery@example.com");
      expect(catalanRecovery).toContain("Recupera el teu compte");
      expect(catalanRecovery).toContain(
        "Fes servir aquest codi per establir una contrasenya nova",
      );
      expect(catalanRecovery).toContain("441122");

      const spanishFallback = messageFor("es-fallback-recovery@example.com");
      expect(spanishFallback).toContain("Recupera tu cuenta");
      expect(spanishFallback).toContain("Usa este c");
      expect(spanishFallback).toContain("883344");

      const deletion = messageFor("fr-deletion@example.com");
      expect(deletion).toContain("Code de confirmation de la fermeture");
      expect(deletion).toContain("Saisissez ce code");
      expect(deletion).toContain("771155");

      const changed = messageFor("it-email-changed@example.com");
      expect(changed).toContain("email del tuo account");
      expect(changed).toContain("Le altre sessioni sono state chiuse");
      expect(changed).toContain("new-email@example.com");

      const inactivity = messageFor("oc-inactivity@example.com");
      expect(inactivity).toContain('<html lang="oc-aranes">');
      expect(inactivity).toContain(
        "Non auem registrat activitat pendent sies mesi",
      );
      expect(inactivity).toContain("/account/lifecycle");

      const worker = messageFor("worker-invite@example.com");
      expect(worker).toContain("Verificaci");
      expect(worker).toContain("com a entrenador");
      expect(worker).toContain("Umbravia Test");
      expect(worker).toContain("worker-queue-token");

      const admin = messageFor("admin-invite@example.com");
      expect(admin).toContain("Verificaci");
      expect(admin).toContain("como administrador");
      expect(admin).toContain("Umbravia Test");
      expect(admin).toContain("admin-queue-token");

      const member = messageFor("member-invite@example.com");
      expect(member).toContain("Afiliazio");
      expect(member).toContain("zure kontua kide gisa");
      expect(member).toContain("Umbravia Test");
      expect(member).toContain("member-queue-token");
    } finally {
      emailDelivery.resetEmailTransportForTests();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects and purges a manipulated ciphertext without retrying or disclosing its contents", async () => {
    const deliveryId = await queueRecovery("112233", Date.now() + 60_000);
    const stored = await database.db
      .selectFrom("emailDeliveries")
      .select("payloadEncrypted")
      .where("id", "=", deliveryId)
      .executeTakeFirstOrThrow();
    const [version, keyFingerprint, iv, authenticationTag, ciphertext] =
      stored.payloadEncrypted.split(".");
    const tamperedTag = Buffer.from(authenticationTag, "base64url");
    tamperedTag[0] ^= 0xff;
    await database.db
      .updateTable("emailDeliveries")
      .set({
        payloadEncrypted: [
          version,
          keyFingerprint,
          iv,
          tamperedTag.toString("base64url"),
          ciphertext,
        ].join("."),
      })
      .where("id", "=", deliveryId)
      .execute();

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select([
          "status",
          "attempts",
          "recipient",
          "payloadEncrypted",
          "lastError",
        ])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "failed",
      attempts: 1,
      recipient: "",
      payloadEncrypted: "",
      lastError: "payload_authentication_failed",
    });
    await expect(
      database.db
        .selectFrom("securityEvents")
        .select(["type", "metadata"])
        .where("userId", "=", userId)
        .where("type", "=", "email_delivery_payload_rejected")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      type: "email_delivery_payload_rejected",
      metadata: JSON.stringify({
        deliveryId,
        kind: "account_recovery",
      }),
    });
  });

  it("preserves the support scope in stored deliveries and failure signals", async () => {
    const deliveryId = await emailDelivery.queueUmfSupportReplyEmail({
      email: "corporate-support@example.com",
      locale: "es",
      ticketPublicId: "UMF-TEST-001",
      subject: "Synthetic support reply",
      message: "Synthetic body",
    });
    await database.db
      .updateTable("emailDeliveries")
      .set({ payloadEncrypted: "invalid-payload" })
      .where("id", "=", deliveryId)
      .execute();

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["platformScope", "status", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      platformScope: "support",
      status: "failed",
      lastError: "payload_authentication_failed",
    });
    expect(
      managerCoordinator
        .getManagerCoordinationStatus("support")
        .recentSignals.find(
          (signal) => signal.code === "EMAIL_DELIVERY_PAYLOAD_REJECTED",
        ),
    ).toMatchObject({ platformScope: "support" });
  });

  it("supersedes older recovery messages and removes their encrypted payload", async () => {
    const first = await queueRecovery("111222", Date.now() + 60_000);
    const second = await queueRecovery("333444", Date.now() + 60_000);

    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "recipient", "payloadEncrypted"])
        .where("id", "=", first)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "superseded",
      recipient: "",
      payloadEncrypted: "",
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select("status")
        .where("id", "=", second)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "queued" });
  });

  it("retains a payload when its original queue key is temporarily unavailable", async () => {
    const deliveryId = await queueRecovery("223344", Date.now() + 60_000);
    vi.stubEnv(
      "EMAIL_QUEUE_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    try {
      await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
        false,
      );
    } finally {
      vi.stubEnv("EMAIL_QUEUE_ENCRYPTION_KEY", encryptionKey);
    }

    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "payloadEncrypted", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "retry",
      attempts: 0,
      payloadEncrypted: expect.stringMatching(/^v2\./),
      lastError: "encryption_key_unavailable",
    });
  });

  it("purges an expired payload before attempting delivery", async () => {
    const deliveryId = await queueRecovery("445566", Date.now() - 1);

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "recipient", "payloadEncrypted", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "failed",
      recipient: "",
      payloadEncrypted: "",
      lastError: "expired_before_delivery",
    });
  });

  it("stops retrying and purges the payload after the final SMTP failure", async () => {
    const deliveryId = await queueRecovery("778899", Date.now() + 60_000);
    await database.db
      .updateTable("emailDeliveries")
      .set({ attempts: 4 })
      .where("id", "=", deliveryId)
      .execute();

    await expect(emailDelivery.deliverQueuedEmail(deliveryId)).resolves.toBe(
      false,
    );
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select([
          "status",
          "attempts",
          "recipient",
          "payloadEncrypted",
          "lastError",
        ])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "failed",
      attempts: 5,
      recipient: "",
      payloadEncrypted: "",
      lastError: "smtp_unavailable",
    });
  });

  it("claims a queued delivery only once when workers race", async () => {
    const deliveryId = await queueRecovery("889900", Date.now() + 60_000);

    await expect(
      Promise.all([
        emailDelivery.deliverQueuedEmail(deliveryId),
        emailDelivery.deliverQueuedEmail(deliveryId),
      ]),
    ).resolves.toEqual([false, false]);

    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "attempts", "lastError"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "retry",
      attempts: 1,
      lastError: "smtp_unavailable",
    });
  });

  it("sanitizes only terminal history and records the next 30-day review", async () => {
    const now = Date.now();
    await database.db.deleteFrom("emailDeliveries").execute();
    await expect(
      emailManager.getEmailHistorySanitizationDelayMs(now),
    ).resolves.toBe(0);

    const terminalId = await queueRecovery("901234", now + 60_000);
    await database.db
      .updateTable("emailDeliveries")
      .set({
        status: "sent",
        messageId: "smtp-message-id@example.com",
        sentAt: now,
      })
      .where("id", "=", terminalId)
      .execute();
    const waitingId = await queueRecovery("905678", now + 60_000);
    const waitingBefore = await database.db
      .selectFrom("emailDeliveries")
      .select(["recipient", "payloadEncrypted"])
      .where("id", "=", waitingId)
      .executeTakeFirstOrThrow();

    await expect(
      emailManager.sanitizeManagedEmailHistory(now),
    ).resolves.toEqual({
      count: 1,
      summary:
        "1 terminal email record(s) sanitized; the next review is due in 30 days.",
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select([
          "status",
          "userId",
          "recipient",
          "locale",
          "payloadEncrypted",
          "nextAttemptAt",
          "messageId",
          "lastError",
          "sentAt",
          "expiresAt",
        ])
        .where("id", "=", terminalId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "sent",
      userId: null,
      recipient: "",
      locale: "",
      payloadEncrypted: "",
      nextAttemptAt: 0,
      messageId: null,
      lastError: null,
      sentAt: now,
      expiresAt: 0,
    });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "recipient", "payloadEncrypted"])
        .where("id", "=", waitingId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "queued", ...waitingBefore });
    await expect(
      database.db
        .selectFrom("securityEvents")
        .select(["type", "createdAt", "metadata"])
        .where("type", "=", "email_delivery_history_sanitized")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      type: "email_delivery_history_sanitized",
      createdAt: now,
      metadata: JSON.stringify({
        sanitizedRecords: 1,
        intervalDays: 30,
        sanitizationVersion: 2,
      }),
    });
    await expect(
      emailManager.getEmailHistorySanitizationDelayMs(now),
    ).resolves.toBe(emailManager.EMAIL_HISTORY_SANITIZATION_INTERVAL_MS);
  });
});

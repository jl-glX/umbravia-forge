import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAccountDeletionPreparationMessage,
  buildEmailVerificationMessage,
  buildAccountRecoveryMessage,
  resetEmailTransportForTests,
  resolveEmailDeliveryConfiguration,
  sendEmailVerificationCode,
  sendTransactionalEmail,
} from "./email-delivery.js";

describe("email delivery configuration", () => {
  afterEach(() => {
    resetEmailTransportForTests();
    vi.unstubAllEnvs();
  });

  it("keeps email optional in isolated development environments", async () => {
    expect(resolveEmailDeliveryConfiguration({})).toBeNull();
    vi.stubEnv("NODE_ENV", "test");
    await expect(
      sendEmailVerificationCode({
        email: "member@example.com",
        name: "Member",
        code: "123456",
        locale: "en",
      }),
    ).resolves.toEqual({ delivered: false });
  });

  it("uses authenticated STARTTLS for a remote relay", () => {
    expect(
      resolveEmailDeliveryConfiguration({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
        SMTP_REQUIRE_TLS: "true",
        SMTP_USER: "smtp-user",
        SMTP_PASSWORD: "smtp-password",
        EMAIL_FROM: "Umbravia Forge <no-reply@example.com>",
      }),
    ).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTls: true,
      user: "smtp-user",
    });
  });

  it("supports an unauthenticated local mail transfer agent", () => {
    expect(
      resolveEmailDeliveryConfiguration({
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "25",
        EMAIL_FROM: "Umbravia Forge <no-reply@example.com>",
      }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 25,
      secure: false,
      requireTls: false,
      user: undefined,
      password: undefined,
    });
  });

  it("delivers a verification message through a local SMTP server", async () => {
    const receivedMessages: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost Umbravia test SMTP\r\n");
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", String(port));
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_REQUIRE_TLS", "false");
    vi.stubEnv("EMAIL_FROM", "Umbravia Forge <no-reply@localhost>");

    try {
      await expect(
        sendEmailVerificationCode({
          email: "member@example.com",
          name: "Member",
          code: "123456",
          locale: "en",
        }),
      ).resolves.toMatchObject({ delivered: true });
      await expect(
        sendTransactionalEmail({
          email: "member@example.com",
          kind: "support_update",
          subject: "Support reply",
          text: "Reply body",
          html: "<p>Reply body</p>",
          replyTo: "support+ufs-0123456789.tokenvalue@example.com",
        }),
      ).resolves.toMatchObject({ delivered: true });
      expect(receivedMessages.join("\n")).toContain("member@example.com");
      expect(receivedMessages.join("\n")).toContain("123456");
      expect(receivedMessages.join("\n")).toContain(
        "Content-ID: <umbravia-forge-email-header>",
      );
      expect(receivedMessages.join("\n")).toContain(
        "X-Auto-Response-Suppress: All",
      );
      expect(receivedMessages.join("\n")).toContain(
        "support+ufs-0123456789.tokenvalue@example.com",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects incomplete authentication and plaintext remote SMTP", () => {
    expect(() =>
      resolveEmailDeliveryConfiguration({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user",
        EMAIL_FROM: "no-reply@example.com",
      }),
    ).toThrow(/configured together/i);
    expect(() =>
      resolveEmailDeliveryConfiguration({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "25",
        SMTP_REQUIRE_TLS: "false",
        EMAIL_FROM: "no-reply@example.com",
      }),
    ).toThrow(/must use implicit TLS or require STARTTLS/i);
  });

  it("builds localized content without allowing name markup", () => {
    const message = buildEmailVerificationMessage(
      "<script>alert(1)</script>",
      "123456",
      "es",
    );
    expect(message.subject).toContain("Umbravia Forge");
    expect(message.text).toContain("123456");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain('src="cid:umbravia-forge-email-header"');
    expect(message.html).toContain("<!--[if mso]>");
    expect(message.html).toContain("<o:PixelsPerInch>96</o:PixelsPerInch>");
    expect(message.html).toContain('width="600"');
    expect(message.html).toContain("mso-table-lspace:0pt");
    expect(message.html).not.toMatch(/src="https?:/);
    expect(
      buildEmailVerificationMessage("Member", "123456", "en", false).html,
    ).not.toContain("cid:umbravia-forge-email-header");
  });

  it("builds a localized recovery message without allowing name markup", () => {
    const message = buildAccountRecoveryMessage(
      "<img src=x onerror=alert(1)>",
      "654321",
      "es",
    );
    expect(message.subject).toContain("Umbravia Forge");
    expect(message.text).toContain("654321");
    expect(message.html).toContain("&lt;img");
    expect(message.html).not.toContain("<img");
  });

  it("preserves technical account-closure details while adding the optional survey", () => {
    const message = buildAccountDeletionPreparationMessage({
      name: "<script>alert(1)</script>",
      locale: "es",
      graceEndsAt: Date.UTC(2026, 8, 12, 10, 30),
      revokedOtherSessions: true,
      removedTemporaryChallenges: true,
      accountUrl: "https://www.umbraviaforge.com/account/lifecycle",
      loginUrl: "https://www.umbraviaforge.com/login",
      recoveryUrl: "https://www.umbraviaforge.com/recover-account",
      feedbackUrl:
        "https://www.umbraviaforge.com/feedback?context=account-closure&safe=true",
    });

    expect(message.subject).toContain("cierre");
    expect(message.text).toContain("Lamentamos que te marches");
    expect(message.text).toContain("12 de septiembre de 2026");
    expect(message.text).toContain("Información técnica y de seguridad");
    expect(message.text).toContain("demás sesiones activas");
    expect(message.text).toContain("códigos y solicitudes temporales");
    expect(message.text).toContain("verificación en dos pasos");
    expect(message.text).toContain("passkeys");
    expect(message.text).toContain("encuesta es opcional");
    expect(message.text).toContain("/account/lifecycle");
    expect(message.text).toContain("Iniciar sesión");
    expect(message.text).toContain("/login");
    expect(message.text).toContain("¿No puedes acceder a tu cuenta?");
    expect(message.text).toContain("/recover-account");
    expect(message.text).toContain("context=account-closure");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("safe=true");
    expect(message.html).toContain("&amp;safe=true");
    expect(message.html).toContain(
      'href="https://www.umbraviaforge.com/login"',
    );
    expect(message.html).toContain(
      'href="https://www.umbraviaforge.com/recover-account"',
    );
    expect(message.html).toContain('width="600"');
    expect(message.html).toContain("mso-table-lspace:0pt");
  });
});

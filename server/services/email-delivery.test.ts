import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "../lib/supported-locales.js";
import {
  buildAccountDeletionPreparationMessage,
  buildFacilityInvitationMessage,
  buildEmailChangeAttemptNoticeMessage,
  buildEmailChangeVerificationMessage,
  buildEmailVerificationMessage,
  buildAccountRecoveryMessage,
  renderControlledSupportMessageHtml,
  renderUmfSupportEmailContent,
  resetEmailTransportForTests,
  resolveEmailDeliveryConfiguration,
  sendEmailVerificationCode,
  sendTransactionalEmail,
} from "./email-delivery.js";

const emailSentinels: Record<
  SupportedLocale,
  { verification: string; recovery: string; securityHeading: string }
> = {
  es: {
    verification: "Confirma tu correo en Umbravia Forge",
    recovery: "Recupera tu cuenta de Umbravia Forge",
    securityHeading: "Información técnica y de seguridad",
  },
  en: {
    verification: "Confirm your Umbravia Forge email",
    recovery: "Recover your Umbravia Forge account",
    securityHeading: "Technical and security information",
  },
  de: {
    verification: "E-Mail für Umbravia Forge bestätigen",
    recovery: "Umbravia-Forge-Konto wiederherstellen",
    securityHeading: "Technische und sicherheitsrelevante Informationen",
  },
  "de-CH": {
    verification: "E-Mail für Umbravia Forge bestätigen",
    recovery: "Umbravia-Forge-Konto wiederherstellen",
    securityHeading: "Technische und sicherheitsrelevante Informationen",
  },
  fr: {
    verification: "Confirmez votre adresse e-mail Umbravia Forge",
    recovery: "Récupérez votre compte Umbravia Forge",
    securityHeading: "Informations techniques et de sécurité",
  },
  it: {
    verification: "Conferma il tuo indirizzo email Umbravia Forge",
    recovery: "Recupera il tuo account Umbravia Forge",
    securityHeading: "Informazioni tecniche e di sicurezza",
  },
  gl: {
    verification: "Confirma o teu correo de Umbravia Forge",
    recovery: "Recupera a túa conta de Umbravia Forge",
    securityHeading: "Información técnica e de seguridade",
  },
  ca: {
    verification: "Confirma el teu correu d’Umbravia Forge",
    recovery: "Recupera el teu compte d’Umbravia Forge",
    securityHeading: "Informació tècnica i de seguretat",
  },
  "ca-valencia": {
    verification: "Confirma el teu correu d’Umbravia Forge",
    recovery: "Recupera el teu compte d’Umbravia Forge",
    securityHeading: "Informació tècnica i de seguretat",
  },
  eu: {
    verification: "Berretsi Umbravia Forge-ko helbide elektronikoa",
    recovery: "Berreskuratu Umbravia Forge-ko kontua",
    securityHeading: "Informazio teknikoa eta segurtasunekoa",
  },
  "oc-aranes": {
    verification: "Confirma eth tòn corrèu electronic d’Umbravia Forge",
    recovery: "Recupèra eth tòn compde d’Umbravia Forge",
    securityHeading: "Informacion tecnica e de seguretat",
  },
};

const invitationRoleNames: Record<
  SupportedLocale,
  Record<"admin" | "trainer" | "member", string>
> = {
  es: { admin: "administrador", trainer: "entrenador", member: "socio" },
  en: { admin: "administrator", trainer: "trainer", member: "member" },
  de: { admin: "Administrator", trainer: "Trainer", member: "Mitglied" },
  "de-CH": {
    admin: "Administrator",
    trainer: "Trainer",
    member: "Mitglied",
  },
  fr: { admin: "administrateur", trainer: "entraîneur", member: "membre" },
  it: { admin: "amministratore", trainer: "istruttore", member: "membro" },
  gl: { admin: "administrador", trainer: "adestrador", member: "socio" },
  ca: { admin: "administrador", trainer: "entrenador", member: "soci" },
  "ca-valencia": {
    admin: "administrador",
    trainer: "entrenador",
    member: "soci",
  },
  eu: {
    admin: "administratzaile",
    trainer: "entrenatzaile",
    member: "kide",
  },
  "oc-aranes": {
    admin: "administrator",
    trainer: "entrenador",
    member: "membre",
  },
};

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

  it("supports direct MX delivery only with explicit DKIM identity", () => {
    expect(
      resolveEmailDeliveryConfiguration({
        EMAIL_TRANSPORT_MODE: "direct_mx",
        EMAIL_FROM: "Umbravia Forge <no-reply@umbraviaforge.com>",
        EMAIL_DIRECT_HELO_NAME: "mail.umbraviaforge.com",
        EMAIL_DKIM_DOMAIN: "umbraviaforge.com",
        EMAIL_DKIM_SELECTOR: "mail",
        EMAIL_DKIM_PRIVATE_KEY_PATH: "/run/credentials/forge-mail-dkim-key",
      }),
    ).toMatchObject({
      mode: "direct_mx",
      heloName: "mail.umbraviaforge.com",
      requireTls: true,
      dkim: {
        domainName: "umbraviaforge.com",
        keySelector: "mail",
      },
    });
    expect(() =>
      resolveEmailDeliveryConfiguration({
        EMAIL_TRANSPORT_MODE: "direct_mx",
        EMAIL_FROM: "no-reply@umbraviaforge.com",
      }),
    ).toThrow(/EMAIL_DIRECT_HELO_NAME/);
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

  it("renders only controlled support hyperlinks and escapes arbitrary markup", () => {
    const html = renderControlledSupportMessageHtml(
      "Consulta [el ticket](https://www.umbraviaforge.com/umf-support) " +
        "o [escribe](mailto:privacy@umbraviaforge.com).\n" +
        "<script>alert(1)</script> [mal](javascript:alert(2))",
    );
    expect(html).toContain('href="https://www.umbraviaforge.com/umf-support"');
    expect(html).toContain('href="mailto:privacy@umbraviaforge.com"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("[mal](javascript:alert(2))");
  });

  it("keeps opaque support content literal and renders only its controlled action", () => {
    const value =
      "USER [abre](https://evil.example) <script>alert(1)</script> & literal";
    const withoutAction = renderUmfSupportEmailContent({
      kind: "opaque-with-action",
      value,
    });
    expect(withoutAction.text).toBe(value);
    expect(withoutAction.html).toContain(
      "[abre](https://evil.example) &lt;script&gt;alert(1)&lt;/script&gt; &amp; literal",
    );
    expect(withoutAction.html).not.toContain("<script>");
    expect(withoutAction.html).not.toContain("<a ");

    const withAction = renderUmfSupportEmailContent({
      kind: "opaque-with-action",
      value,
      action: {
        label: "Abre UMF Support",
        url: "https://www.umbraviaforge.com/umf-support",
      },
    });
    expect(withAction.text).toBe(
      `${value}\n\n[Abre UMF Support](https://www.umbraviaforge.com/umf-support)`,
    );
    expect(withAction.html).not.toContain('href="https://evil.example');
    expect(withAction.html).toContain(
      'href="https://www.umbraviaforge.com/umf-support"',
    );
    expect(withAction.html.match(/<a /g)).toHaveLength(1);
    expect(() =>
      renderUmfSupportEmailContent({
        kind: "opaque-with-action",
        value,
        action: { label: "Unsafe", url: "javascript:alert(1)" },
      }),
    ).toThrow("Invalid controlled UMF Support email action");
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

  it("builds the six-hour email-change verification and old-address security notice", () => {
    const verification = buildEmailChangeVerificationMessage(
      "Member",
      "123456",
      "es",
      6,
    );
    expect(verification.text).toContain("6 horas");

    const warning = buildEmailChangeAttemptNoticeMessage({
      name: "<script>alert(1)</script>",
      locale: "es",
      recoveryUrl: "https://www.umbraviaforge.com/recover-account",
    });
    expect(warning.text).toContain(
      "Ha habido un intento de cambio de correo de tu cuenta.",
    );
    expect(warning.text).toContain("Si no has sido tú, recupera tu cuenta");
    expect(warning.text).toContain("/recover-account");
    expect(warning.html).toContain("&lt;script&gt;");
    expect(warning.html).not.toContain("<script>");
    expect(warning.html).toContain(
      'href="https://www.umbraviaforge.com/recover-account"',
    );
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

  it("localizes every security-message family for the canonical locale set", () => {
    const verificationEs = buildEmailVerificationMessage(
      "Member",
      "123456",
      "es",
    );

    for (const locale of SUPPORTED_LOCALES) {
      const verification = buildEmailVerificationMessage(
        "Member",
        "123456",
        locale,
      );
      const change = buildEmailChangeVerificationMessage(
        "Member",
        "123456",
        locale,
        6,
      );
      const attempt = buildEmailChangeAttemptNoticeMessage({
        name: "Member",
        locale,
        recoveryUrl: "https://www.umbraviaforge.com/recover-account",
      });
      const recovery = buildAccountRecoveryMessage("Member", "654321", locale);
      expect(verification.subject).toBe(emailSentinels[locale].verification);
      expect(recovery.subject).toBe(emailSentinels[locale].recovery);
      expect(change.subject).toBeTruthy();
      expect(attempt.subject).toBeTruthy();
      expect(verification.text).toContain("123456");
      expect(change.text).toContain("123456");
      expect(attempt.text).toContain("/recover-account");
      expect(recovery.text).toContain("654321");
      expect(
        `${verification.text}${change.text}${attempt.text}${recovery.text}`,
      ).not.toContain("undefined");
    }

    const valencianVerification = buildEmailVerificationMessage(
      "Member",
      "123456",
      "ca-valencia",
    );
    const catalanVerification = buildEmailVerificationMessage(
      "Member",
      "123456",
      "ca",
    );
    expect(valencianVerification.subject).toBe(catalanVerification.subject);
    expect(valencianVerification.text).toBe(catalanVerification.text);
    expect(
      buildEmailVerificationMessage("Member", "123456", "xx" as never),
    ).toEqual(verificationEs);
  });

  it("localizes admin, trainer and member invitations for every canonical locale", () => {
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.com");
    const expiresAt = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const build = (locale: string, role: "admin" | "trainer" | "member") =>
      buildFacilityInvitationMessage({
        email: "invitee@example.com",
        name: "Invited Person",
        facilityName: "Umbravia Test",
        role,
        token: "invitation-token",
        locale: locale as never,
        expiresAt,
      });
    for (const role of ["admin", "trainer", "member"] as const) {
      const spanish = build("es", role);
      for (const locale of SUPPORTED_LOCALES) {
        const message = build(locale, role);
        expect(message.locale).toBe(locale);
        expect(message.payload.subject).toBeTruthy();
        expect(message.payload.text).toContain(
          invitationRoleNames[locale][role],
        );
        expect(message.payload.text).toContain("Umbravia Test");
        expect(message.payload.text).toContain("invitation-token");
        expect(
          `${message.payload.subject}${message.payload.text}${message.payload.html}`,
        ).not.toContain("undefined");
      }
      const valencian = build("ca-valencia", role).payload;
      const catalan = build("ca", role).payload;
      expect(valencian.subject).toBe(catalan.subject);
      expect(valencian.text).toBe(catalan.text);
      expect(valencian.html).toBe(catalan.html);
      expect(build("xx", role)).toEqual(spanish);
    }
  });

  it("uses resolved Intl locales and localized security details for account closure", () => {
    const build = (locale: string) =>
      buildAccountDeletionPreparationMessage({
        name: "Member",
        locale: locale as never,
        graceEndsAt: Date.UTC(2026, 8, 12, 10, 30),
        revokedOtherSessions: true,
        removedTemporaryChallenges: true,
        accountUrl: "https://www.umbraviaforge.com/account/lifecycle",
        loginUrl: "https://www.umbraviaforge.com/login",
        recoveryUrl: "https://www.umbraviaforge.com/recover-account",
        feedbackUrl:
          "https://www.umbraviaforge.com/feedback?context=account-closure",
      });
    const spanish = build("es");
    for (const locale of SUPPORTED_LOCALES) {
      const message = build(locale);
      expect(message.subject).toBeTruthy();
      expect(message.text).toContain("/account/lifecycle");
      expect(message.text).toContain("/recover-account");
      expect(message.html).toContain(`<html lang="${locale}">`);
      expect(message.text).toContain(emailSentinels[locale].securityHeading);
    }
    expect(build("ca-valencia").subject).toBe(build("ca").subject);
    expect(build("ca-valencia").text).toBe(build("ca").text);
    expect(build("xx")).toEqual(spanish);
  });
});

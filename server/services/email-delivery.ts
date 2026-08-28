import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import { authenticatedModernTlsOptions } from "../lib/transport-security.js";
import {
  DirectEmailTransportError,
  sendDirectEmail,
  type DirectEmailTransportConfiguration,
} from "./email-direct-transport.js";
import {
  publishManagerSignal,
  type ManagerPlatformScope,
} from "./manager-coordinator.js";
import { recordSecurityEvent } from "./security-events.js";
import { readUmfSupportMailDeliveryAttachments } from "./umf-support-mail-attachments.js";
import { getAllowedClientOrigins } from "../lib/request-origin.js";
import {
  canonicalizeLocale,
  isSupportedLocale,
  resolveIntlLocale,
  type SupportedLocale,
} from "../lib/supported-locales.js";

type BaseEmailLocale = Exclude<SupportedLocale, "de-CH" | "ca-valencia">;

function withRegionalEmailFallbacks<T>(
  messages: Record<BaseEmailLocale, T>,
  regional: { deCH?: T; caValencia?: T } = {},
): Record<SupportedLocale, T> {
  return {
    ...messages,
    "de-CH": regional.deCH ?? messages.de,
    "ca-valencia": regional.caValencia ?? messages.ca,
  };
}
type EmailDeliveryPayload = {
  email: string;
  name?: string;
  code?: string;
  locale: SupportedLocale;
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
  purpose?: "account_inactivity_review" | "account_deletion_preparation";
  reminder?: boolean;
  reviewDeliveryId?: string;
  attachmentIds?: string[];
};
type EmailDeliveryKind =
  | "email_verification"
  | "account_recovery"
  | "support_update"
  | "security_notice";

type SmtpEmailDeliveryConfiguration = {
  mode: "smtp";
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user?: string;
  password?: string;
  from: string;
};

export type EmailDeliveryConfiguration =
  SmtpEmailDeliveryConfiguration | DirectEmailTransportConfiguration;

type VerificationMessage = {
  subject: string;
  text: string;
  html: string;
};

export const MAX_EMAIL_DELIVERY_ATTEMPTS = 5;

type EmailAttachment = {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
  cid?: string;
  contentDisposition: "inline" | "attachment";
};

const VERIFICATION_HEADER_FILENAME = "umbravia-forge-email-header.jpg";
const VERIFICATION_HEADER_CID = "umbravia-forge-email-header";

export class EmailDeliveryUnavailableError extends Error {
  readonly cause?: Error;
  readonly retryable: boolean;

  constructor(cause?: Error, retryable = true) {
    super("Email delivery is unavailable");
    this.name = "EmailDeliveryUnavailableError";
    this.cause = cause;
    this.retryable = retryable;
  }
}

class EmailQueuePayloadError extends Error {
  constructor() {
    super("Encrypted email queue payload could not be authenticated");
    this.name = "EmailQueuePayloadError";
  }
}

class EmailQueueEncryptionKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailQueueEncryptionKeyUnavailableError";
  }
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterFingerprint = "";

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function resolveEmailDeliveryConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): EmailDeliveryConfiguration | null {
  const mode = environment.EMAIL_TRANSPORT_MODE?.trim() || "smtp";
  const host = environment.SMTP_HOST?.trim();
  const from = environment.EMAIL_FROM?.trim();
  const user = environment.SMTP_USER?.trim();
  const password = environment.SMTP_PASSWORD?.trim();
  const hasAnyConfiguration = Boolean(
    host ||
    from ||
    environment.SMTP_PORT ||
    environment.SMTP_SECURE ||
    environment.SMTP_REQUIRE_TLS ||
    user ||
    password ||
    environment.EMAIL_TRANSPORT_MODE ||
    environment.EMAIL_DIRECT_HELO_NAME ||
    environment.EMAIL_DIRECT_LOCAL_ADDRESS ||
    environment.EMAIL_DKIM_DOMAIN ||
    environment.EMAIL_DKIM_SELECTOR ||
    environment.EMAIL_DKIM_PRIVATE_KEY_PATH,
  );

  if (!hasAnyConfiguration) return null;
  if (!new Set(["smtp", "direct_mx"]).has(mode)) {
    throw new Error("EMAIL_TRANSPORT_MODE must be smtp or direct_mx");
  }
  if (!from)
    throw new Error("EMAIL_FROM is required when email delivery is configured");

  if (mode === "direct_mx") {
    const heloName = environment.EMAIL_DIRECT_HELO_NAME?.trim();
    const domainName = environment.EMAIL_DKIM_DOMAIN?.trim();
    const keySelector = environment.EMAIL_DKIM_SELECTOR?.trim();
    const privateKeyPath = environment.EMAIL_DKIM_PRIVATE_KEY_PATH?.trim();
    if (!heloName) {
      throw new Error(
        "EMAIL_DIRECT_HELO_NAME is required for direct MX delivery",
      );
    }
    if (!domainName || !keySelector || !privateKeyPath) {
      throw new Error(
        "EMAIL_DKIM_DOMAIN, EMAIL_DKIM_SELECTOR and EMAIL_DKIM_PRIVATE_KEY_PATH are required for direct MX delivery",
      );
    }
    return {
      mode: "direct_mx",
      from,
      heloName,
      localAddress: environment.EMAIL_DIRECT_LOCAL_ADDRESS?.trim() || undefined,
      requireTls: true,
      dkim: { domainName, keySelector, privateKeyPath },
    };
  }

  if (!host)
    throw new Error("SMTP_HOST is required when email delivery is configured");
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  }

  const port = parsePort(environment.SMTP_PORT);
  const secure = parseBoolean(
    environment.SMTP_SECURE,
    port === 465,
    "SMTP_SECURE",
  );
  const requireTls = parseBoolean(
    environment.SMTP_REQUIRE_TLS,
    !secure && !isLoopbackHost(host),
    "SMTP_REQUIRE_TLS",
  );
  if (!isLoopbackHost(host) && !secure && !requireTls) {
    throw new Error(
      "Remote SMTP connections must use implicit TLS or require STARTTLS",
    );
  }
  return {
    mode: "smtp",
    host,
    port,
    secure,
    requireTls,
    user: user || undefined,
    password: password || undefined,
    from,
  };
}

export function emailDeliveryIsConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveEmailDeliveryConfiguration(environment) !== null;
}

export function resolveEmailQueueEncryptionKey(
  environment: NodeJS.ProcessEnv = process.env,
): Buffer {
  const configured = environment.EMAIL_QUEUE_ENCRYPTION_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== configured) {
      throw new EmailQueueEncryptionKeyUnavailableError(
        "EMAIL_QUEUE_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64",
      );
    }
    return decoded;
  }
  if (environment.NODE_ENV === "production") {
    throw new EmailQueueEncryptionKeyUnavailableError(
      "EMAIL_QUEUE_ENCRYPTION_KEY is required in production",
    );
  }
  return createHash("sha256")
    .update("umbravia-forge-development-email-queue")
    .digest();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function verificationHeaderAttachment(): EmailAttachment | undefined {
  const candidates = [
    path.resolve(
      process.cwd(),
      "dist",
      "public",
      "brand",
      VERIFICATION_HEADER_FILENAME,
    ),
    path.resolve(
      process.cwd(),
      "client",
      "public",
      "brand",
      VERIFICATION_HEADER_FILENAME,
    ),
  ];
  const assetPath = candidates.find((candidate) => existsSync(candidate));
  return assetPath
    ? {
        filename: VERIFICATION_HEADER_FILENAME,
        path: assetPath,
        cid: VERIFICATION_HEADER_CID,
        contentDisposition: "inline",
      }
    : undefined;
}

function brandedVerificationHtml(input: {
  locale: SupportedLocale;
  greeting: string;
  instruction: string;
  code: string;
  expiry: string;
  includeHeader: boolean;
}): string {
  const header = input.includeHeader
    ? `<tr><td style="padding:0"><img src="cid:${VERIFICATION_HEADER_CID}" width="600" alt="Umbravia Forge" style="display:block;width:100%;max-width:600px;height:auto;border:0" /></td></tr>`
    : "";
  return `<!doctype html><html lang="${escapeHtml(input.locale)}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head><body style="margin:0;padding:0;background:#f4f5f6;color:#0f1720;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.instruction)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;overflow:hidden">${header}<tr><td style="padding:32px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(input.greeting)}</p><p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(input.instruction)}</p><div style="margin:0 0 24px;padding:18px 20px;background:#f8fafc;border:1px solid #d8dee5;border-radius:12px;text-align:center;color:#0f1720;font-size:30px;font-weight:700;letter-spacing:0.22em">${escapeHtml(input.code)}</div><p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280">${escapeHtml(input.expiry)}</p></td></tr></table></td></tr></table></body></html>`;
}

export function buildEmailVerificationMessage(
  name: string,
  code: string,
  locale: SupportedLocale,
  includeHeader = true,
): VerificationMessage {
  const messages = withRegionalEmailFallbacks({
    es: {
      subject: "Confirma tu correo en Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Usa este código para confirmar tu cuenta de Umbravia Forge:",
      expiry:
        "El código caduca en 15 minutos. Si no has creado esta cuenta, puedes ignorar este mensaje.",
    },
    en: {
      subject: "Confirm your Umbravia Forge email",
      greeting: `Hello, ${name}:`,
      instruction: "Use this code to confirm your Umbravia Forge account:",
      expiry:
        "The code expires in 15 minutes. If you did not create this account, you can ignore this message.",
    },
    de: {
      subject: "E-Mail für Umbravia Forge bestätigen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um Ihr Umbravia-Forge-Konto zu bestätigen:",
      expiry:
        "Der Code läuft in 15 Minuten ab. Wenn Sie dieses Konto nicht erstellt haben, können Sie diese Nachricht ignorieren.",
    },
    fr: {
      subject: "Confirmez votre adresse e-mail Umbravia Forge",
      greeting: `Bonjour, ${name} :`,
      instruction:
        "Utilisez ce code pour confirmer votre compte Umbravia Forge :",
      expiry:
        "Le code expire dans 15 minutes. Si vous n’avez pas créé ce compte, vous pouvez ignorer ce message.",
    },
    it: {
      subject: "Conferma il tuo indirizzo email Umbravia Forge",
      greeting: `Ciao, ${name}:`,
      instruction:
        "Usa questo codice per confermare il tuo account Umbravia Forge:",
      expiry:
        "Il codice scade tra 15 minuti. Se non hai creato questo account, puoi ignorare questo messaggio.",
    },
    gl: {
      subject: "Confirma o teu correo de Umbravia Forge",
      greeting: `Ola, ${name}:`,
      instruction:
        "Usa este código para confirmar a túa conta de Umbravia Forge:",
      expiry:
        "O código caduca en 15 minutos. Se non creaches esta conta, podes ignorar esta mensaxe.",
    },
    ca: {
      subject: "Confirma el teu correu d’Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Fes servir aquest codi per confirmar el teu compte d’Umbravia Forge:",
      expiry:
        "El codi caduca d’aquí a 15 minuts. Si no has creat aquest compte, pots ignorar aquest missatge.",
    },
    eu: {
      subject: "Berretsi Umbravia Forge-ko helbide elektronikoa",
      greeting: `Kaixo, ${name}:`,
      instruction: "Erabili kode hau Umbravia Forge-ko kontua berresteko:",
      expiry:
        "Kodea 15 minutu barru iraungiko da. Kontu hau ez baduzu sortu, ez ikusi mezu hau.",
    },
    "oc-aranes": {
      subject: "Confirma eth tòn corrèu electronic d’Umbravia Forge",
      greeting: `Adiu, ${name}:`,
      instruction:
        "Utiliza aguest còdi entà confirmar eth tòn compde d’Umbravia Forge:",
      expiry:
        "Eth còdi caduque en 15 minutes. Se non as creat aguest compde, pòs ignorar aguest messatge.",
    },
  });
  const effectiveLocale = canonicalizeLocale(locale);
  const message = messages[effectiveLocale];
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.instruction}\n\n${code}\n\n${message.expiry}`,
    html: brandedVerificationHtml({
      locale: effectiveLocale,
      greeting: message.greeting,
      instruction: message.instruction,
      code,
      expiry: message.expiry,
      includeHeader,
    }),
  };
}

export function buildEmailChangeVerificationMessage(
  name: string,
  code: string,
  locale: SupportedLocale,
  validityHours: number,
): VerificationMessage {
  const messages = withRegionalEmailFallbacks({
    es: {
      subject: "Confirma tu nuevo correo de Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Usa este código para verificar el nuevo correo de tu cuenta:",
      expiry: `El código caduca en ${validityHours} horas. Si no has solicitado el cambio, no lo compartas y revisa la seguridad de tu cuenta.`,
    },
    en: {
      subject: "Confirm your new Umbravia Forge email",
      greeting: `Hello, ${name}:`,
      instruction: "Use this code to verify your account's new email address:",
      expiry: `The code expires in ${validityHours} hours. If you did not request this change, do not share it and review your account security.`,
    },
    de: {
      subject: "Neue E-Mail-Adresse für Umbravia Forge bestätigen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um die neue E-Mail-Adresse Ihres Kontos zu bestätigen:",
      expiry: `Der Code läuft in ${validityHours} Stunden ab. Wenn Sie diese Änderung nicht angefordert haben, geben Sie ihn nicht weiter und überprüfen Sie die Kontosicherheit.`,
    },
    fr: {
      subject: "Confirmez votre nouvelle adresse e-mail Umbravia Forge",
      greeting: `Bonjour, ${name} :`,
      instruction:
        "Utilisez ce code pour vérifier la nouvelle adresse e-mail de votre compte :",
      expiry: `Le code expire dans ${validityHours} heures. Si vous n’avez pas demandé ce changement, ne le partagez pas et vérifiez la sécurité de votre compte.`,
    },
    it: {
      subject: "Conferma la nuova email di Umbravia Forge",
      greeting: `Ciao, ${name}:`,
      instruction:
        "Usa questo codice per verificare il nuovo indirizzo email del tuo account:",
      expiry: `Il codice scade tra ${validityHours} ore. Se non hai richiesto questa modifica, non condividerlo e controlla la sicurezza del tuo account.`,
    },
    gl: {
      subject: "Confirma o teu novo correo de Umbravia Forge",
      greeting: `Ola, ${name}:`,
      instruction: "Usa este código para verificar o novo correo da túa conta:",
      expiry: `O código caduca en ${validityHours} horas. Se non solicitaches o cambio, non o compartas e revisa a seguridade da túa conta.`,
    },
    ca: {
      subject: "Confirma el teu nou correu d’Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Fes servir aquest codi per verificar el nou correu del teu compte:",
      expiry: `El codi caduca d’aquí a ${validityHours} hores. Si no has sol·licitat el canvi, no el comparteixis i revisa la seguretat del compte.`,
    },
    eu: {
      subject: "Berretsi Umbravia Forge-ko helbide elektroniko berria",
      greeting: `Kaixo, ${name}:`,
      instruction:
        "Erabili kode hau kontuaren helbide elektroniko berria egiaztatzeko:",
      expiry: `Kodea ${validityHours} ordu barru iraungiko da. Aldaketa eskatu ez baduzu, ez partekatu eta berrikusi kontuaren segurtasuna.`,
    },
    "oc-aranes": {
      subject: "Confirma eth tòn nau corrèu electronic d’Umbravia Forge",
      greeting: `Adiu, ${name}:`,
      instruction:
        "Utiliza aguest còdi entà verificar eth nau corrèu electronic deth tòn compde:",
      expiry: `Eth còdi caduque en ${validityHours} ores. Se non as demanat eth cambi, non lo compartisques e revise era seguretat deth tòn compde.`,
    },
  });
  const effectiveLocale = canonicalizeLocale(locale);
  const message = messages[effectiveLocale];
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.instruction}\n\n${code}\n\n${message.expiry}`,
    html: brandedVerificationHtml({
      locale: effectiveLocale,
      greeting: message.greeting,
      instruction: message.instruction,
      code,
      expiry: message.expiry,
      includeHeader: false,
    }),
  };
}

export function buildEmailChangeAttemptNoticeMessage(input: {
  name: string;
  locale: SupportedLocale;
  recoveryUrl: string;
}): VerificationMessage {
  const content = withRegionalEmailFallbacks({
    es: {
      subject: "Intento de cambio de correo en tu cuenta",
      greeting: `Hola, ${input.name}:`,
      notice: "Ha habido un intento de cambio de correo de tu cuenta.",
      action: "Si no has sido tú, recupera tu cuenta",
    },
    en: {
      subject: "Attempt to change your account email",
      greeting: `Hello, ${input.name}:`,
      notice: "There has been an attempt to change your account email.",
      action: "If this was not you, recover your account",
    },
    de: {
      subject: "Versuch, die E-Mail-Adresse Ihres Kontos zu ändern",
      greeting: `Hallo, ${input.name}:`,
      notice: "Es wurde versucht, die E-Mail-Adresse Ihres Kontos zu ändern.",
      action: "Wenn Sie das nicht waren, stellen Sie Ihr Konto wieder her",
    },
    fr: {
      subject: "Tentative de modification de l’adresse e-mail de votre compte",
      greeting: `Bonjour, ${input.name} :`,
      notice:
        "Une tentative de modification de l’adresse e-mail de votre compte a eu lieu.",
      action:
        "Si vous n’êtes pas à l’origine de cette action, récupérez votre compte",
    },
    it: {
      subject: "Tentativo di modifica dell’email del tuo account",
      greeting: `Ciao, ${input.name}:`,
      notice:
        "È stato effettuato un tentativo di modifica dell’email del tuo account.",
      action: "Se non sei stato tu, recupera il tuo account",
    },
    gl: {
      subject: "Intento de cambio do correo da túa conta",
      greeting: `Ola, ${input.name}:`,
      notice: "Houbo un intento de cambio do correo da túa conta.",
      action: "Se non fuches ti, recupera a túa conta",
    },
    ca: {
      subject: "Intent de canvi del correu del teu compte",
      greeting: `Hola, ${input.name}:`,
      notice: "Hi ha hagut un intent de canvi del correu del teu compte.",
      action: "Si no has estat tu, recupera el compte",
    },
    eu: {
      subject: "Kontuaren helbide elektronikoa aldatzeko saiakera",
      greeting: `Kaixo, ${input.name}:`,
      notice:
        "Zure kontuaren helbide elektronikoa aldatzeko saiakera bat egon da.",
      action: "Zuk egin ez baduzu, berreskuratu kontua",
    },
    "oc-aranes": {
      subject: "Saj d’cambi deth corrèu electronic deth tòn compde",
      greeting: `Adiu, ${input.name}:`,
      notice:
        "I a agut un saj de cambiar eth corrèu electronic deth tòn compde.",
      action: "Se non as estat tu, recupèra eth tòn compde",
    },
  });
  const effectiveLocale = canonicalizeLocale(input.locale);
  const message = content[effectiveLocale];
  const safeRecoveryUrl = escapeHtml(input.recoveryUrl);
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.notice}\n\n${message.action}: ${input.recoveryUrl}`,
    html: `<p>${escapeHtml(message.greeting)}</p><p>${escapeHtml(message.notice)}</p><p><a href="${safeRecoveryUrl}">${escapeHtml(message.action)}</a></p>`,
  };
}

export function buildAccountRecoveryMessage(
  name: string,
  code: string,
  locale: SupportedLocale,
): VerificationMessage {
  const messages = withRegionalEmailFallbacks({
    es: {
      subject: "Recupera tu cuenta de Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Usa este código para establecer una contraseña nueva en Umbravia Forge:",
      expiry:
        "El código caduca en 15 minutos y solo puede utilizarse una vez. Si no has solicitado la recuperación, ignora este mensaje y revisa la seguridad de tu cuenta.",
    },
    en: {
      subject: "Recover your Umbravia Forge account",
      greeting: `Hello, ${name}:`,
      instruction:
        "Use this code to set a new password for your Umbravia Forge account:",
      expiry:
        "The code expires in 15 minutes and can only be used once. If you did not request recovery, ignore this message and review your account security.",
    },
    de: {
      subject: "Umbravia-Forge-Konto wiederherstellen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um ein neues Passwort für Ihr Umbravia-Forge-Konto festzulegen:",
      expiry:
        "Der Code läuft in 15 Minuten ab und kann nur einmal verwendet werden. Wenn Sie die Wiederherstellung nicht angefordert haben, ignorieren Sie diese Nachricht und überprüfen Sie die Sicherheit Ihres Kontos.",
    },
    fr: {
      subject: "Récupérez votre compte Umbravia Forge",
      greeting: `Bonjour, ${name} :`,
      instruction:
        "Utilisez ce code pour définir un nouveau mot de passe pour votre compte Umbravia Forge :",
      expiry:
        "Le code expire dans 15 minutes et ne peut être utilisé qu’une fois. Si vous n’avez pas demandé la récupération, ignorez ce message et vérifiez la sécurité de votre compte.",
    },
    it: {
      subject: "Recupera il tuo account Umbravia Forge",
      greeting: `Ciao, ${name}:`,
      instruction:
        "Usa questo codice per impostare una nuova password per il tuo account Umbravia Forge:",
      expiry:
        "Il codice scade tra 15 minuti e può essere usato una sola volta. Se non hai richiesto il recupero, ignora questo messaggio e controlla la sicurezza del tuo account.",
    },
    gl: {
      subject: "Recupera a túa conta de Umbravia Forge",
      greeting: `Ola, ${name}:`,
      instruction:
        "Usa este código para establecer un novo contrasinal na túa conta de Umbravia Forge:",
      expiry:
        "O código caduca en 15 minutos e só pode utilizarse unha vez. Se non solicitaches a recuperación, ignora esta mensaxe e revisa a seguridade da túa conta.",
    },
    ca: {
      subject: "Recupera el teu compte d’Umbravia Forge",
      greeting: `Hola, ${name}:`,
      instruction:
        "Fes servir aquest codi per establir una contrasenya nova al teu compte d’Umbravia Forge:",
      expiry:
        "El codi caduca d’aquí a 15 minuts i només es pot utilitzar una vegada. Si no has sol·licitat la recuperació, ignora aquest missatge i revisa la seguretat del compte.",
    },
    eu: {
      subject: "Berreskuratu Umbravia Forge-ko kontua",
      greeting: `Kaixo, ${name}:`,
      instruction:
        "Erabili kode hau Umbravia Forge-ko konturako pasahitz berria ezartzeko:",
      expiry:
        "Kodea 15 minutu barru iraungiko da eta behin bakarrik erabil daiteke. Berreskuratzea eskatu ez baduzu, ez ikusi mezu hau eta berrikusi kontuaren segurtasuna.",
    },
    "oc-aranes": {
      subject: "Recupèra eth tòn compde d’Umbravia Forge",
      greeting: `Adiu, ${name}:`,
      instruction:
        "Utiliza aguest còdi entà definir ua contrasenha naua en tòn compde d’Umbravia Forge:",
      expiry:
        "Eth còdi caduque en 15 minutes e sonque se pòt utilizar un còp. Se non as demanat era recuperacion, ignora aguest messatge e revise era seguretat deth tòn compde.",
    },
  });
  const message = messages[canonicalizeLocale(locale)];
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.instruction}\n\n${code}\n\n${message.expiry}`,
    html: `<p>${escapeHtml(message.greeting)}</p><p>${escapeHtml(message.instruction)}</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${escapeHtml(code)}</p><p>${escapeHtml(message.expiry)}</p>`,
  };
}

function configuredTransport(configuration: SmtpEmailDeliveryConfiguration) {
  const fingerprint = JSON.stringify(configuration);
  if (transporter && fingerprint === transporterFingerprint) return transporter;
  transporterFingerprint = fingerprint;
  transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: configuration.requireTls,
    ignoreTLS: !configuration.secure && !configuration.requireTls,
    tls: isLoopbackHost(configuration.host)
      ? undefined
      : authenticatedModernTlsOptions(),
    auth:
      configuration.user && configuration.password
        ? { user: configuration.user, pass: configuration.password }
        : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendEmailVerificationCode(input: {
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
}): Promise<{ delivered: boolean; messageId?: string }> {
  const headerAttachment = verificationHeaderAttachment();
  const message = buildEmailVerificationMessage(
    input.name,
    input.code,
    input.locale,
    Boolean(headerAttachment),
  );
  return sendTransactionalEmail({
    email: input.email,
    kind: "email_verification",
    ...message,
    attachments: headerAttachment ? [headerAttachment] : undefined,
  });
}

export async function sendTransactionalEmail(input: {
  email: string;
  kind: EmailDeliveryKind;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<{ delivered: boolean; messageId?: string }> {
  const configuration = resolveEmailDeliveryConfiguration();
  if (!configuration) {
    if (process.env.NODE_ENV === "production") {
      throw new EmailDeliveryUnavailableError();
    }
    return { delivered: false };
  }

  try {
    const message = {
      from: configuration.from,
      to: input.email,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments,
      headers: {
        "X-Umbravia-Message-Type": input.kind.replace(/_/g, "-"),
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    };
    const result =
      configuration.mode === "direct_mx"
        ? await sendDirectEmail(configuration, message)
        : await configuredTransport(configuration).sendMail(message);
    return { delivered: true, messageId: result.messageId };
  } catch (cause) {
    throw new EmailDeliveryUnavailableError(
      cause instanceof Error ? cause : undefined,
      cause instanceof DirectEmailTransportError ? cause.retryable : true,
    );
  }
}

async function queueEncryptedDelivery(input: {
  userId: string | null;
  platformScope: ManagerPlatformScope;
  kind: EmailDeliveryKind;
  recipient: string;
  locale: SupportedLocale;
  payload: EmailDeliveryPayload;
  expiresAt: number;
  nextAttemptAt?: number;
  supersedePending?: boolean;
}): Promise<string> {
  const now = Date.now();
  const locale = canonicalizeLocale(input.locale);
  const payload: EmailDeliveryPayload = { ...input.payload, locale };
  const nextAttemptAt = input.nextAttemptAt ?? now;
  if (
    input.nextAttemptAt !== undefined &&
    (nextAttemptAt < now || nextAttemptAt >= input.expiresAt)
  ) {
    throw new Error("Email delivery schedule is outside its retention window");
  }
  const id = `email-delivery-${randomUUID()}`;
  await db.transaction().execute(async (transaction) => {
    if (input.supersedePending && input.userId) {
      await transaction
        .updateTable("emailDeliveries")
        .set({
          status: "superseded",
          recipient: "",
          payloadEncrypted: "",
          updatedAt: now,
        })
        .where("userId", "=", input.userId)
        .where("platformScope", "=", input.platformScope)
        .where("kind", "=", input.kind)
        .where("status", "in", ["queued", "retry", "processing"])
        .execute();
    }
    await transaction
      .insertInto("emailDeliveries")
      .values({
        id,
        userId: input.userId,
        platformScope: input.platformScope,
        kind: input.kind,
        recipient: input.recipient,
        locale,
        payloadEncrypted: encryptPayload(id, payload),
        status: "queued",
        attempts: 0,
        maxAttempts: MAX_EMAIL_DELIVERY_ATTEMPTS,
        nextAttemptAt,
        messageId: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        sentAt: null,
        expiresAt: input.expiresAt,
      })
      .execute();
  });
  return id;
}

function encryptPayload(id: string, payload: EmailDeliveryPayload): string {
  const key = resolveEmailQueueEncryptionKey();
  const keyFingerprint = createHash("sha256")
    .update(key)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`v2:${id}:${keyFingerprint}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    keyFingerprint,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function validateDecryptedPayload(
  kind: EmailDeliveryKind,
  candidate: unknown,
): EmailDeliveryPayload {
  const payload = candidate as Partial<EmailDeliveryPayload> | null;
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.email !== "string" ||
    payload.email.trim() === "" ||
    !isSupportedLocale(payload.locale)
  ) {
    throw new EmailQueuePayloadError();
  }

  if (kind === "email_verification") {
    if (
      typeof payload.name !== "string" ||
      payload.name.trim() === "" ||
      typeof payload.code !== "string" ||
      payload.code.trim() === ""
    ) {
      throw new EmailQueuePayloadError();
    }
  } else if (
    typeof payload.subject !== "string" ||
    typeof payload.text !== "string" ||
    typeof payload.html !== "string" ||
    (payload.replyTo !== undefined && typeof payload.replyTo !== "string")
  ) {
    throw new EmailQueuePayloadError();
  }
  if (
    payload.purpose !== undefined &&
    payload.purpose !== "account_inactivity_review" &&
    payload.purpose !== "account_deletion_preparation"
  ) {
    throw new EmailQueuePayloadError();
  }
  if (payload.reminder !== undefined && typeof payload.reminder !== "boolean") {
    throw new EmailQueuePayloadError();
  }
  if (
    payload.reviewDeliveryId !== undefined &&
    typeof payload.reviewDeliveryId !== "string"
  ) {
    throw new EmailQueuePayloadError();
  }

  return payload as EmailDeliveryPayload;
}

function decryptPayload(
  id: string,
  kind: EmailDeliveryKind,
  encrypted: string,
): EmailDeliveryPayload {
  const segments = encrypted.split(".");
  const version = segments[0];

  const key = resolveEmailQueueEncryptionKey();
  const currentFingerprint = createHash("sha256")
    .update(key)
    .digest()
    .subarray(0, 16)
    .toString("base64url");

  try {
    let iv: string;
    let tag: string;
    let ciphertext: string;
    let additionalData: string;

    if (version === "v2") {
      const [, keyFingerprint, parsedIv, parsedTag, parsedCiphertext] =
        segments;
      if (!keyFingerprint || !parsedIv || !parsedTag || !parsedCiphertext) {
        throw new EmailQueuePayloadError();
      }
      if (keyFingerprint !== currentFingerprint) {
        throw new EmailQueueEncryptionKeyUnavailableError(
          "The encrypted email payload requires a different queue key",
        );
      }
      iv = parsedIv;
      tag = parsedTag;
      ciphertext = parsedCiphertext;
      additionalData = `v2:${id}:${keyFingerprint}`;
    } else if (version === "v1") {
      const [, parsedIv, parsedTag, parsedCiphertext] = segments;
      if (!parsedIv || !parsedTag || !parsedCiphertext) {
        throw new EmailQueuePayloadError();
      }
      iv = parsedIv;
      tag = parsedTag;
      ciphertext = parsedCiphertext;
      additionalData = id;
    } else {
      throw new EmailQueuePayloadError();
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(additionalData));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const payload = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    ) as unknown;
    return validateDecryptedPayload(kind, payload);
  } catch (error) {
    if (
      error instanceof EmailQueuePayloadError ||
      error instanceof EmailQueueEncryptionKeyUnavailableError
    ) {
      throw error;
    }
    throw new EmailQueuePayloadError();
  }
}

export async function queueEmailVerificationCode(input: {
  userId: string;
  platformScope: ManagerPlatformScope;
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
}): Promise<string> {
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "email_verification",
    recipient: input.email,
    locale: input.locale,
    payload: input,
    expiresAt: input.expiresAt,
    supersedePending: true,
  });
  publishManagerSignal(
    "email",
    input.platformScope,
    "info",
    "EMAIL_VERIFICATION_QUEUED",
    "A verification message was queued for delivery.",
  );
  return id;
}

function escapeInvitationHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type FacilityInvitationEmailInput = {
  email: string;
  name: string;
  facilityName: string;
  role: "admin" | "trainer" | "member";
  token: string;
  locale: SupportedLocale;
  expiresAt: number;
};

export function buildFacilityInvitationMessage(
  input: FacilityInvitationEmailInput,
): { locale: SupportedLocale; payload: EmailDeliveryPayload } {
  const locale = canonicalizeLocale(input.locale);
  const origin = getAllowedClientOrigins()[0];
  if (!origin) throw new Error("CLIENT_ORIGIN is required for invitations");
  const invitationUrl = `${origin}/facility-invitation?token=${encodeURIComponent(input.token)}`;
  const validityDays = Math.max(
    1,
    Math.ceil((input.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  const roleNames = withRegionalEmailFallbacks({
    es: { admin: "administrador", trainer: "entrenador", member: "socio" },
    en: { admin: "administrator", trainer: "trainer", member: "member" },
    de: { admin: "Administrator", trainer: "Trainer", member: "Mitglied" },
    fr: { admin: "administrateur", trainer: "entraîneur", member: "membre" },
    it: { admin: "amministratore", trainer: "istruttore", member: "membro" },
    gl: { admin: "administrador", trainer: "adestrador", member: "socio" },
    ca: { admin: "administrador", trainer: "entrenador", member: "soci" },
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
  });
  const roleName = roleNames[locale][input.role];
  const workerContent = withRegionalEmailFallbacks({
    es: {
      subject: `Verificación laboral con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} ha iniciado tu verificación como ${roleName}.`,
      action:
        "Revisa los datos y confirma o rechaza la vinculación laboral desde el enlace. Si ya tienes una cuenta, inicia sesión con el correo que ha recibido este mensaje.",
      expiry: `El enlace de verificación caduca en ${validityDays} días y solo puede utilizarse una vez.`,
    },
    en: {
      subject: `Worker verification with ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} has started your verification as ${roleName}.`,
      action:
        "Review the details and confirm or reject the employment relationship from the link. If you already have an account, sign in with the email address that received this message.",
      expiry: `The verification link expires in ${validityDays} days and can only be used once.`,
    },
    de: {
      subject: `Mitarbeiterverifizierung mit ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} hat Ihre Verifizierung als ${roleName} gestartet.`,
      action:
        "Prüfen Sie die Angaben und bestätigen oder lehnen Sie das Arbeitsverhältnis über den Link ab. Wenn Sie bereits ein Konto haben, melden Sie sich mit der E-Mail-Adresse an, die diese Nachricht erhalten hat.",
      expiry: `Der Verifizierungslink läuft in ${validityDays} Tagen ab und kann nur einmal verwendet werden.`,
    },
    fr: {
      subject: `Vérification professionnelle avec ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} a lancé votre vérification en tant que ${roleName}.`,
      action:
        "Vérifiez les informations puis confirmez ou refusez la relation professionnelle depuis le lien. Si vous avez déjà un compte, connectez-vous avec l’adresse e-mail qui a reçu ce message.",
      expiry: `Le lien de vérification expire dans ${validityDays} jours et ne peut être utilisé qu’une fois.`,
    },
    it: {
      subject: `Verifica professionale con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} ha avviato la tua verifica come ${roleName}.`,
      action:
        "Controlla i dati e conferma o rifiuta il rapporto di lavoro dal link. Se hai già un account, accedi con l’indirizzo email che ha ricevuto questo messaggio.",
      expiry: `Il link di verifica scade tra ${validityDays} giorni e può essere usato una sola volta.`,
    },
    gl: {
      subject: `Verificación laboral con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} iniciou a túa verificación como ${roleName}.`,
      action:
        "Revisa os datos e confirma ou rexeita a relación laboral desde a ligazón. Se xa tes unha conta, inicia sesión co correo que recibiu esta mensaxe.",
      expiry: `A ligazón de verificación caduca en ${validityDays} días e só pode utilizarse unha vez.`,
    },
    ca: {
      subject: `Verificació laboral amb ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} ha iniciat la teva verificació com a ${roleName}.`,
      action:
        "Revisa les dades i confirma o rebutja la vinculació laboral des de l’enllaç. Si ja tens un compte, inicia sessió amb el correu que ha rebut aquest missatge.",
      expiry: `L’enllaç de verificació caduca d’aquí a ${validityDays} dies i només es pot utilitzar una vegada.`,
    },
    eu: {
      subject: `${input.facilityName} zentroarekiko lan-egiaztapena`,
      intro: `${input.name}, ${input.facilityName} zentroak ${roleName} gisa egiaztatzeko prozesua hasi du.`,
      action:
        "Berrikusi datuak eta berretsi edo baztertu lan-lotura estekatik. Kontua baduzu, hasi saioa mezu hau jaso duen helbide elektronikoarekin.",
      expiry: `Egiaztapen-esteka ${validityDays} egun barru iraungiko da eta behin bakarrik erabil daiteke.`,
    },
    "oc-aranes": {
      subject: `Verificacion laborau damb ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} a iniciat era tua verificacion coma ${roleName}.`,
      action:
        "Revise es donades e confirme o refuse era vinculacion laborau des der enlàç. Se ja as un compde, inicia session damb eth corrèu que recebec aguest messatge.",
      expiry: `Er enlàç de verificacion caduque en ${validityDays} dies e sonque se pòt utilizar un còp.`,
    },
  });
  const memberContent = withRegionalEmailFallbacks({
    es: {
      subject: `Afiliación de socio con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} quiere vincular tu cuenta como socio.`,
      action:
        "Revisa los datos y acepta o rechaza la afiliación desde el enlace. Si ya tienes una cuenta, inicia sesión con el correo que ha recibido este mensaje.",
      expiry: `El enlace de afiliación caduca en ${validityDays} días y solo puede utilizarse una vez.`,
    },
    en: {
      subject: `Member affiliation with ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} wants to link your account as a member.`,
      action:
        "Review the details and accept or decline the affiliation from the link. If you already have an account, sign in with the email address that received this message.",
      expiry: `The affiliation link expires in ${validityDays} days and can only be used once.`,
    },
    de: {
      subject: `Mitgliedszuordnung mit ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} möchte Ihr Konto als Mitglied verknüpfen.`,
      action:
        "Prüfen Sie die Angaben und nehmen Sie die Zuordnung über den Link an oder lehnen Sie sie ab. Wenn Sie bereits ein Konto haben, melden Sie sich mit der E-Mail-Adresse an, die diese Nachricht erhalten hat.",
      expiry: `Der Zuordnungslink läuft in ${validityDays} Tagen ab und kann nur einmal verwendet werden.`,
    },
    fr: {
      subject: `Affiliation de membre avec ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} souhaite associer votre compte en tant que membre.`,
      action:
        "Vérifiez les informations puis acceptez ou refusez l’affiliation depuis le lien. Si vous avez déjà un compte, connectez-vous avec l’adresse e-mail qui a reçu ce message.",
      expiry: `Le lien d’affiliation expire dans ${validityDays} jours et ne peut être utilisé qu’une fois.`,
    },
    it: {
      subject: `Affiliazione come membro con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} vuole collegare il tuo account come ${roleName}.`,
      action:
        "Controlla i dati e accetta o rifiuta l’affiliazione dal link. Se hai già un account, accedi con l’indirizzo email che ha ricevuto questo messaggio.",
      expiry: `Il link di affiliazione scade tra ${validityDays} giorni e può essere usato una sola volta.`,
    },
    gl: {
      subject: `Afiliación de socio con ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} quere vincular a túa conta como ${roleName}.`,
      action:
        "Revisa os datos e acepta ou rexeita a afiliación desde a ligazón. Se xa tes unha conta, inicia sesión co correo que recibiu esta mensaxe.",
      expiry: `A ligazón de afiliación caduca en ${validityDays} días e só pode utilizarse unha vez.`,
    },
    ca: {
      subject: `Afiliació de soci amb ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} vol vincular el teu compte com a ${roleName}.`,
      action:
        "Revisa les dades i accepta o rebutja l’afiliació des de l’enllaç. Si ja tens un compte, inicia sessió amb el correu que ha rebut aquest missatge.",
      expiry: `L’enllaç d’afiliació caduca d’aquí a ${validityDays} dies i només es pot utilitzar una vegada.`,
    },
    eu: {
      subject: `${input.facilityName} zentroarekiko kide-afiliazioa`,
      intro: `${input.name}, ${input.facilityName} zentroak zure kontua ${roleName} gisa lotu nahi du.`,
      action:
        "Berrikusi datuak eta onartu edo baztertu afiliazioa estekatik. Kontua baduzu, hasi saioa mezu hau jaso duen helbide elektronikoarekin.",
      expiry: `Afiliazio-esteka ${validityDays} egun barru iraungiko da eta behin bakarrik erabil daiteke.`,
    },
    "oc-aranes": {
      subject: `Afiliacion coma membre damb ${input.facilityName}`,
      intro: `${input.name}, ${input.facilityName} vò vincular eth tòn compde coma ${roleName}.`,
      action:
        "Revise es donades e accèpte o refuse era afiliacion des der enlàç. Se ja as un compde, inicia session damb eth corrèu que recebec aguest messatge.",
      expiry: `Er enlàç d’afiliacion caduque en ${validityDays} dies e sonque se pòt utilizar un còp.`,
    },
  });
  const message =
    input.role === "member" ? memberContent[locale] : workerContent[locale];
  const htmlUrl = escapeInvitationHtml(invitationUrl);
  return {
    locale,
    payload: {
      email: input.email,
      locale,
      subject: message.subject,
      text: `${message.intro}\n\n${message.action}\n${message.expiry}\n\n${invitationUrl}`,
      html: `<p>${escapeInvitationHtml(message.intro)}</p><p>${escapeInvitationHtml(message.action)}</p><p>${escapeInvitationHtml(message.expiry)}</p><p><a href="${htmlUrl}">${htmlUrl}</a></p>`,
    },
  };
}

export async function queueFacilityInvitationEmail(
  input: FacilityInvitationEmailInput,
): Promise<string> {
  const message = buildFacilityInvitationMessage(input);
  return queueEncryptedDelivery({
    userId: null,
    platformScope: "commercial",
    kind: "security_notice",
    recipient: input.email,
    locale: message.locale,
    payload: message.payload,
    expiresAt: input.expiresAt,
  });
}

export async function queueEmailChangeVerification(input: {
  userId: string;
  platformScope: ManagerPlatformScope;
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
  validityHours: number;
}): Promise<string> {
  const message = buildEmailChangeVerificationMessage(
    input.name,
    input.code,
    input.locale,
    input.validityHours,
  );
  return queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "security_notice",
    recipient: input.email,
    locale: input.locale,
    payload: {
      email: input.email,
      locale: input.locale,
      ...message,
    },
    expiresAt: input.expiresAt,
  });
}

export async function queueAccountDeletionVerificationCode(input: {
  userId: string;
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
}): Promise<string> {
  const locale = canonicalizeLocale(input.locale);
  const validityMinutes = Math.max(
    1,
    Math.ceil((input.expiresAt - Date.now()) / 60_000),
  );
  const content = withRegionalEmailFallbacks(
    {
      es: {
        subject: "Código para confirmar el cierre de tu cuenta",
        greeting: `Hola, ${input.name}.`,
        instruction: `Introduce este código de un solo uso para confirmar la solicitud de cierre. Caduca en ${validityMinutes} minutos.`,
        warning:
          "Si no has solicitado cerrar la cuenta, no compartas el código y revisa la actividad de seguridad.",
      },
      en: {
        subject: "Code to confirm your account closure",
        greeting: `Hello, ${input.name}.`,
        instruction: `Enter this one-time code to confirm the closure request. It expires in ${validityMinutes} minutes.`,
        warning:
          "If you did not request an account closure, do not share the code and review your security activity.",
      },
      de: {
        subject: "Code zur Bestätigung der Kontoschließung",
        greeting: `Hallo, ${input.name}.`,
        instruction: `Geben Sie diesen Einmalcode ein, um die Schließungsanfrage zu bestätigen. Er läuft in ${validityMinutes} Minuten ab.`,
        warning:
          "Wenn Sie keine Kontoschließung angefordert haben, geben Sie den Code nicht weiter und prüfen Sie Ihre Sicherheitsaktivität.",
      },
      fr: {
        subject: "Code de confirmation de la fermeture de votre compte",
        greeting: `Bonjour, ${input.name}.`,
        instruction: `Saisissez ce code à usage unique pour confirmer la demande de fermeture. Il expire dans ${validityMinutes} minutes.`,
        warning:
          "Si vous n’avez pas demandé la fermeture du compte, ne partagez pas le code et vérifiez votre activité de sécurité.",
      },
      it: {
        subject: "Codice per confermare la chiusura del tuo account",
        greeting: `Ciao, ${input.name}.`,
        instruction: `Inserisci questo codice monouso per confermare la richiesta di chiusura. Scade tra ${validityMinutes} minuti.`,
        warning:
          "Se non hai richiesto la chiusura dell’account, non condividere il codice e controlla l’attività di sicurezza.",
      },
      gl: {
        subject: "Código para confirmar o peche da túa conta",
        greeting: `Ola, ${input.name}.`,
        instruction: `Introduce este código dun só uso para confirmar a solicitude de peche. Caduca en ${validityMinutes} minutos.`,
        warning:
          "Se non solicitaches pechar a conta, non compartas o código e revisa a actividade de seguridade.",
      },
      ca: {
        subject: "Codi per confirmar el tancament del teu compte",
        greeting: `Hola, ${input.name}.`,
        instruction: `Introdueix aquest codi d’un sol ús per confirmar la sol·licitud de tancament. Caduca d’aquí a ${validityMinutes} minuts.`,
        warning:
          "Si no has sol·licitat tancar el compte, no comparteixis el codi i revisa l’activitat de seguretat.",
      },
      eu: {
        subject: "Kontua ixtea berresteko kodea",
        greeting: `Kaixo, ${input.name}.`,
        instruction: `Sartu erabilera bakarreko kode hau ixteko eskaera berresteko. ${validityMinutes} minutu barru iraungiko da.`,
        warning:
          "Kontua ixtea eskatu ez baduzu, ez partekatu kodea eta berrikusi segurtasun-jarduera.",
      },
      "oc-aranes": {
        subject: "Còdi entà confirmar eth barrament deth tòn compde",
        greeting: `Adiu, ${input.name}.`,
        instruction: `Introdusís aguest còdi d’un solet us entà confirmar era sollicitud de barrament. Caduque en ${validityMinutes} minutes.`,
        warning:
          "Se non as demanat barrar eth compde, non compartisques eth còdi e revise era activitat de seguretat.",
      },
    },
    {
      deCH: {
        subject: "Code zur Bestätigung der Kontoschliessung",
        greeting: `Hallo, ${input.name}.`,
        instruction: `Geben Sie diesen Einmalcode ein, um die Schliessungsanfrage zu bestätigen. Er läuft in ${validityMinutes} Minuten ab.`,
        warning:
          "Wenn Sie keine Kontoschliessung angefordert haben, geben Sie den Code nicht weiter und prüfen Sie Ihre Sicherheitsaktivität.",
      },
    },
  );
  const message = content[locale];
  return queueEncryptedDelivery({
    userId: input.userId,
    platformScope: "commercial",
    kind: "security_notice",
    recipient: input.email,
    locale,
    payload: {
      email: input.email,
      locale,
      subject: message.subject,
      text: `${message.greeting}\n\n${message.instruction}\n\n${input.code}\n\n${message.warning}`,
      html: `<p>${escapeHtml(message.greeting)}</p><p>${escapeHtml(message.instruction)}</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${escapeHtml(input.code)}</p><p>${escapeHtml(message.warning)}</p>`,
    },
    expiresAt: input.expiresAt,
  });
}

export async function queueEmailChangeAttemptNotice(input: {
  userId: string;
  platformScope: ManagerPlatformScope;
  currentEmail: string;
  name: string;
  locale: SupportedLocale;
  recoveryUrl: string;
}): Promise<string> {
  const message = buildEmailChangeAttemptNoticeMessage({
    name: input.name,
    locale: input.locale,
    recoveryUrl: input.recoveryUrl,
  });
  return queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "security_notice",
    recipient: input.currentEmail,
    locale: input.locale,
    payload: {
      email: input.currentEmail,
      locale: input.locale,
      ...message,
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

export async function queueEmailChangedNotice(input: {
  userId: string;
  platformScope: ManagerPlatformScope;
  oldEmail: string;
  newEmail: string;
  name: string;
  locale: SupportedLocale;
  recoveryUrl: string;
}): Promise<string> {
  const locale = canonicalizeLocale(input.locale);
  const content = withRegionalEmailFallbacks({
    es: {
      subject: "El correo de tu cuenta ha cambiado",
      title: `Hola, ${input.name}:`,
      explanation: `El correo de acceso de tu cuenta se ha cambiado a ${input.newEmail}. Se han cerrado las demás sesiones.`,
      action:
        "Si no has realizado este cambio, recupera tu cuenta de inmediato.",
    },
    en: {
      subject: "Your account email has changed",
      title: `Hello, ${input.name}:`,
      explanation: `Your account sign-in email was changed to ${input.newEmail}. Your other sessions have been closed.`,
      action:
        "If you did not make this change, recover your account immediately.",
    },
    de: {
      subject: "Die E-Mail-Adresse Ihres Kontos wurde geändert",
      title: `Hallo, ${input.name}:`,
      explanation: `Die Anmelde-E-Mail Ihres Kontos wurde in ${input.newEmail} geändert. Ihre anderen Sitzungen wurden beendet.`,
      action:
        "Wenn Sie diese Änderung nicht vorgenommen haben, starten Sie die Kontowiederherstellung und kontaktieren Sie sofort den Support.",
    },
    fr: {
      subject: "L’adresse e-mail de votre compte a été modifiée",
      title: `Bonjour, ${input.name} :`,
      explanation: `L’adresse e-mail de connexion à votre compte a été remplacée par ${input.newEmail}. Vos autres sessions ont été fermées.`,
      action:
        "Si vous n’avez pas effectué ce changement, récupérez immédiatement votre compte.",
    },
    it: {
      subject: "L’email del tuo account è stata modificata",
      title: `Ciao, ${input.name}:`,
      explanation: `L’email di accesso del tuo account è stata modificata in ${input.newEmail}. Le altre sessioni sono state chiuse.`,
      action:
        "Se non hai effettuato questa modifica, recupera immediatamente il tuo account.",
    },
    gl: {
      subject: "O correo da túa conta cambiou",
      title: `Ola, ${input.name}:`,
      explanation: `O correo de acceso da túa conta cambiou a ${input.newEmail}. Pecháronse as demais sesións.`,
      action:
        "Se non realizaches este cambio, recupera a túa conta de inmediato.",
    },
    ca: {
      subject: "El correu del teu compte ha canviat",
      title: `Hola, ${input.name}:`,
      explanation: `El correu d’accés del teu compte s’ha canviat a ${input.newEmail}. S’han tancat les altres sessions.`,
      action: "Si no has fet aquest canvi, recupera el compte immediatament.",
    },
    eu: {
      subject: "Zure kontuaren helbide elektronikoa aldatu da",
      title: `Kaixo, ${input.name}:`,
      explanation: `Zure kontuan saioa hasteko helbide elektronikoa ${input.newEmail} helbidera aldatu da. Beste saioak itxi dira.`,
      action: "Aldaketa zuk egin ez baduzu, berreskuratu kontua berehala.",
    },
    "oc-aranes": {
      subject: "Eth corrèu electronic deth tòn compde a cambiat",
      title: `Adiu, ${input.name}:`,
      explanation: `Eth corrèu d’accès deth tòn compde s’a cambiat a ${input.newEmail}. Es autes sessions s’an barrat.`,
      action:
        "Se non as hèt aguest cambi, recupèra eth tòn compde immediatament.",
    },
  });
  const message = content[locale];
  const safeRecoveryUrl = escapeHtml(input.recoveryUrl);
  return queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "security_notice",
    recipient: input.oldEmail,
    locale,
    payload: {
      email: input.oldEmail,
      locale,
      subject: message.subject,
      text: `${message.title}\n\n${message.explanation}\n\n${message.action}: ${input.recoveryUrl}`,
      html: `<p>${escapeHtml(message.title)}</p><p>${escapeHtml(message.explanation)}</p><p><a href="${safeRecoveryUrl}"><strong>${escapeHtml(message.action)}</strong></a></p>`,
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

export async function queueAccountRecoveryCode(input: {
  userId: string;
  platformScope: ManagerPlatformScope;
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
}): Promise<string> {
  const message = buildAccountRecoveryMessage(
    input.name,
    input.code,
    input.locale,
  );
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "account_recovery",
    recipient: input.email,
    locale: input.locale,
    payload: {
      email: input.email,
      locale: input.locale,
      ...message,
    },
    expiresAt: input.expiresAt,
    supersedePending: true,
  });
  publishManagerSignal(
    "email",
    input.platformScope,
    "info",
    "ACCOUNT_RECOVERY_QUEUED",
    "An account recovery message was queued for delivery.",
  );
  return id;
}

export async function queueSupportUpdateEmail(input: {
  userId: string;
  email: string;
  locale: SupportedLocale;
  ticketPublicId: string;
  subject: string;
  message: string;
  replyTo?: string;
}): Promise<string> {
  const title = `[${input.ticketPublicId}] ${input.subject}`;
  const safeMessage = escapeHtml(input.message);
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: "commercial",
    kind: "support_update",
    recipient: input.email,
    locale: input.locale,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload: {
      email: input.email,
      locale: input.locale,
      subject: title,
      text: `${input.ticketPublicId}\n\n${input.message}`,
      html: `<p><strong>${escapeHtml(input.ticketPublicId)}</strong></p><p>${safeMessage.replace(/\n/g, "<br>")}</p>`,
      replyTo: input.replyTo,
    },
  });
  publishManagerSignal(
    "email",
    "commercial",
    "info",
    "SUPPORT_UPDATE_QUEUED",
    "A support update was queued for delivery.",
  );
  return id;
}

export async function queueSupportStaffNotificationEmail(input: {
  email: string;
  ticketPublicId: string;
  subject: string;
  message: string;
}): Promise<string> {
  const title = `[${input.ticketPublicId}] ${input.subject}`;
  const safeMessage = escapeHtml(input.message);
  const id = await queueEncryptedDelivery({
    userId: null,
    platformScope: "commercial",
    kind: "support_update",
    recipient: input.email,
    locale: "es",
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload: {
      email: input.email,
      locale: "es",
      subject: title,
      text: `${input.ticketPublicId}\n\n${input.message}`,
      html: `<p><strong>${escapeHtml(input.ticketPublicId)}</strong></p><p>${safeMessage.replace(/\n/g, "<br>")}</p>`,
    },
  });
  publishManagerSignal(
    "email",
    "commercial",
    "info",
    "SUPPORT_STAFF_NOTIFICATION_QUEUED",
    "A support queue notification was prepared for delivery.",
  );
  return id;
}

export async function queueUmfSupportReplyEmail(input: {
  email: string;
  locale: SupportedLocale;
  ticketPublicId: string;
  subject: string;
  message: string;
  replyTo?: string;
}): Promise<string> {
  const title = `[${input.ticketPublicId}] ${input.subject}`;
  const id = await queueEncryptedDelivery({
    userId: null,
    platformScope: "support",
    kind: "support_update",
    recipient: input.email,
    locale: input.locale,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload: {
      email: input.email,
      locale: input.locale,
      subject: title,
      text: `${input.ticketPublicId}\n\n${input.message}`,
      html: `<p><strong>${escapeHtml(input.ticketPublicId)}</strong></p><p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>`,
      replyTo: input.replyTo,
    },
  });
  publishManagerSignal(
    "email",
    "support",
    "info",
    "UMF_SUPPORT_REPLY_QUEUED",
    "A UMF Support reply was queued for delivery.",
  );
  return id;
}

export function renderControlledSupportMessageHtml(message: string): string {
  const linkPattern =
    /\[([^\]\r\n]{1,120})\]\((https:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi;
  let html = "";
  let cursor = 0;
  for (const match of message.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(message.slice(cursor, index));
    const label = match[1] ?? "";
    const href = match[2] ?? "";
    try {
      const parsed = new URL(href);
      if (!new Set(["https:", "mailto:"]).has(parsed.protocol)) {
        throw new Error("Unsupported hyperlink protocol");
      }
      html += `<a href="${escapeHtml(parsed.toString())}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch {
      html += escapeHtml(match[0]);
    }
    cursor = index + match[0].length;
  }
  html += escapeHtml(message.slice(cursor));
  return `<p>${html.replace(/\n/g, "<br>")}</p>`;
}

export type UmfSupportEmailContent =
  | { kind: "controlled-markdown"; value: string }
  | {
      kind: "opaque-with-action";
      value: string;
      action?: { label: string; url: string };
    };

export function renderUmfSupportEmailContent(content: UmfSupportEmailContent): {
  text: string;
  html: string;
} {
  if (content.kind === "controlled-markdown") {
    return {
      text: content.value,
      html: renderControlledSupportMessageHtml(content.value),
    };
  }
  const escapedValue = escapeHtml(content.value).replace(/\n/g, "<br>");
  if (content.action === undefined) {
    return { text: content.value, html: `<p>${escapedValue}</p>` };
  }
  const parsed = new URL(content.action.url);
  if (
    !new Set(["https:", "mailto:"]).has(parsed.protocol) ||
    content.action.label.trim() === ""
  ) {
    throw new Error("Invalid controlled UMF Support email action");
  }
  const actionUrl = parsed.toString();
  const text = `${content.value}\n\n[${content.action.label}](${actionUrl})`;
  const actionHtml = `<a href="${escapeHtml(actionUrl)}" rel="noopener noreferrer">${escapeHtml(content.action.label)}</a>`;
  return {
    text,
    html: `<p>${escapedValue}</p><p>${actionHtml}</p>`,
  };
}

export async function queueUmfSupportComposedEmail(input: {
  email: string;
  locale: SupportedLocale;
  subject: string;
  content: UmfSupportEmailContent;
  scheduledAt?: number;
  replyTo?: string;
  attachmentIds?: string[];
}): Promise<string> {
  const now = Date.now();
  const scheduledAt =
    input.scheduledAt !== undefined && input.scheduledAt > now
      ? input.scheduledAt
      : undefined;
  const expiresAt = (scheduledAt ?? now) + 7 * 24 * 60 * 60 * 1000;
  const rendered = renderUmfSupportEmailContent(input.content);
  const id = await queueEncryptedDelivery({
    userId: null,
    platformScope: "support",
    kind: "support_update",
    recipient: input.email,
    locale: input.locale,
    nextAttemptAt: scheduledAt,
    expiresAt,
    payload: {
      email: input.email,
      locale: input.locale,
      subject: input.subject,
      text: rendered.text,
      html: rendered.html,
      replyTo: input.replyTo,
      attachmentIds: input.attachmentIds,
    },
  });
  publishManagerSignal(
    "email",
    "support",
    "info",
    scheduledAt !== undefined
      ? "UMF_SUPPORT_MESSAGE_SCHEDULED"
      : "UMF_SUPPORT_MESSAGE_QUEUED",
    scheduledAt !== undefined
      ? "An UMF Support message was scheduled for delivery."
      : "An UMF Support message was queued for delivery.",
  );
  return id;
}

export async function queueAccountInactivityReviewEmail(input: {
  userId: string;
  email: string;
  name: string;
  locale: SupportedLocale;
  actionUrl: string;
  reminder?: boolean;
  reviewDeliveryId?: string;
}): Promise<string> {
  const locale = canonicalizeLocale(input.locale);
  const isReminder = Boolean(input.reminder);
  const content = withRegionalEmailFallbacks({
    es: {
      subject: isReminder
        ? "Recordatorio: ¿sigues usando tu cuenta?"
        : "¿Sigues usando tu cuenta de Umbravia Forge?",
      question: "¿Sigues usando tu cuenta?",
      explanation:
        "No hemos registrado actividad durante seis meses. Inicia sesión y confirma tu respuesta. Si no respondes en el plazo indicado, se iniciará el periodo de gracia de 30 días para el borrado; podrás cancelarlo durante ese periodo.",
      action: "Revisar mi cuenta",
    },
    en: {
      subject: isReminder
        ? "Reminder: are you still using your account?"
        : "Are you still using your Umbravia Forge account?",
      question: "Are you still using your account?",
      explanation:
        "We have not recorded activity for six months. Sign in and confirm your answer. If you do not respond by the stated deadline, the 30-day deletion grace period will begin; you can cancel it during that period.",
      action: "Review my account",
    },
    de: {
      subject: isReminder
        ? "Erinnerung: Nutzen Sie Ihr Konto noch?"
        : "Nutzen Sie Ihr Umbravia-Forge-Konto noch?",
      question: "Nutzen Sie Ihr Konto noch?",
      explanation:
        "Seit sechs Monaten wurde keine Aktivität registriert. Melden Sie sich an und bestätigen Sie Ihre Antwort. Ohne Antwort beginnt nach Ablauf der Frist die 30-tägige Löschfrist; während dieser Frist können Sie den Vorgang abbrechen.",
      action: "Konto überprüfen",
    },
    fr: {
      subject: isReminder
        ? "Rappel : utilisez-vous toujours votre compte ?"
        : "Utilisez-vous toujours votre compte Umbravia Forge ?",
      question: "Utilisez-vous toujours votre compte ?",
      explanation:
        "Nous n’avons enregistré aucune activité depuis six mois. Connectez-vous et confirmez votre réponse. Sans réponse avant la date indiquée, le délai de grâce de 30 jours avant suppression commencera ; vous pourrez l’annuler pendant cette période.",
      action: "Vérifier mon compte",
    },
    it: {
      subject: isReminder
        ? "Promemoria: usi ancora il tuo account?"
        : "Usi ancora il tuo account Umbravia Forge?",
      question: "Usi ancora il tuo account?",
      explanation:
        "Non abbiamo registrato attività da sei mesi. Accedi e conferma la tua risposta. Se non rispondi entro la scadenza indicata, inizierà il periodo di tolleranza di 30 giorni prima dell’eliminazione; potrai annullarla durante tale periodo.",
      action: "Controlla il mio account",
    },
    gl: {
      subject: isReminder
        ? "Recordatorio: segues usando a túa conta?"
        : "Segues usando a túa conta de Umbravia Forge?",
      question: "Segues usando a túa conta?",
      explanation:
        "Non rexistramos actividade durante seis meses. Inicia sesión e confirma a túa resposta. Se non respondes no prazo indicado, iniciarase o período de graza de 30 días para o borrado; poderás cancelalo durante ese período.",
      action: "Revisar a miña conta",
    },
    ca: {
      subject: isReminder
        ? "Recordatori: encara utilitzes el teu compte?"
        : "Encara utilitzes el teu compte d’Umbravia Forge?",
      question: "Encara utilitzes el teu compte?",
      explanation:
        "No hem registrat activitat durant sis mesos. Inicia sessió i confirma la resposta. Si no respons dins del termini indicat, començarà el període de gràcia de 30 dies per a l’eliminació; podràs cancel·lar-la durant aquest període.",
      action: "Revisar el meu compte",
    },
    eu: {
      subject: isReminder
        ? "Gogorarazpena: kontua erabiltzen jarraitzen duzu?"
        : "Umbravia Forge-ko kontua erabiltzen jarraitzen duzu?",
      question: "Kontua erabiltzen jarraitzen duzu?",
      explanation:
        "Ez dugu jarduerarik erregistratu sei hilabetez. Hasi saioa eta berretsi erantzuna. Adierazitako epean erantzuten ez baduzu, ezabatu aurreko 30 eguneko grazia-epea hasiko da; epe horretan bertan behera utz dezakezu.",
      action: "Berrikusi nire kontua",
    },
    "oc-aranes": {
      subject: isReminder
        ? "Rebrembe: encara utilizes eth tòn compde?"
        : "Encara utilizes eth tòn compde d’Umbravia Forge?",
      question: "Encara utilizes eth tòn compde?",
      explanation:
        "Non auem registrat activitat pendent sies mesi. Inicia session e confirme era tua responsa. Se non respones laguens deth tèrme indicat, començarà eth periòde de gràcia de 30 dies entath borrament; lo poderàs anullar pendent aguest periòde.",
      action: "Revisar eth mèn compde",
    },
  });
  const message = content[locale];
  const safeUrl = escapeHtml(input.actionUrl);
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: "commercial",
    kind: "security_notice",
    recipient: input.email,
    locale,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload: {
      email: input.email,
      locale,
      subject: message.subject,
      text: `${input.name}\n\n${message.question}\n\n${message.explanation}\n\n${input.actionUrl}`,
      html: `<!doctype html><html lang="${escapeHtml(locale)}"><body style="margin:0;padding:0;background:#f4f5f6;color:#0f1720;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f6;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate"><tr><td style="padding:32px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(input.name)}</p><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${escapeHtml(message.question)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155">${escapeHtml(message.explanation)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#f07a3a" style="border-radius:10px"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(message.action)}</a></td></tr></table></td></tr></table></td></tr></table></body></html>`,
      purpose: "account_inactivity_review",
      reminder: isReminder,
      reviewDeliveryId: input.reviewDeliveryId,
    },
  });
  publishManagerSignal(
    "email",
    "commercial",
    "info",
    isReminder
      ? "ACCOUNT_INACTIVITY_REVIEW_REMINDER_QUEUED"
      : "ACCOUNT_INACTIVITY_REVIEW_QUEUED",
    "An inactivity review message was queued for delivery.",
  );
  return id;
}

export function buildAccountDeletionPreparationMessage(input: {
  name: string;
  locale: SupportedLocale;
  graceEndsAt: number;
  revokedOtherSessions: boolean;
  removedTemporaryChallenges: boolean;
  accountUrl: string;
  loginUrl: string;
  recoveryUrl: string;
  feedbackUrl: string;
}): VerificationMessage {
  const locale = canonicalizeLocale(input.locale);
  const date = new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(input.graceEndsAt);
  const content = withRegionalEmailFallbacks(
    {
      es: {
        subject: "El cierre de tu cuenta se ha programado",
        title: "Lamentamos que te marches",
        intro: `El cierre definitivo está previsto para el ${date} (UTC).`,
        securityHeading: "Información técnica y de seguridad",
        kept: "Tu contraseña, la verificación en dos pasos, las passkeys y esta sesión siguen activas para que puedas entrar y cancelar el cierre.",
        cancel:
          "Si cambias de opinión, inicia sesión y cancela el cierre antes de que termine el periodo de gracia.",
        cancelAction: "Revisar o cancelar el cierre",
        signInAction: "Iniciar sesión",
        recoveryPrompt: "¿No puedes acceder a tu cuenta?",
        recoveryAction: "Recuperar mi cuenta",
        feedback:
          "Si quieres, cuéntanos qué podríamos mejorar. La encuesta es opcional y no afecta al cierre de tu cuenta.",
        feedbackAction: "Contarnos cómo mejorar",
        closing: "Esperamos volver a verte pronto.",
      },
      en: {
        subject: "Your account closure has been scheduled",
        title: "We are sorry to see you go",
        intro: `Final closure is scheduled for ${date} (UTC).`,
        securityHeading: "Technical and security information",
        kept: "Your password, two-step verification, passkeys and this session remain active so you can sign in and cancel the closure.",
        cancel:
          "If you change your mind, sign in and cancel the closure before the grace period ends.",
        cancelAction: "Review or cancel closure",
        signInAction: "Sign in",
        recoveryPrompt: "Cannot access your account?",
        recoveryAction: "Recover my account",
        feedback:
          "If you would like, tell us what we could improve. The survey is optional and does not affect your account closure.",
        feedbackAction: "Tell us how to improve",
        closing: "We hope to see you again soon.",
      },
      de: {
        subject: "Die Schliessung Ihres Kontos wurde geplant",
        title: "Wir bedauern, dass Sie gehen",
        intro: `Die endgültige Schliessung ist für den ${date} (UTC) vorgesehen.`,
        securityHeading: "Technische und sicherheitsrelevante Informationen",
        kept: "Passwort, Zwei-Faktor-Authentifizierung, Passkeys und diese Sitzung bleiben aktiv, damit Sie die Schliessung abbrechen können.",
        cancel:
          "Wenn Sie Ihre Meinung ändern, melden Sie sich an und brechen Sie die Schliessung vor Ablauf der Nachfrist ab.",
        cancelAction: "Schliessung prüfen oder abbrechen",
        signInAction: "Anmelden",
        recoveryPrompt: "Sie können nicht auf Ihr Konto zugreifen?",
        recoveryAction: "Konto wiederherstellen",
        feedback:
          "Wenn Sie möchten, teilen Sie uns mit, was wir verbessern können. Die Umfrage ist freiwillig und hat keinen Einfluss auf die Kontoschliessung.",
        feedbackAction: "Verbesserungsvorschläge senden",
        closing: "Wir hoffen, Sie bald wiederzusehen.",
      },
      fr: {
        subject: "La fermeture de votre compte a été planifiée",
        title: "Nous sommes désolés de vous voir partir",
        intro: `La fermeture définitive est prévue le ${date} (UTC).`,
        securityHeading: "Informations techniques et de sécurité",
        kept: "Votre mot de passe, la vérification en deux étapes, les passkeys et cette session restent actifs afin que vous puissiez vous connecter et annuler la fermeture.",
        cancel:
          "Si vous changez d’avis, connectez-vous et annulez la fermeture avant la fin du délai de grâce.",
        cancelAction: "Vérifier ou annuler la fermeture",
        signInAction: "Se connecter",
        recoveryPrompt: "Vous ne pouvez pas accéder à votre compte ?",
        recoveryAction: "Récupérer mon compte",
        feedback:
          "Si vous le souhaitez, dites-nous ce que nous pourrions améliorer. L’enquête est facultative et n’a aucune incidence sur la fermeture de votre compte.",
        feedbackAction: "Nous dire comment nous améliorer",
        closing: "Nous espérons vous revoir bientôt.",
      },
      it: {
        subject: "La chiusura del tuo account è stata programmata",
        title: "Ci dispiace vederti andare via",
        intro: `La chiusura definitiva è prevista per il ${date} (UTC).`,
        securityHeading: "Informazioni tecniche e di sicurezza",
        kept: "La password, la verifica in due passaggi, le passkey e questa sessione restano attive affinché tu possa accedere e annullare la chiusura.",
        cancel:
          "Se cambi idea, accedi e annulla la chiusura prima della fine del periodo di tolleranza.",
        cancelAction: "Controlla o annulla la chiusura",
        signInAction: "Accedi",
        recoveryPrompt: "Non riesci ad accedere al tuo account?",
        recoveryAction: "Recupera il mio account",
        feedback:
          "Se vuoi, raccontaci cosa potremmo migliorare. Il sondaggio è facoltativo e non influisce sulla chiusura del tuo account.",
        feedbackAction: "Dicci come migliorare",
        closing: "Speriamo di rivederti presto.",
      },
      gl: {
        subject: "Programouse o peche da túa conta",
        title: "Lamentamos que marches",
        intro: `O peche definitivo está previsto para o ${date} (UTC).`,
        securityHeading: "Información técnica e de seguridade",
        kept: "O teu contrasinal, a verificación en dous pasos, as passkeys e esta sesión seguen activos para que poidas entrar e cancelar o peche.",
        cancel:
          "Se cambias de opinión, inicia sesión e cancela o peche antes de que remate o período de graza.",
        cancelAction: "Revisar ou cancelar o peche",
        signInAction: "Iniciar sesión",
        recoveryPrompt: "Non podes acceder á túa conta?",
        recoveryAction: "Recuperar a miña conta",
        feedback:
          "Se queres, cóntanos que poderiamos mellorar. A enquisa é opcional e non afecta ao peche da túa conta.",
        feedbackAction: "Contarnos como mellorar",
        closing: "Agardamos volver verte axiña.",
      },
      ca: {
        subject: "S’ha programat el tancament del teu compte",
        title: "Lamentem que te’n vagis",
        intro: `El tancament definitiu està previst per al ${date} (UTC).`,
        securityHeading: "Informació tècnica i de seguretat",
        kept: "La contrasenya, la verificació en dos passos, les passkeys i aquesta sessió continuen actives perquè puguis entrar i cancel·lar el tancament.",
        cancel:
          "Si canvies d’opinió, inicia sessió i cancel·la el tancament abans que acabi el període de gràcia.",
        cancelAction: "Revisar o cancel·lar el tancament",
        signInAction: "Iniciar sessió",
        recoveryPrompt: "No pots accedir al teu compte?",
        recoveryAction: "Recuperar el meu compte",
        feedback:
          "Si vols, explica’ns què podríem millorar. L’enquesta és opcional i no afecta el tancament del teu compte.",
        feedbackAction: "Explicar-nos com millorar",
        closing: "Esperem tornar-te a veure aviat.",
      },
      eu: {
        subject: "Zure kontuaren itxiera programatu da",
        title: "Pena ematen digu joatea",
        intro: `Behin betiko itxiera ${date} datarako aurreikusita dago (UTC).`,
        securityHeading: "Informazio teknikoa eta segurtasunekoa",
        kept: "Pasahitzak, bi urratseko egiaztapenak, passkey-ek eta saio honek aktibo jarraituko dute, saioa hasi eta itxiera bertan behera utz dezazun.",
        cancel:
          "Iritziz aldatzen baduzu, hasi saioa eta utzi bertan behera itxiera grazia-epea amaitu aurretik.",
        cancelAction: "Berrikusi edo utzi bertan behera itxiera",
        signInAction: "Hasi saioa",
        recoveryPrompt: "Ezin duzu kontura sartu?",
        recoveryAction: "Berreskuratu nire kontua",
        feedback:
          "Nahi baduzu, esan zer hobetu genezakeen. Inkesta hautazkoa da eta ez dio eragiten kontuaren itxierari.",
        feedbackAction: "Esan nola hobetu",
        closing: "Laster berriro ikustea espero dugu.",
      },
      "oc-aranes": {
        subject: "S’a programat eth barrament deth tòn compde",
        title: "Lamentam que te’n vages",
        intro: `Eth barrament definitiu ei previst entath ${date} (UTC).`,
        securityHeading: "Informacion tecnica e de seguretat",
        kept: "Era contrasenha, era verificacion en dus passi, es passkeys e aguesta session demoren actives entà que pogues entrar e anullar eth barrament.",
        cancel:
          "Se càmbies de vejaire, inicia session e anulla eth barrament abans qu’acabe eth periòde de gràcia.",
        cancelAction: "Revisar o anullar eth barrament",
        signInAction: "Iniciar session",
        recoveryPrompt: "Non pòs accedir ath tòn compde?",
        recoveryAction: "Recuperar eth mèn compde",
        feedback:
          "Se vòs, explica-mos qué poderíem melhorar. Era enquèsta ei opcionau e non afècte eth barrament deth tòn compde.",
        feedbackAction: "Explicar-mos com melhorar",
        closing: "Demoram tornar-te a veir lèu.",
      },
    },
    {
      deCH: {
        subject: "Die Schliessung Ihres Kontos wurde geplant",
        title: "Wir bedauern, dass Sie gehen",
        intro: `Die endgültige Schliessung ist für den ${date} (UTC) vorgesehen.`,
        securityHeading: "Technische und sicherheitsrelevante Informationen",
        kept: "Passwort, Zwei-Faktor-Authentifizierung, Passkeys und diese Sitzung bleiben aktiv, damit Sie die Schliessung abbrechen können.",
        cancel:
          "Wenn Sie Ihre Meinung ändern, melden Sie sich an und brechen Sie die Schliessung vor Ablauf der Nachfrist ab.",
        cancelAction: "Schliessung prüfen oder abbrechen",
        signInAction: "Anmelden",
        recoveryPrompt: "Sie können nicht auf Ihr Konto zugreifen?",
        recoveryAction: "Konto wiederherstellen",
        feedback:
          "Wenn Sie möchten, teilen Sie uns mit, was wir verbessern können. Die Umfrage ist freiwillig und hat keinen Einfluss auf die Kontoschliessung.",
        feedbackAction: "Verbesserungsvorschläge senden",
        closing: "Wir hoffen, Sie bald wiederzusehen.",
      },
    },
  );
  const message = content[locale];
  const technicalChanges = withRegionalEmailFallbacks(
    {
      es: {
        sessions: "Se han cerrado las demás sesiones activas.",
        challenges:
          "Se han invalidado los códigos y solicitudes temporales de verificación o recuperación pendientes.",
      },
      en: {
        sessions: "Your other active sessions have been closed.",
        challenges:
          "Pending temporary verification and recovery codes or requests have been invalidated.",
      },
      de: {
        sessions: "Ihre anderen aktiven Sitzungen wurden beendet.",
        challenges:
          "Ausstehende temporäre Verifizierungs- und Wiederherstellungscodes oder -anfragen wurden ungültig gemacht.",
      },
      fr: {
        sessions: "Vos autres sessions actives ont été fermées.",
        challenges:
          "Les codes et demandes temporaires de vérification ou de récupération en attente ont été invalidés.",
      },
      it: {
        sessions: "Le altre sessioni attive sono state chiuse.",
        challenges:
          "I codici e le richieste temporanee di verifica o recupero in sospeso sono stati invalidati.",
      },
      gl: {
        sessions: "Pecháronse as demais sesións activas.",
        challenges:
          "Invalidáronse os códigos e as solicitudes temporais de verificación ou recuperación pendentes.",
      },
      ca: {
        sessions: "S’han tancat les altres sessions actives.",
        challenges:
          "S’han invalidat els codis i les sol·licituds temporals de verificació o recuperació pendents.",
      },
      eu: {
        sessions: "Beste saio aktiboak itxi dira.",
        challenges:
          "Zain zeuden aldi baterako egiaztapen- edo berreskuratze-kodeak eta eskaerak baliogabetu dira.",
      },
      "oc-aranes": {
        sessions: "S’an barrat es autes sessions actives.",
        challenges:
          "S’an invalidat es còdis e es sollicituds temporaus de verificacion o recuperacion pendentes.",
      },
    },
    {
      deCH: {
        sessions: "Ihre anderen aktiven Sitzungen wurden beendet.",
        challenges:
          "Ausstehende temporäre Verifizierungs- und Wiederherstellungscodes oder -anfragen wurden ungültig gemacht.",
      },
    },
  )[locale];
  const changes = [
    input.revokedOtherSessions ? technicalChanges.sessions : "",
    input.removedTemporaryChallenges ? technicalChanges.challenges : "",
  ].filter(Boolean);
  const changesText = changes.join("\n");
  const changesHtml = changes
    .map((change) => `<li style="margin:0 0 8px">${escapeHtml(change)}</li>`)
    .join("");
  const safeAccountUrl = escapeHtml(input.accountUrl);
  const safeLoginUrl = escapeHtml(input.loginUrl);
  const safeRecoveryUrl = escapeHtml(input.recoveryUrl);
  const safeFeedbackUrl = escapeHtml(input.feedbackUrl);
  return {
    subject: message.subject,
    text: `${input.name}\n\n${message.title}\n\n${message.intro}\n\n${message.securityHeading}\n${changesText ? `${changesText}\n` : ""}${message.kept}\n\n${message.cancel}\n${input.accountUrl}\n\n${message.signInAction}: ${input.loginUrl}\n${message.recoveryPrompt} ${message.recoveryAction}: ${input.recoveryUrl}\n\n${message.feedback}\n${input.feedbackUrl}\n\n${message.closing}`,
    html: `<!doctype html><html lang="${escapeHtml(locale)}"><body style="margin:0;padding:0;background:#f4f5f6;color:#0f1720;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td style="padding:32px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(input.name)}</p><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${escapeHtml(message.title)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(message.intro)}</p><h2 style="margin:0 0 12px;font-size:18px;line-height:1.4">${escapeHtml(message.securityHeading)}</h2>${changesHtml ? `<ul style="margin:0 0 16px;padding-left:22px;line-height:1.5">${changesHtml}</ul>` : ""}<p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(message.kept)}</p><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#475569">${escapeHtml(message.cancel)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td bgcolor="#f07a3a" style="border-radius:10px"><a href="${safeAccountUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(message.cancelAction)}</a></td></tr></table><p style="margin:18px 0 8px;font-size:15px;line-height:1.6"><a href="${safeLoginUrl}" style="color:#334155;font-weight:700">${escapeHtml(message.signInAction)}</a></p><p style="margin:0;font-size:15px;line-height:1.6;color:#475569">${escapeHtml(message.recoveryPrompt)} <a href="${safeRecoveryUrl}" style="color:#334155;font-weight:700">${escapeHtml(message.recoveryAction)}</a></p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;border-top:1px solid #e5e7eb"><tr><td style="padding-top:24px"><p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569">${escapeHtml(message.feedback)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td style="border:1px solid #334155;border-radius:10px"><a href="${safeFeedbackUrl}" style="display:inline-block;padding:12px 18px;color:#334155;text-decoration:none;font-weight:700">${escapeHtml(message.feedbackAction)}</a></td></tr></table><p style="margin:24px 0 0;font-size:16px;line-height:1.6">${escapeHtml(message.closing)}</p></td></tr></table></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function queueAccountDeletionPreparationEmail(input: {
  userId: string;
  email: string;
  name: string;
  locale: SupportedLocale;
  graceEndsAt: number;
  revokedOtherSessions: boolean;
  removedTemporaryChallenges: boolean;
  accountUrl: string;
  loginUrl: string;
  recoveryUrl: string;
  feedbackUrl: string;
}): Promise<string> {
  const message = buildAccountDeletionPreparationMessage(input);
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: "commercial",
    kind: "security_notice",
    recipient: input.email,
    locale: input.locale,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload: {
      email: input.email,
      locale: input.locale,
      subject: message.subject,
      text: message.text,
      html: message.html,
      purpose: "account_deletion_preparation",
    },
  });
  publishManagerSignal(
    "email",
    "commercial",
    "info",
    "ACCOUNT_DELETION_PREPARATION_QUEUED",
    "An account closure preparation notice was queued for delivery.",
  );
  return id;
}

function retryDelay(attempt: number): number {
  return Math.min(30 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export async function deliverQueuedEmail(deliveryId: string): Promise<boolean> {
  const row = await db
    .selectFrom("emailDeliveries")
    .selectAll()
    .where("id", "=", deliveryId)
    .executeTakeFirst();
  if (!row || !["queued", "retry"].includes(row.status)) return false;
  const now = Date.now();
  if (row.expiresAt <= now) {
    await db
      .updateTable("emailDeliveries")
      .set({
        status: "failed",
        recipient: "",
        payloadEncrypted: "",
        lastError: "expired_before_delivery",
        updatedAt: now,
      })
      .where("id", "=", deliveryId)
      .execute();
    publishManagerSignal(
      "email",
      row.platformScope,
      "warning",
      "EMAIL_DELIVERY_EXPIRED",
      "An email queue item expired before delivery and its payload was purged.",
    );
    return false;
  }
  const claimed = await db
    .updateTable("emailDeliveries")
    .set({ status: "processing", updatedAt: now })
    .where("id", "=", deliveryId)
    .where("status", "in", ["queued", "retry"])
    .executeTakeFirst();
  if (Number(claimed.numUpdatedRows) !== 1) return false;

  try {
    const payload = decryptPayload(
      row.id,
      row.kind as EmailDeliveryKind,
      row.payloadEncrypted,
    );
    const attachments =
      row.platformScope === "support" && payload.attachmentIds?.length
        ? await readUmfSupportMailDeliveryAttachments(payload.attachmentIds)
        : undefined;
    const delivery =
      row.kind === "email_verification"
        ? await sendEmailVerificationCode({
            email: payload.email,
            name: payload.name ?? "",
            code: payload.code ?? "",
            locale: payload.locale,
          })
        : await sendTransactionalEmail({
            email: payload.email,
            kind: row.kind,
            subject: payload.subject ?? "Umbravia Forge",
            text: payload.text ?? "",
            html: payload.html ?? "",
            replyTo: payload.replyTo,
            attachments,
          });
    if (!delivery.delivered) throw new EmailDeliveryUnavailableError();
    await db
      .updateTable("emailDeliveries")
      .set({
        status: "sent",
        attempts: row.attempts + 1,
        recipient: "",
        messageId: delivery.messageId ?? null,
        lastError: null,
        payloadEncrypted: "",
        sentAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where("id", "=", row.id)
      .where("status", "=", "processing")
      .execute();
    if (payload.purpose === "account_inactivity_review") {
      try {
        await recordSecurityEvent(
          "account_inactivity_review_delivered",
          row.userId,
          {
            deliveryId: row.id,
            reminder: Boolean(payload.reminder),
            reviewDeliveryId: payload.reviewDeliveryId ?? row.id,
          },
        );
      } catch {
        publishManagerSignal(
          "security",
          row.platformScope,
          "warning",
          "ACCOUNT_INACTIVITY_REVIEW_AUDIT_FAILED",
          "The inactivity review email was sent but its audit event could not be recorded.",
        );
      }
    }
    if (row.kind === "email_verification") {
      try {
        await recordSecurityEvent("verification_email_sent", row.userId, {
          deliveryId: row.id,
        });
      } catch {
        publishManagerSignal(
          "security",
          row.platformScope,
          "warning",
          "EMAIL_DELIVERY_AUDIT_FAILED",
          "The verification email was sent but its audit event could not be recorded.",
        );
      }
    }
    return true;
  } catch (error) {
    const keyUnavailable =
      error instanceof EmailQueueEncryptionKeyUnavailableError;
    const attempts = keyUnavailable ? row.attempts : row.attempts + 1;
    const nextAttemptAt = Date.now() + retryDelay(attempts);
    const payloadRejected = error instanceof EmailQueuePayloadError;
    const permanentlyRejected =
      error instanceof EmailDeliveryUnavailableError && !error.retryable;
    const terminal =
      payloadRejected ||
      permanentlyRejected ||
      (!keyUnavailable &&
        (attempts >= row.maxAttempts || nextAttemptAt >= row.expiresAt));
    await db
      .updateTable("emailDeliveries")
      .set({
        status: terminal ? "failed" : "retry",
        attempts,
        nextAttemptAt,
        recipient: terminal && !keyUnavailable ? "" : row.recipient,
        payloadEncrypted:
          terminal && !keyUnavailable ? "" : row.payloadEncrypted,
        lastError: keyUnavailable
          ? "encryption_key_unavailable"
          : payloadRejected
            ? "payload_authentication_failed"
            : error instanceof EmailDeliveryUnavailableError
              ? error.retryable
                ? "smtp_unavailable"
                : "smtp_permanently_rejected"
              : "delivery_processing_failed",
        updatedAt: Date.now(),
      })
      .where("id", "=", row.id)
      .where("status", "=", "processing")
      .execute();
    if (payloadRejected) {
      try {
        await recordSecurityEvent(
          "email_delivery_payload_rejected",
          row.userId,
          {
            deliveryId: row.id,
            kind: row.kind,
          },
        );
      } catch {
        publishManagerSignal(
          "security",
          row.platformScope,
          "warning",
          "EMAIL_DELIVERY_AUDIT_FAILED",
          "A rejected payload could not be written to the security audit log.",
        );
      }
    }
    publishManagerSignal(
      payloadRejected || keyUnavailable ? "security" : "email",
      row.platformScope,
      terminal ? "warning" : "info",
      keyUnavailable
        ? "EMAIL_DELIVERY_KEY_UNAVAILABLE"
        : payloadRejected
          ? "EMAIL_DELIVERY_PAYLOAD_REJECTED"
          : terminal
            ? "EMAIL_DELIVERY_FAILED"
            : "EMAIL_DELIVERY_RETRY",
      keyUnavailable
        ? "An encrypted email payload is waiting for its original queue key."
        : payloadRejected
          ? "An encrypted email payload failed authentication and was purged."
          : terminal
            ? "A verification message exhausted its delivery attempts."
            : "A verification message will be retried.",
    );
    return false;
  }
}

export async function processPendingEmailDeliveries(
  limit = 20,
): Promise<{ processed: number; delivered: number }> {
  const rows = await db
    .selectFrom("emailDeliveries")
    .select(["id", "platformScope"])
    .where("status", "in", ["queued", "retry"])
    .where("nextAttemptAt", "<=", Date.now())
    .orderBy("nextAttemptAt", "asc")
    .limit(Math.min(Math.max(limit, 1), 100))
    .execute();
  let delivered = 0;
  for (const row of rows) {
    try {
      if (await deliverQueuedEmail(row.id)) delivered += 1;
    } catch {
      publishManagerSignal(
        "email",
        row.platformScope,
        "warning",
        "EMAIL_DELIVERY_WORKER_ITEM_FAILED",
        "One email queue item failed unexpectedly; processing continued.",
      );
    }
  }
  return { processed: rows.length, delivered };
}

export async function maintainEmailDeliveryQueue(): Promise<{
  count: number;
  summary: string;
}> {
  const now = Date.now();
  const recovered = await db
    .updateTable("emailDeliveries")
    .set({
      status: "retry",
      nextAttemptAt: now,
      lastError: "recovered_stale_processing_claim",
      updatedAt: now,
    })
    .where("status", "=", "processing")
    .where("updatedAt", "<", now - 5 * 60 * 1000)
    .executeTakeFirst();
  const result = await processPendingEmailDeliveries();
  const purged = await db
    .deleteFrom("emailDeliveries")
    .where("status", "in", ["sent", "failed", "superseded"])
    .where("updatedAt", "<", now - 30 * 24 * 60 * 60 * 1000)
    .executeTakeFirst();
  const count =
    Number(recovered.numUpdatedRows) +
    result.processed +
    Number(purged.numDeletedRows);
  return {
    count,
    summary: `${result.delivered}/${result.processed} email(s) delivered; ${Number(recovered.numUpdatedRows)} stale claim(s) recovered; ${Number(purged.numDeletedRows)} old record(s) purged.`,
  };
}

export function resetEmailTransportForTests(): void {
  transporter = null;
  transporterFingerprint = "";
}

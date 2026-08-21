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

type SupportedLocale = "es" | "en" | "de" | "de-CH";
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
  path: string;
  cid: string;
  contentDisposition: "inline";
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
  const messages: Record<
    SupportedLocale,
    { subject: string; greeting: string; instruction: string; expiry: string }
  > = {
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
    "de-CH": {
      subject: "E-Mail für Umbravia Forge bestätigen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um Ihr Umbravia-Forge-Konto zu bestätigen:",
      expiry:
        "Der Code läuft in 15 Minuten ab. Wenn Sie dieses Konto nicht erstellt haben, können Sie diese Nachricht ignorieren.",
    },
  };
  const message = messages[locale] ?? messages.es;
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.instruction}\n\n${code}\n\n${message.expiry}`,
    html: brandedVerificationHtml({
      locale,
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
  const messages: Record<
    SupportedLocale,
    { subject: string; greeting: string; instruction: string; expiry: string }
  > = {
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
    "de-CH": {
      subject: "Neue E-Mail-Adresse für Umbravia Forge bestätigen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um die neue E-Mail-Adresse Ihres Kontos zu bestätigen:",
      expiry: `Der Code läuft in ${validityHours} Stunden ab. Wenn Sie diese Änderung nicht angefordert haben, geben Sie ihn nicht weiter und überprüfen Sie die Kontosicherheit.`,
    },
  };
  const message = messages[locale] ?? messages.es;
  return {
    subject: message.subject,
    text: `${message.greeting}\n\n${message.instruction}\n\n${code}\n\n${message.expiry}`,
    html: brandedVerificationHtml({
      locale,
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
  const content: Record<
    SupportedLocale,
    { subject: string; greeting: string; notice: string; action: string }
  > = {
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
    "de-CH": {
      subject: "Versuch, die E-Mail-Adresse Ihres Kontos zu ändern",
      greeting: `Hallo, ${input.name}:`,
      notice: "Es wurde versucht, die E-Mail-Adresse Ihres Kontos zu ändern.",
      action: "Wenn Sie das nicht waren, stellen Sie Ihr Konto wieder her",
    },
  };
  const message = content[input.locale] ?? content.es;
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
  const messages: Record<
    SupportedLocale,
    { subject: string; greeting: string; instruction: string; expiry: string }
  > = {
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
    "de-CH": {
      subject: "Umbravia-Forge-Konto wiederherstellen",
      greeting: `Hallo, ${name}:`,
      instruction:
        "Verwenden Sie diesen Code, um ein neues Passwort für Ihr Umbravia-Forge-Konto festzulegen:",
      expiry:
        "Der Code läuft in 15 Minuten ab und kann nur einmal verwendet werden. Wenn Sie die Wiederherstellung nicht angefordert haben, ignorieren Sie diese Nachricht und überprüfen Sie die Sicherheit Ihres Kontos.",
    },
  };
  const message = messages[locale] ?? messages.es;
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
  supersedePending?: boolean;
}): Promise<string> {
  const now = Date.now();
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
        locale: input.locale,
        payloadEncrypted: encryptPayload(id, input.payload),
        status: "queued",
        attempts: 0,
        maxAttempts: MAX_EMAIL_DELIVERY_ATTEMPTS,
        nextAttemptAt: now,
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
    !["es", "en", "de", "de-CH"].includes(payload.locale ?? "")
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
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
}): Promise<string> {
  const id = await queueEncryptedDelivery({
    userId: input.userId,
    platformScope: "commercial",
    kind: "email_verification",
    recipient: input.email,
    locale: input.locale,
    payload: input,
    expiresAt: input.expiresAt,
    supersedePending: true,
  });
  publishManagerSignal(
    "email",
    "commercial",
    "info",
    "EMAIL_VERIFICATION_QUEUED",
    "A verification message was queued for delivery.",
  );
  return id;
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
  const content: Record<
    SupportedLocale,
    { subject: string; title: string; explanation: string; action: string }
  > = {
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
    "de-CH": {
      subject: "Die E-Mail-Adresse Ihres Kontos wurde geändert",
      title: `Hallo, ${input.name}:`,
      explanation: `Die Anmelde-E-Mail Ihres Kontos wurde in ${input.newEmail} geändert. Ihre anderen Sitzungen wurden beendet.`,
      action:
        "Wenn Sie diese Änderung nicht vorgenommen haben, starten Sie die Kontowiederherstellung und kontaktieren Sie sofort den Support.",
    },
  };
  const message = content[input.locale] ?? content.es;
  const safeRecoveryUrl = escapeHtml(input.recoveryUrl);
  return queueEncryptedDelivery({
    userId: input.userId,
    platformScope: input.platformScope,
    kind: "security_notice",
    recipient: input.oldEmail,
    locale: input.locale,
    payload: {
      email: input.oldEmail,
      locale: input.locale,
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

export async function queueUmfSupportAccessCodeEmail(input: {
  email: string;
  name: string;
  code: string;
  locale: SupportedLocale;
  expiresAt: number;
}): Promise<string> {
  const content: Record<
    SupportedLocale,
    { subject: string; intro: string; expiry: string }
  > = {
    es: {
      subject: "Acceso aprobado a UMF Support",
      intro:
        "Tu solicitud ha sido aprobada. Usa este código de un solo uso para crear tu cuenta de UMF Support:",
      expiry:
        "El código caduca en 24 horas y queda invalidado después del primer uso.",
    },
    en: {
      subject: "UMF Support access approved",
      intro:
        "Your request was approved. Use this one-time code to create your UMF Support account:",
      expiry:
        "The code expires in 24 hours and is invalid after its first use.",
    },
    de: {
      subject: "Zugang zu UMF Support genehmigt",
      intro:
        "Ihr Antrag wurde genehmigt. Verwenden Sie diesen Einmalcode, um Ihr UMF-Support-Konto zu erstellen:",
      expiry:
        "Der Code läuft nach 24 Stunden ab und ist nach der ersten Verwendung ungültig.",
    },
    "de-CH": {
      subject: "Zugang zu UMF Support genehmigt",
      intro:
        "Ihr Antrag wurde genehmigt. Verwenden Sie diesen Einmalcode, um Ihr UMF-Support-Konto zu erstellen:",
      expiry:
        "Der Code läuft nach 24 Stunden ab und ist nach der ersten Verwendung ungültig.",
    },
  };
  const message = content[input.locale] ?? content.es;
  const id = await queueEncryptedDelivery({
    userId: null,
    platformScope: "support",
    kind: "support_update",
    recipient: input.email,
    locale: input.locale,
    expiresAt: input.expiresAt,
    payload: {
      email: input.email,
      locale: input.locale,
      subject: message.subject,
      text: `${input.name}\n\n${message.intro}\n\n${input.code}\n\n${message.expiry}`,
      html: `<p>${escapeHtml(input.name)}</p><p>${escapeHtml(message.intro)}</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${escapeHtml(input.code)}</p><p>${escapeHtml(message.expiry)}</p>`,
    },
  });
  publishManagerSignal(
    "email",
    "support",
    "info",
    "UMF_SUPPORT_ACCESS_QUEUED",
    "An approved UMF Support access code was queued for delivery.",
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

export async function queueAccountInactivityReviewEmail(input: {
  userId: string;
  email: string;
  name: string;
  locale: SupportedLocale;
  actionUrl: string;
  reminder?: boolean;
  reviewDeliveryId?: string;
}): Promise<string> {
  const isReminder = Boolean(input.reminder);
  const content: Record<
    SupportedLocale,
    { subject: string; question: string; explanation: string; action: string }
  > = {
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
    "de-CH": {
      subject: isReminder
        ? "Erinnerung: Nutzen Sie Ihr Konto noch?"
        : "Nutzen Sie Ihr Umbravia-Forge-Konto noch?",
      question: "Nutzen Sie Ihr Konto noch?",
      explanation:
        "Seit sechs Monaten wurde keine Aktivität registriert. Melden Sie sich an und bestätigen Sie Ihre Antwort. Ohne Antwort beginnt nach Ablauf der Frist die 30-tägige Löschfrist; während dieser Frist können Sie den Vorgang abbrechen.",
      action: "Konto überprüfen",
    },
  };
  const message = content[input.locale] ?? content.es;
  const safeUrl = escapeHtml(input.actionUrl);
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
      text: `${input.name}\n\n${message.question}\n\n${message.explanation}\n\n${input.actionUrl}`,
      html: `<!doctype html><html lang="${escapeHtml(input.locale)}"><body style="margin:0;padding:0;background:#f4f5f6;color:#0f1720;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f6;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate"><tr><td style="padding:32px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(input.name)}</p><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${escapeHtml(message.question)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155">${escapeHtml(message.explanation)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#f07a3a" style="border-radius:10px"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(message.action)}</a></td></tr></table></td></tr></table></td></tr></table></body></html>`,
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
  const date = new Intl.DateTimeFormat(input.locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(input.graceEndsAt);
  const content: Record<
    SupportedLocale,
    {
      subject: string;
      title: string;
      intro: string;
      securityHeading: string;
      kept: string;
      cancel: string;
      cancelAction: string;
      signInAction: string;
      recoveryPrompt: string;
      recoveryAction: string;
      feedback: string;
      feedbackAction: string;
      closing: string;
    }
  > = {
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
    "de-CH": {
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
  };
  const message = content[input.locale] ?? content.es;
  const changes = [
    input.revokedOtherSessions
      ? input.locale === "es"
        ? "Se han cerrado las demás sesiones activas."
        : input.locale === "en"
          ? "Your other active sessions have been closed."
          : "Ihre anderen aktiven Sitzungen wurden beendet."
      : "",
    input.removedTemporaryChallenges
      ? input.locale === "es"
        ? "Se han invalidado los códigos y solicitudes temporales de verificación o recuperación pendientes."
        : input.locale === "en"
          ? "Pending temporary verification and recovery codes or requests have been invalidated."
          : "Ausstehende temporäre Verifizierungs- und Wiederherstellungscodes oder -anfragen wurden ungültig gemacht."
      : "",
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
    html: `<!doctype html><html lang="${escapeHtml(input.locale)}"><body style="margin:0;padding:0;background:#f4f5f6;color:#0f1720;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt"><tr><td style="padding:32px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(input.name)}</p><h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${escapeHtml(message.title)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(message.intro)}</p><h2 style="margin:0 0 12px;font-size:18px;line-height:1.4">${escapeHtml(message.securityHeading)}</h2>${changesHtml ? `<ul style="margin:0 0 16px;padding-left:22px;line-height:1.5">${changesHtml}</ul>` : ""}<p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(message.kept)}</p><p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#475569">${escapeHtml(message.cancel)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td bgcolor="#f07a3a" style="border-radius:10px"><a href="${safeAccountUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(message.cancelAction)}</a></td></tr></table><p style="margin:18px 0 8px;font-size:15px;line-height:1.6"><a href="${safeLoginUrl}" style="color:#334155;font-weight:700">${escapeHtml(message.signInAction)}</a></p><p style="margin:0;font-size:15px;line-height:1.6;color:#475569">${escapeHtml(message.recoveryPrompt)} <a href="${safeRecoveryUrl}" style="color:#334155;font-weight:700">${escapeHtml(message.recoveryAction)}</a></p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;border-top:1px solid #e5e7eb"><tr><td style="padding-top:24px"><p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569">${escapeHtml(message.feedback)}</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td style="border:1px solid #334155;border-radius:10px"><a href="${safeFeedbackUrl}" style="display:inline-block;padding:12px 18px;color:#334155;text-decoration:none;font-weight:700">${escapeHtml(message.feedbackAction)}</a></td></tr></table><p style="margin:24px 0 0;font-size:16px;line-height:1.6">${escapeHtml(message.closing)}</p></td></tr></table></td></tr></table></td></tr></table></body></html>`,
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

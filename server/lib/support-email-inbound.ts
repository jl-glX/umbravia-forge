import { createHmac, timingSafeEqual } from "node:crypto";

const REPLY_TOKEN_LENGTH = 27;
const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
const PUBLIC_TICKET_ID_PATTERN = /^UFS-[A-F0-9]{10}$/;

export interface SupportEmailInboundConfiguration {
  address: string;
  localPart: string;
  domain: string;
  replyTokenKey: Buffer;
  webhookSecret: Buffer;
}

export type SupportEmailRecipient =
  | { kind: "new_ticket" }
  | { kind: "ticket_reply"; publicId: string; token: string };

export interface SupportInboundEmailPayload {
  version: 1;
  envelopeTo: string;
  from: string;
  messageId: string;
  subject: string;
  text: string;
  attachmentCount: number;
}

export class SupportEmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportEmailConfigurationError";
  }
}

export class SupportEmailPayloadError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "SupportEmailPayloadError";
  }
}

function strictBoolean(value: string | undefined, name: string): boolean {
  const normalized = value?.trim().toLowerCase() || "false";
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new SupportEmailConfigurationError(`${name} must be true or false`);
}

function requiredBase64Key(value: string | undefined, name: string): Buffer {
  const configured = value?.trim();
  if (!configured) {
    throw new SupportEmailConfigurationError(
      `${name} is required when support email inbound is enabled`,
    );
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== configured) {
    throw new SupportEmailConfigurationError(
      `${name} must be exactly 32 random bytes encoded as base64`,
    );
  }
  return decoded;
}

function parseMailbox(value: string | undefined): {
  address: string;
  localPart: string;
  domain: string;
} {
  const address = value?.trim().toLowerCase() ?? "";
  const separator = address.lastIndexOf("@");
  const localPart = address.slice(0, separator);
  const domain = address.slice(separator + 1);
  if (
    separator < 1 ||
    !localPart ||
    !domain ||
    localPart.length > 40 ||
    domain.length > 253 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(domain)
  ) {
    throw new SupportEmailConfigurationError(
      "SUPPORT_EMAIL_ADDRESS must be a valid mailbox",
    );
  }
  if (localPart.includes("+")) {
    throw new SupportEmailConfigurationError(
      "SUPPORT_EMAIL_ADDRESS must use an untagged local part",
    );
  }
  return { address, localPart, domain };
}

export function resolveSupportEmailInboundConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SupportEmailInboundConfiguration | null {
  const enabled = strictBoolean(
    environment.SUPPORT_EMAIL_INBOUND_ENABLED,
    "SUPPORT_EMAIL_INBOUND_ENABLED",
  );
  if (!enabled) return null;

  const publicInbound = strictBoolean(
    environment.EMAIL_PUBLIC_INBOUND_ENABLED,
    "EMAIL_PUBLIC_INBOUND_ENABLED",
  );
  if (!publicInbound) {
    throw new SupportEmailConfigurationError(
      "EMAIL_PUBLIC_INBOUND_ENABLED must be true when support email inbound is enabled",
    );
  }
  if (
    environment.EMAIL_PUBLIC_INBOUND_PROVIDER?.trim().toLowerCase() !==
    "cloudflare"
  ) {
    throw new SupportEmailConfigurationError(
      "EMAIL_PUBLIC_INBOUND_PROVIDER must be cloudflare for the support email Worker",
    );
  }

  return {
    ...parseMailbox(environment.SUPPORT_EMAIL_ADDRESS),
    replyTokenKey: requiredBase64Key(
      environment.SUPPORT_EMAIL_REPLY_TOKEN_KEY,
      "SUPPORT_EMAIL_REPLY_TOKEN_KEY",
    ),
    webhookSecret: requiredBase64Key(
      environment.SUPPORT_EMAIL_WEBHOOK_SECRET,
      "SUPPORT_EMAIL_WEBHOOK_SECRET",
    ),
  };
}

function replyToken(
  publicId: string,
  requesterUserId: string,
  key: Buffer,
): string {
  return createHmac("sha256", key)
    .update(`v1\n${publicId}\n${requesterUserId}`)
    .digest("base64url")
    .slice(0, REPLY_TOKEN_LENGTH);
}

export function buildSupportReplyAddress(
  publicId: string,
  requesterUserId: string,
  configuration: SupportEmailInboundConfiguration,
): string {
  if (!PUBLIC_TICKET_ID_PATTERN.test(publicId)) {
    throw new SupportEmailConfigurationError(
      "Invalid public support ticket ID",
    );
  }
  const token = replyToken(
    publicId,
    requesterUserId,
    configuration.replyTokenKey,
  );
  return `${configuration.localPart}+${publicId.toLowerCase()}.${token}@${configuration.domain}`;
}

export function parseSupportEmailRecipient(
  value: string,
  configuration: SupportEmailInboundConfiguration,
): SupportEmailRecipient | null {
  const normalized = value.trim();
  if (normalized.toLowerCase() === configuration.address) {
    return { kind: "new_ticket" };
  }

  const escapedLocalPart = configuration.localPart.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const escapedDomain = configuration.domain.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const match = normalized.match(
    new RegExp(
      `^${escapedLocalPart}\\+(ufs-[a-f0-9]{10})\\.([a-z0-9_-]{${REPLY_TOKEN_LENGTH}})@${escapedDomain}$`,
      "i",
    ),
  );
  if (!match?.[1] || !match[2]) return null;
  return {
    kind: "ticket_reply",
    publicId: match[1].toUpperCase(),
    token: match[2],
  };
}

export function verifySupportReplyToken(
  recipient: Extract<SupportEmailRecipient, { kind: "ticket_reply" }>,
  requesterUserId: string,
  configuration: SupportEmailInboundConfiguration,
): boolean {
  const expected = Buffer.from(
    replyToken(
      recipient.publicId,
      requesterUserId,
      configuration.replyTokenKey,
    ),
  );
  const received = Buffer.from(recipient.token);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function signSupportEmailWebhook(
  body: Uint8Array,
  timestamp: string,
  secret: Uint8Array,
): string {
  return `v1.${createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(body)
    .digest("base64url")}`;
}

export function verifySupportEmailWebhookSignature(input: {
  body: Uint8Array;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: Uint8Array;
  now?: number;
}): boolean {
  if (!/^\d{10}$/.test(input.timestamp ?? "") || !input.signature) {
    return false;
  }
  const timestamp = input.timestamp!;
  const age = Math.abs(
    Math.floor((input.now ?? Date.now()) / 1000) - Number(timestamp),
  );
  if (age > WEBHOOK_MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(
    signSupportEmailWebhook(input.body, timestamp, input.secret),
  );
  const received = Buffer.from(input.signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function boundedString(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new SupportEmailPayloadError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) {
    throw new SupportEmailPayloadError(`${name} is invalid`);
  }
  return normalized;
}

export function parseSupportInboundEmailPayload(
  body: Uint8Array,
): SupportInboundEmailPayload {
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new SupportEmailPayloadError("Malformed support email payload");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new SupportEmailPayloadError(
      "Support email payload must be an object",
    );
  }
  const record = candidate as Record<string, unknown>;
  const allowed = new Set([
    "version",
    "envelopeTo",
    "from",
    "messageId",
    "subject",
    "text",
    "attachmentCount",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new SupportEmailPayloadError("Unknown support email payload field");
  }
  if (record.version !== 1) {
    throw new SupportEmailPayloadError(
      "Unsupported support email payload version",
    );
  }
  if (
    !Number.isInteger(record.attachmentCount) ||
    Number(record.attachmentCount) < 0 ||
    Number(record.attachmentCount) > 100
  ) {
    throw new SupportEmailPayloadError("attachmentCount is invalid");
  }
  return {
    version: 1,
    envelopeTo: boundedString(record.envelopeTo, "envelopeTo", 320),
    from: boundedString(record.from, "from", 320),
    messageId: boundedString(record.messageId, "messageId", 998),
    subject: boundedString(record.subject, "subject", 160, true),
    text: boundedString(record.text, "text", 20_000),
    attachmentCount: Number(record.attachmentCount),
  };
}

export function extractUnquotedSupportReply(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  const replyBoundary =
    /^(?:on .+ wrote:|el .+ escribi[oó]:|am .+ schrieb .+:|-----original message-----|(?:from|de):\s)/i;
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (replyBoundary.test(line.trim())) break;
    if (line.trimStart().startsWith(">")) continue;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

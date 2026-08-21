import { createHmac, timingSafeEqual } from "node:crypto";
import { SupportEmailConfigurationError } from "./support-email-inbound.js";

const PUBLIC_ID_PATTERN = /^UMF-[A-F0-9]{10}$/;
const TOKEN_LENGTH = 27;

export interface UmfSupportEmailConfiguration {
  address: string;
  localPart: string;
  domain: string;
  replyTokenKey: Buffer;
  webhookSecret: Buffer;
}

function strictBoolean(value: string | undefined, name: string): boolean {
  const normalized = value?.trim().toLowerCase() || "false";
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new SupportEmailConfigurationError(`${name} must be true or false`);
}

function key(value: string | undefined, name: string): Buffer {
  const configured = value?.trim();
  if (!configured) {
    throw new SupportEmailConfigurationError(`${name} is required`);
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== configured) {
    throw new SupportEmailConfigurationError(
      `${name} must be exactly 32 random bytes encoded as base64`,
    );
  }
  return decoded;
}

function mailbox(value: string | undefined) {
  const address = value?.trim().toLowerCase() ?? "";
  const separator = address.lastIndexOf("@");
  const localPart = address.slice(0, separator);
  const domain = address.slice(separator + 1);
  if (
    separator < 1 ||
    localPart.length > 40 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(domain) ||
    localPart.includes("+")
  ) {
    throw new SupportEmailConfigurationError(
      "UMF_SUPPORT_EMAIL_ADDRESS must be a valid untagged mailbox",
    );
  }
  return { address, localPart, domain };
}

export function resolveUmfSupportEmailConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): UmfSupportEmailConfiguration | null {
  if (
    !strictBoolean(
      environment.UMF_SUPPORT_EMAIL_INBOUND_ENABLED,
      "UMF_SUPPORT_EMAIL_INBOUND_ENABLED",
    )
  ) {
    return null;
  }
  if (
    !strictBoolean(
      environment.EMAIL_PUBLIC_INBOUND_ENABLED,
      "EMAIL_PUBLIC_INBOUND_ENABLED",
    ) ||
    environment.EMAIL_PUBLIC_INBOUND_PROVIDER?.trim().toLowerCase() !==
      "cloudflare"
  ) {
    throw new SupportEmailConfigurationError(
      "Cloudflare public inbound email must be enabled for UMF Support",
    );
  }
  return {
    ...mailbox(environment.UMF_SUPPORT_EMAIL_ADDRESS),
    replyTokenKey: key(
      environment.UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY,
      "UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY",
    ),
    webhookSecret: key(
      environment.UMF_SUPPORT_EMAIL_WEBHOOK_SECRET,
      "UMF_SUPPORT_EMAIL_WEBHOOK_SECRET",
    ),
  };
}

function token(
  publicId: string,
  requesterEmail: string,
  keyValue: Buffer,
): string {
  return createHmac("sha256", keyValue)
    .update(`v1\n${publicId}\n${requesterEmail.toLowerCase()}`)
    .digest("base64url")
    .slice(0, TOKEN_LENGTH);
}

export function buildUmfSupportReplyAddress(
  publicId: string,
  requesterEmail: string,
  configuration: UmfSupportEmailConfiguration,
): string {
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new SupportEmailConfigurationError("Invalid UMF Support ticket ID");
  }
  return `${configuration.localPart}+${publicId.toLowerCase()}.${token(publicId, requesterEmail, configuration.replyTokenKey)}@${configuration.domain}`;
}

export type UmfSupportEmailRecipient =
  | { kind: "new_ticket" }
  | { kind: "ticket_reply"; publicId: string; token: string };

export function parseUmfSupportEmailRecipient(
  value: string,
  configuration: UmfSupportEmailConfiguration,
): UmfSupportEmailRecipient | null {
  if (value.trim().toLowerCase() === configuration.address) {
    return { kind: "new_ticket" };
  }
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value
    .trim()
    .match(
      new RegExp(
        `^${escape(configuration.localPart)}\\+(umf-[a-f0-9]{10})\\.([a-z0-9_-]{${TOKEN_LENGTH}})@${escape(configuration.domain)}$`,
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

export function verifyUmfSupportReplyToken(
  recipient: Extract<UmfSupportEmailRecipient, { kind: "ticket_reply" }>,
  requesterEmail: string,
  configuration: UmfSupportEmailConfiguration,
): boolean {
  const expected = Buffer.from(
    token(recipient.publicId, requesterEmail, configuration.replyTokenKey),
  );
  const received = Buffer.from(recipient.token);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

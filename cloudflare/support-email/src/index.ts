import PostalMime, { type Address } from "postal-mime";

const MAX_RAW_EMAIL_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;

interface Environment {
  SUPPORT_INBOUND_ENDPOINT: string;
  SUPPORT_INBOUND_WEBHOOK_SECRET: string;
}

interface InboundPayload {
  version: 1;
  envelopeTo: string;
  from: string;
  messageId: string;
  subject: string;
  text: string;
  attachmentCount: number;
}

type InboundFailureStage =
  | "endpoint_configuration"
  | "message_validation"
  | "webhook_signing"
  | "application_delivery";

const SAFE_FAILURE_REASONS = new Set([
  "Support inbound endpoint is missing or invalid",
  "Invalid support email webhook secret",
  "Support inbound endpoint must use HTTPS",
  "Message is too large",
  "Automated messages are not accepted",
  "Message content is invalid",
  "Attachments are not accepted",
  "Support application rejected the message",
]);

const SAFE_DELIVERY_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_FR_TOO_MANY_REDIRECTS",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function deliveryErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  const code = String(cause.code).trim().toUpperCase();
  return SAFE_DELIVERY_ERROR_CODES.has(code) ? code : null;
}

function deliveryFailureCategory(error: unknown): string {
  const code = deliveryErrorCode(error);
  if (code) return `application_delivery_${code.toLowerCase()}`;
  if (!(error instanceof Error)) return "application_delivery_unknown";

  const message = error.message.toLowerCase();
  if (message.includes("redirect")) return "application_delivery_redirect";
  if (message.includes("certificate") || message.includes("tls")) {
    return "application_delivery_tls";
  }
  if (message.includes("dns") || message.includes("resolve")) {
    return "application_delivery_dns";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "application_delivery_timeout";
  }
  if (
    message.includes("connect") ||
    message.includes("network") ||
    error.name === "TypeError"
  ) {
    return "application_delivery_fetch";
  }
  return "application_delivery_unknown";
}

function safeFailureReason(
  error: unknown,
  failureStage: InboundFailureStage,
): string {
  if (error instanceof Error && SAFE_FAILURE_REASONS.has(error.message)) {
    return error.message;
  }
  return failureStage === "application_delivery"
    ? deliveryFailureCategory(error)
    : "Unexpected Worker failure";
}

function mailboxAddress(value: Address | undefined): string | null {
  if (!value || !("address" in value) || !value.address) return null;
  return value.address.trim().toLowerCase();
}

function decodeBase64Key(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.length !== 32) {
    throw new Error("Invalid support email webhook secret");
  }
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function digestMessageId(raw: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}

async function webhookSignature(
  body: string,
  timestamp: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64Key(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return `v1.${base64Url(new Uint8Array(signature))}`;
}

function rejectAutomatedMessage(message: ForwardableEmailMessage): boolean {
  const autoSubmitted = message.headers
    .get("Auto-Submitted")
    ?.trim()
    .toLowerCase();
  const precedence = message.headers.get("Precedence")?.trim().toLowerCase();
  return Boolean(
    (autoSubmitted && autoSubmitted !== "no") ||
    (precedence && ["bulk", "junk", "list"].includes(precedence)),
  );
}

async function preparePayload(
  message: ForwardableEmailMessage,
): Promise<{ body: string; timestamp: string }> {
  if (message.rawSize > MAX_RAW_EMAIL_BYTES) {
    throw new Error("Message is too large");
  }
  if (rejectAutomatedMessage(message)) {
    throw new Error("Automated messages are not accepted");
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: "arraybuffer",
    maxNestingDepth: 20,
    maxHeadersSize: 128 * 1024,
    maxRfc822NestingDepth: 3,
  });
  const headerFrom = mailboxAddress(parsed.from);
  const envelopeFrom = message.from.trim().toLowerCase();
  const subject = parsed.subject?.trim() ?? "";
  const text = parsed.text?.trim() ?? "";
  if (
    !headerFrom ||
    !envelopeFrom ||
    headerFrom !== envelopeFrom ||
    !text ||
    text.length > MAX_TEXT_LENGTH ||
    subject.length > 160
  ) {
    throw new Error("Message content is invalid");
  }
  if (parsed.attachments.length > 0) {
    throw new Error("Attachments are not accepted");
  }

  const payload: InboundPayload = {
    version: 1,
    envelopeTo: message.to.trim(),
    from: envelopeFrom,
    messageId: parsed.messageId?.trim() || (await digestMessageId(raw)),
    subject,
    text,
    attachmentCount: parsed.attachments.length,
  };
  return {
    body: JSON.stringify(payload),
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
}

export const supportEmailWorker = {
  async email(
    message: ForwardableEmailMessage,
    environment: Environment,
  ): Promise<void> {
    let failureStage: InboundFailureStage = "endpoint_configuration";
    let applicationStatus: number | null = null;
    try {
      let endpoint: URL;
      try {
        endpoint = new URL(environment.SUPPORT_INBOUND_ENDPOINT);
      } catch {
        throw new Error("Support inbound endpoint is missing or invalid");
      }
      if (endpoint.protocol !== "https:") {
        throw new Error("Support inbound endpoint must use HTTPS");
      }
      failureStage = "message_validation";
      const { body, timestamp } = await preparePayload(message);
      failureStage = "webhook_signing";
      const signature = await webhookSignature(
        body,
        timestamp,
        environment.SUPPORT_INBOUND_WEBHOOK_SECRET,
      );
      failureStage = "application_delivery";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Umbravia-Timestamp": timestamp,
          "X-Umbravia-Signature": signature,
        },
        body,
        redirect: "error",
      });
      applicationStatus = response.status;
      if (response.status !== 200 && response.status !== 202) {
        throw new Error("Support application rejected the message");
      }
    } catch (error) {
      console.error({
        event: "umf_support_inbound_email_failed",
        failureStage,
        applicationStatus,
        reason: safeFailureReason(error, failureStage),
        });
      message.setReject("The support message could not be accepted.");
    }
  },
};

export default supportEmailWorker;

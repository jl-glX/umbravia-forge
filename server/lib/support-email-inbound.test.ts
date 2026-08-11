import { describe, expect, it } from "vitest";
import {
  buildSupportReplyAddress,
  extractUnquotedSupportReply,
  parseSupportEmailRecipient,
  resolveSupportEmailInboundConfiguration,
  signSupportEmailWebhook,
  verifySupportEmailWebhookSignature,
  verifySupportReplyToken,
} from "./support-email-inbound.js";

function environment(): NodeJS.ProcessEnv {
  return {
    EMAIL_PUBLIC_INBOUND_ENABLED: "true",
    EMAIL_PUBLIC_INBOUND_PROVIDER: "cloudflare",
    SUPPORT_EMAIL_INBOUND_ENABLED: "true",
    SUPPORT_EMAIL_ADDRESS: "support@example.com",
    SUPPORT_EMAIL_REPLY_TOKEN_KEY: Buffer.alloc(32, 19).toString("base64"),
    SUPPORT_EMAIL_WEBHOOK_SECRET: Buffer.alloc(32, 23).toString("base64"),
  };
}

describe("support email inbound security", () => {
  it("stays disabled without requiring secrets", () => {
    expect(resolveSupportEmailInboundConfiguration({})).toBeNull();
  });

  it("builds and verifies a ticket-scoped subaddress", () => {
    const configuration =
      resolveSupportEmailInboundConfiguration(environment());
    expect(configuration).not.toBeNull();
    const address = buildSupportReplyAddress(
      "UFS-0123456789",
      "requester-1",
      configuration!,
    );
    const recipient = parseSupportEmailRecipient(address, configuration!);
    expect(recipient).toMatchObject({
      kind: "ticket_reply",
      publicId: "UFS-0123456789",
    });
    expect(
      recipient?.kind === "ticket_reply" &&
        verifySupportReplyToken(recipient, "requester-1", configuration!),
    ).toBe(true);
    expect(
      recipient?.kind === "ticket_reply" &&
        verifySupportReplyToken(recipient, "other-user", configuration!),
    ).toBe(false);
  });

  it("authenticates exact bytes and rejects expired signatures", () => {
    const secret = Buffer.alloc(32, 31);
    const body = Buffer.from('{"version":1}');
    const now = Date.now();
    const timestamp = Math.floor(now / 1000).toString();
    const signature = signSupportEmailWebhook(body, timestamp, secret);

    expect(
      verifySupportEmailWebhookSignature({
        body,
        timestamp,
        signature,
        secret,
        now,
      }),
    ).toBe(true);
    expect(
      verifySupportEmailWebhookSignature({
        body: Buffer.from('{"version":2}'),
        timestamp,
        signature,
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifySupportEmailWebhookSignature({
        body,
        timestamp,
        signature,
        secret,
        now: now + 6 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("removes quoted history without retaining quoted lines", () => {
    expect(
      extractUnquotedSupportReply(
        "Esta es mi respuesta.\n\nEl lun. 10 escribió:\n> respuesta anterior",
      ),
    ).toBe("Esta es mi respuesta.");
  });

  it("requires separate strong secrets and Cloudflare routing", () => {
    expect(() =>
      resolveSupportEmailInboundConfiguration({
        ...environment(),
        SUPPORT_EMAIL_WEBHOOK_SECRET: "weak",
      }),
    ).toThrow(/32 random bytes/i);
    expect(() =>
      resolveSupportEmailInboundConfiguration({
        ...environment(),
        EMAIL_PUBLIC_INBOUND_PROVIDER: "postfix",
      }),
    ).toThrow(/cloudflare/i);
  });
});

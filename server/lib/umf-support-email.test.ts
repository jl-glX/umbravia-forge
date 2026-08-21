import { describe, expect, it } from "vitest";
import {
  buildUmfSupportReplyAddress,
  parseUmfSupportEmailRecipient,
  resolveUmfSupportEmailConfiguration,
  verifyUmfSupportReplyToken,
} from "./umf-support-email.js";

function environment(): NodeJS.ProcessEnv {
  return {
    EMAIL_PUBLIC_INBOUND_ENABLED: "true",
    EMAIL_PUBLIC_INBOUND_PROVIDER: "cloudflare",
    UMF_SUPPORT_EMAIL_INBOUND_ENABLED: "true",
    UMF_SUPPORT_EMAIL_ADDRESS: "privacy@example.com",
    UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY: Buffer.alloc(32, 17).toString("base64"),
    UMF_SUPPORT_EMAIL_WEBHOOK_SECRET: Buffer.alloc(32, 29).toString("base64"),
  };
}

describe("UMF Support email boundary", () => {
  it("stays disabled without requiring corporate secrets", () => {
    expect(resolveUmfSupportEmailConfiguration({})).toBeNull();
  });

  it("binds reply aliases to the ticket and requester email", () => {
    const configuration = resolveUmfSupportEmailConfiguration(environment());
    expect(configuration).not.toBeNull();
    const address = buildUmfSupportReplyAddress(
      "UMF-0123456789",
      "person@example.net",
      configuration!,
    );
    const recipient = parseUmfSupportEmailRecipient(address, configuration!);
    expect(recipient).toMatchObject({
      kind: "ticket_reply",
      publicId: "UMF-0123456789",
    });
    expect(
      recipient?.kind === "ticket_reply" &&
        verifyUmfSupportReplyToken(
          recipient,
          "person@example.net",
          configuration!,
        ),
    ).toBe(true);
    expect(
      recipient?.kind === "ticket_reply" &&
        verifyUmfSupportReplyToken(
          recipient,
          "attacker@example.net",
          configuration!,
        ),
    ).toBe(false);
  });

  it("rejects weak secrets and shared public inbound without Cloudflare", () => {
    expect(() =>
      resolveUmfSupportEmailConfiguration({
        ...environment(),
        UMF_SUPPORT_EMAIL_WEBHOOK_SECRET: "weak",
      }),
    ).toThrow(/32 random bytes/i);
    expect(() =>
      resolveUmfSupportEmailConfiguration({
        ...environment(),
        EMAIL_PUBLIC_INBOUND_PROVIDER: "postfix",
      }),
    ).toThrow(/Cloudflare/i);
  });
});

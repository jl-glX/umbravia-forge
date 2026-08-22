import { describe, expect, it } from "vitest";
import { resolveUmfSupportMailReadiness } from "./umf-support-mail-readiness.js";

const secret = Buffer.alloc(32, 17).toString("base64");

function outboundEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "25",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    EMAIL_FROM: "no-reply@umbraviaforge.com",
  };
}

function inboundEnvironment(): NodeJS.ProcessEnv {
  return {
    EMAIL_PUBLIC_INBOUND_ENABLED: "true",
    EMAIL_PUBLIC_INBOUND_PROVIDER: "cloudflare",
    UMF_SUPPORT_EMAIL_INBOUND_ENABLED: "true",
    UMF_SUPPORT_EMAIL_ADDRESS: "support@umbraviaforge.com",
    UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY: secret,
    UMF_SUPPORT_EMAIL_WEBHOOK_SECRET: secret,
  };
}

describe("UMF Support mail readiness", () => {
  it("separates configured outbound delivery from disabled inbound reception", () => {
    expect(
      resolveUmfSupportMailReadiness(outboundEnvironment(), {
        outbound: true,
        inbound: false,
      }),
    ).toMatchObject({
      outbound: true,
      inbound: false,
      outboundState: "configured",
      queueState: "development_fallback",
      inboundState: "disabled",
      addressConfigured: false,
      configurationValid: true,
      outboundOperationallyVerified: true,
      inboundOperationallyVerified: false,
    });
  });

  it("reports an invalid inbound configuration without exposing secrets", () => {
    expect(
      resolveUmfSupportMailReadiness(
        {
          ...outboundEnvironment(),
          ...inboundEnvironment(),
          UMF_SUPPORT_EMAIL_WEBHOOK_SECRET: "invalid",
        },
        { outbound: false, inbound: false },
      ),
    ).toMatchObject({
      outbound: true,
      inbound: false,
      inboundState: "invalid",
      addressConfigured: true,
      configurationValid: false,
    });
  });

  it("keeps configuration and end-to-end evidence as separate claims", () => {
    const environment = {
      ...outboundEnvironment(),
      ...inboundEnvironment(),
    };
    expect(
      resolveUmfSupportMailReadiness(environment, {
        outbound: false,
        inbound: false,
      }),
    ).toMatchObject({
      outbound: true,
      inbound: true,
      inboundState: "configured",
      outboundOperationallyVerified: false,
      inboundOperationallyVerified: false,
    });
    expect(
      resolveUmfSupportMailReadiness(environment, {
        outbound: true,
        inbound: true,
      }),
    ).toMatchObject({
      outboundOperationallyVerified: true,
      inboundOperationallyVerified: true,
    });
  });

  it("fails outbound closed when production queue protection is missing", () => {
    expect(
      resolveUmfSupportMailReadiness(
        {
          ...outboundEnvironment(),
          NODE_ENV: "production",
          APP_ENV: "production",
        },
        { outbound: false, inbound: false },
      ),
    ).toMatchObject({
      outbound: false,
      outboundState: "configured",
      queueState: "missing",
    });
  });
});

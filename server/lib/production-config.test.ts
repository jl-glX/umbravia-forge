import { describe, expect, it } from "vitest";
import { validateProductionConfiguration } from "./production-config.js";

const validEnvironment = {
  NODE_ENV: "production",
  CLIENT_ORIGIN: "https://demo.umbravia-forge.example",
  WEBAUTHN_ORIGIN: "https://demo.umbravia-forge.example",
  WEBAUTHN_RP_ID: "demo.umbravia-forge.example",
  DATABASE_PROVIDER: "postgresql",
  DATABASE_URL: "postgresql://127.0.0.1/umbravia_forge",
  DATABASE_SSL: "false",
  DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
  TURNSTILE_SECRET_KEY: "turnstile-production-secret-123456789",
  EMAIL_VERIFICATION_ENABLED: "true",
  EMAIL_QUEUE_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
  MANAGER_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SMTP_HOST: "smtp.example.invalid",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASSWORD: "smtp-password",
  EMAIL_FROM: "Umbravia Forge <no-reply@example.invalid>",
  HOST: "127.0.0.1",
  SEED_DEMO_DATA: "false",
};

describe("production configuration", () => {
  it("does nothing outside production", () => {
    expect(validateProductionConfiguration({ NODE_ENV: "test" })).toBeNull();
  });

  it("accepts a complete HTTPS configuration", () => {
    expect(
      validateProductionConfiguration(validEnvironment, "postgresql"),
    ).toMatchObject({ webauthnRpId: "demo.umbravia-forge.example" });
  });

  it("applies the same safeguards to staging", () => {
    expect(
      validateProductionConfiguration(
        { ...validEnvironment, APP_ENV: "staging" },
        "postgresql",
      ),
    ).toMatchObject({
      deploymentProfile: "staging",
      webauthnRpId: "demo.umbravia-forge.example",
    });
  });

  it("fails closed when configuration and active provider disagree", () => {
    expect(() =>
      validateProductionConfiguration(validEnvironment, "sqlite"),
    ).toThrow(/active database provider/i);
  });

  it("rejects missing database configuration and insecure origins", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        DATABASE_URL: "",
      }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        CLIENT_ORIGIN: "http://demo.umbravia-forge.example",
      }),
    ).toThrow(/HTTPS/);
  });

  it("requires verified TLS for a remote PostgreSQL server", () => {
    const remoteEnvironment = {
      ...validEnvironment,
      DATABASE_URL: "postgresql://db.internal.example/umbravia_forge",
      DATABASE_SSL: "true",
    };

    expect(() =>
      validateProductionConfiguration(
        { ...remoteEnvironment, DATABASE_SSL: "false" },
        "postgresql",
      ),
    ).toThrow(/must use TLS/i);
    expect(() =>
      validateProductionConfiguration(
        {
          ...remoteEnvironment,
          DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
        },
        "postgresql",
      ),
    ).toThrow(/verify the server certificate/i);
    expect(
      validateProductionConfiguration(remoteEnvironment, "postgresql"),
    ).toMatchObject({ deploymentProfile: "production" });
  });

  it("requires email verification in production", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        EMAIL_VERIFICATION_ENABLED: "false",
      }),
    ).toThrow(/EMAIL_VERIFICATION_ENABLED/);
  });

  it("requires a complete email channel", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        SMTP_HOST: "",
        SMTP_PORT: "",
        SMTP_SECURE: "",
        SMTP_REQUIRE_TLS: "",
        SMTP_USER: "",
        SMTP_PASSWORD: "",
        EMAIL_FROM: "",
      }),
    ).toThrow(/email verification/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        SMTP_PASSWORD: "",
      }),
    ).toThrow(/configured together/i);
  });

  it("accepts the direct MX transport without SMTP relay credentials", () => {
    const directEnvironment = {
      ...validEnvironment,
      EMAIL_TRANSPORT_MODE: "direct_mx",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_SECURE: "",
      SMTP_REQUIRE_TLS: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      EMAIL_FROM: "Umbravia Forge <no-reply@example.invalid>",
      EMAIL_DIRECT_HELO_NAME: "mail.example.invalid",
      EMAIL_DKIM_DOMAIN: "example.invalid",
      EMAIL_DKIM_SELECTOR: "mail",
      EMAIL_DKIM_PRIVATE_KEY_PATH: "/run/credentials/mail-dkim.pem",
    };

    expect(
      validateProductionConfiguration(directEnvironment, "postgresql"),
    ).toMatchObject({ deploymentProfile: "production" });
  });

  it("requires independent secrets for Cloudflare support email inbound", () => {
    const inboundEnvironment = {
      ...validEnvironment,
      EMAIL_PUBLIC_INBOUND_ENABLED: "true",
      EMAIL_PUBLIC_INBOUND_PROVIDER: "cloudflare",
      SUPPORT_EMAIL_INBOUND_ENABLED: "true",
      SUPPORT_EMAIL_ADDRESS: "support@example.invalid",
      SUPPORT_EMAIL_REPLY_TOKEN_KEY: Buffer.alloc(32, 31).toString("base64"),
      SUPPORT_EMAIL_WEBHOOK_SECRET: Buffer.alloc(32, 32).toString("base64"),
    };
    expect(
      validateProductionConfiguration(inboundEnvironment, "postgresql"),
    ).toMatchObject({ deploymentProfile: "production" });
    expect(() =>
      validateProductionConfiguration(
        { ...inboundEnvironment, SUPPORT_EMAIL_WEBHOOK_SECRET: "" },
        "postgresql",
      ),
    ).toThrow(/SUPPORT_EMAIL_WEBHOOK_SECRET/);
  });

  it("rejects public demo credentials in production", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        SEED_DEMO_DATA: "true",
      }),
    ).toThrow(/SEED_DEMO_DATA/);
  });

  it("fails closed when enabled Stripe billing is incomplete", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        STRIPE_BILLING_ENABLED: "true",
      }),
    ).toThrow(/STRIPE_RESTRICTED_API_KEY/);
  });

  it("rejects public binding, Turnstile test data and invalid encryption keys", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        HOST: "0.0.0.0",
      }),
    ).toThrow(/loopback/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        TURNSTILE_SECRET_KEY: "replace-me",
      }),
    ).toThrow(/placeholder/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      }),
    ).toThrow(/test key/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        MFA_ENCRYPTION_KEY: "not-a-valid-key",
      }),
    ).toThrow(/32 random bytes/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        EMAIL_QUEUE_ENCRYPTION_KEY: "not-a-valid-key",
      }),
    ).toThrow(/32 random bytes/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        MANAGER_CONNECTION_ENCRYPTION_KEY: "not-a-valid-key",
      }),
    ).toThrow(/32 random bytes|canonical base64/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
        PRIVATE_CONTENT_ENCRYPTION_KEY: "invalid",
      }),
    ).toThrow(/valid hexadecimal, base64, or base64url/i);
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
        PRIVATE_CONTENT_ENCRYPTION_KEY: Buffer.alloc(16, 13).toString(
          "base64url",
        ),
      }),
    ).toThrow(/exactly 32 bytes/i);
  });

  it("accepts a portable 32-byte private-content key when enabled", () => {
    expect(
      validateProductionConfiguration(
        {
          ...validEnvironment,
          PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
          PRIVATE_CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString(
            "base64url",
          ),
        },
        "postgresql",
      ),
    ).toMatchObject({ deploymentProfile: "production" });
  });

  it("accepts a versioned private-content keyring for safe rotation", () => {
    const currentKey = Buffer.alloc(32, 21).toString("base64url");
    const nextKey = Buffer.alloc(32, 22).toString("base64url");
    expect(
      validateProductionConfiguration(
        {
          ...validEnvironment,
          PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
          PRIVATE_CONTENT_ENCRYPTION_KEY: currentKey,
          PRIVATE_CONTENT_ENCRYPTION_KEYRING: `current:${currentKey},next:${nextKey}`,
          PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID: "next",
        },
        "postgresql",
      ),
    ).toMatchObject({ deploymentProfile: "production" });
  });

  it("rejects a private-content keyring without an available active key", () => {
    expect(() =>
      validateProductionConfiguration({
        ...validEnvironment,
        PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
        PRIVATE_CONTENT_ENCRYPTION_KEYRING: `current:${Buffer.alloc(32, 23).toString("base64url")}`,
        PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID: "missing",
      }),
    ).toThrow(/does not exist/i);
  });
});

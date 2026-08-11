import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  auditEncryptionConfiguration,
  getAccountDataProtectionOverview,
} from "./encryption-manager.js";

const key = Buffer.alloc(32, 7).toString("base64");

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    APP_ENV: "production",
    NODE_ENV: "production",
    CLIENT_ORIGIN: "https://www.umbraviaforge.com",
    MFA_ENCRYPTION_KEY: key,
    EMAIL_QUEUE_ENCRYPTION_KEY: key,
    PRIVATE_CONTENT_ENCRYPTION_ENABLED: "true",
    PRIVATE_CONTENT_ENCRYPTION_KEY: key,
    MANAGER_CONNECTION_ENCRYPTION_KEY: key,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "25",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    EMAIL_FROM: "Umbravia Forge <no-reply@umbraviaforge.com>",
    UMBRAVIA_BACKUP_AGE_RECIPIENT: `age1${"q".repeat(58)}`,
    ...overrides,
  };
}

describe("encryption manager", () => {
  it("reports a complete production configuration without exposing keys", () => {
    const environment = productionEnvironment();
    const audit = auditEncryptionConfiguration(environment);

    expect(audit.healthy).toBe(true);
    expect(audit.findings).toEqual([]);
    expect(audit.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "password_hashing",
          primitive: "Argon2id",
          state: "active",
        }),
        expect.objectContaining({
          id: "private_content",
          primitive: "XChaCha20-Poly1305",
          state: "active",
        }),
        expect.objectContaining({
          id: "manager_connections",
          primitive: "XChaCha20-Poly1305 authenticated envelopes",
          state: "active",
          keyMaterialExposed: false,
        }),
        expect.objectContaining({
          id: "e2ee_relay",
          state: "client_managed",
        }),
      ]),
    );
    expect(audit.capabilities.every((item) => !item.keyMaterialExposed)).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain(key);
  });

  it("uses stable issue codes for invalid production configuration", () => {
    const audit = auditEncryptionConfiguration(
      productionEnvironment({
        CLIENT_ORIGIN: "http://umbraviaforge.com",
        MFA_ENCRYPTION_KEY: "not-a-key",
        EMAIL_QUEUE_ENCRYPTION_KEY: "also-not-a-key",
        PRIVATE_CONTENT_ENCRYPTION_KEY: "invalid",
        MANAGER_CONNECTION_ENCRYPTION_KEY: "invalid",
        UMBRAVIA_BACKUP_AGE_RECIPIENT: "not-an-age-recipient",
      }),
    );

    expect(audit.healthy).toBe(false);
    expect(audit.findings).toEqual(
      expect.arrayContaining([
        "MFA_KEY_INVALID",
        "EMAIL_QUEUE_KEY_INVALID",
        "PRIVATE_CONTENT_CONFIGURATION_INVALID",
        "MANAGER_CONNECTION_KEY_INVALID",
        "BACKUP_RECIPIENT_INVALID",
        "TRANSPORT_ORIGIN_NOT_HTTPS",
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain("not-a-key");
  });

  it("distinguishes a missing production mail transport from key failure", () => {
    const audit = auditEncryptionConfiguration(
      productionEnvironment({
        SMTP_HOST: undefined,
        SMTP_PORT: undefined,
        SMTP_SECURE: undefined,
        SMTP_REQUIRE_TLS: undefined,
        EMAIL_FROM: undefined,
      }),
    );
    const email = audit.capabilities.find((item) => item.id === "email_queue");

    expect(email).toMatchObject({
      primitive: "AES-256-GCM",
      state: "invalid",
      issueCode: "EMAIL_TRANSPORT_MISSING",
      keyMaterialExposed: false,
    });
  });

  it("limits the account view to account-facing protection capabilities", () => {
    const overview = getAccountDataProtectionOverview(
      productionEnvironment({
        SMTP_HOST: undefined,
        SMTP_PORT: undefined,
        SMTP_SECURE: undefined,
        SMTP_REQUIRE_TLS: undefined,
        EMAIL_FROM: undefined,
      }),
    );

    expect(overview.healthy).toBe(true);
    expect(overview.capabilities.map((item) => item.id)).toEqual([
      "password_hashing",
      "private_content",
      "e2ee_relay",
      "transport_security",
    ]);
    expect(JSON.stringify(overview)).not.toContain("issueCode");
    expect(JSON.stringify(overview)).not.toContain("keyMaterial");
  });
});

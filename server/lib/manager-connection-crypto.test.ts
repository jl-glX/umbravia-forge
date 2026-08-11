import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getManagerConnectionCryptoStatus,
  protectManagerConnectionPayload,
  revealManagerConnectionPayload,
  validateManagerConnectionCryptoConfiguration,
} from "./manager-connection-crypto.js";

const context = "manager-connection:account:email:channel-readiness";

afterEach(() => vi.unstubAllEnvs());

describe("manager connection encryption", () => {
  it("authenticates the manager identities and capability", () => {
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    const plaintext = Buffer.from('{"ready":true}', "utf8");
    const envelope = protectManagerConnectionPayload(plaintext, context);

    expect(envelope).not.toContain(plaintext.toString("utf8"));
    expect(revealManagerConnectionPayload(envelope, context)).toEqual(
      plaintext,
    );
    expect(() =>
      revealManagerConnectionPayload(
        envelope,
        "manager-connection:support:email:channel-readiness",
      ),
    ).toThrow(/authentication failed/i);
  });

  it("rejects tampering", () => {
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    const envelope = protectManagerConnectionPayload(
      Buffer.from("private manager state"),
      context,
    );
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(() => revealManagerConnectionPayload(tampered, context)).toThrow();
  });

  it("supports a versioned keyring for controlled rotation", () => {
    const current = randomBytes(32).toString("base64");
    const next = randomBytes(32).toString("base64");
    vi.stubEnv(
      "MANAGER_CONNECTION_ENCRYPTION_KEYRING",
      `current:${current},next:${next}`,
    );
    vi.stubEnv("MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID", "current");
    const envelope = protectManagerConnectionPayload(
      Buffer.from("coordinated"),
      context,
    );
    vi.stubEnv("MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID", "next");

    expect(revealManagerConnectionPayload(envelope, context).toString()).toBe(
      "coordinated",
    );
    expect(getManagerConnectionCryptoStatus()).toMatchObject({
      writeVersion: "mcx2",
      readableKeyCount: 2,
      keyMaterialExposed: false,
    });
  });

  it("requires an independent valid key in production", () => {
    const environment: NodeJS.ProcessEnv = {
      APP_ENV: "production",
      NODE_ENV: "production",
    };
    expect(() =>
      validateManagerConnectionCryptoConfiguration(environment),
    ).toThrow(/required in production/i);
    expect(() =>
      validateManagerConnectionCryptoConfiguration({
        ...environment,
        MANAGER_CONNECTION_ENCRYPTION_KEY: "invalid",
      }),
    ).toThrow(/32 random bytes|canonical base64/i);
  });
});

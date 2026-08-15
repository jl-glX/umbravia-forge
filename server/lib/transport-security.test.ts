import { createSecureContext } from "node:tls";
import { describe, expect, it } from "vitest";
import {
  MODERN_AEAD_TLS_CIPHERS,
  authenticatedModernTlsOptions,
} from "./transport-security.js";

describe("authenticated server transport policy", () => {
  it("prefers AES-GCM and permits only modern authenticated suites", () => {
    const policy = authenticatedModernTlsOptions();

    expect(policy).toMatchObject({
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    });
    expect(MODERN_AEAD_TLS_CIPHERS.split(":").slice(0, 2)).toEqual([
      "TLS_AES_256_GCM_SHA384",
      "TLS_AES_128_GCM_SHA256",
    ]);
    for (const cipher of MODERN_AEAD_TLS_CIPHERS.split(":")) {
      expect(cipher.includes("GCM") || cipher.includes("CHACHA20")).toBe(true);
      expect(cipher).not.toContain("CBC");
      expect(cipher).not.toContain("NULL");
      expect(cipher).not.toContain("3DES");
      expect(cipher).not.toContain("RC4");
    }
    expect(() => createSecureContext(policy)).not.toThrow();
  });
});

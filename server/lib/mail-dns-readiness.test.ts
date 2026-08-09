import { describe, expect, it } from "vitest";
import {
  assessMailDnsReadiness,
  extractSenderDomain,
  type MailDnsResolver,
} from "./mail-dns-readiness.js";

function resolver(overrides: Partial<MailDnsResolver> = {}): MailDnsResolver {
  return {
    resolveMx: async () => [{ exchange: "mail.example.com", priority: 10 }],
    resolve4: async () => ["192.0.2.10"],
    resolve6: async () => [],
    reverse: async () => ["mail.example.com"],
    resolveTxt: async (hostname) => {
      if (hostname === "example.com") return [["v=spf1 ip4:192.0.2.10 -all"]];
      if (hostname === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
      if (hostname === "forge._domainkey.example.com") {
        return [["v=DKIM1; k=rsa; p=test"]];
      }
      return [];
    },
    ...overrides,
  };
}

describe("mail DNS readiness", () => {
  it("extracts plain and display-name sender domains", () => {
    expect(extractSenderDomain("notify@example.com")).toBe("example.com");
    expect(extractSenderDomain("Umbravia Forge <notify@Example.com>")).toBe(
      "example.com",
    );
    expect(extractSenderDomain("invalid")).toBeNull();
  });

  it("accepts an aligned MX, address, PTR, SPF, DKIM and DMARC", async () => {
    const findings = await assessMailDnsReadiness(
      {
        emailFrom: "Umbravia Forge <notify@example.com>",
        expectedMailHost: "mail.example.com",
        dkimSelector: "forge",
        strictAuthentication: true,
        inboundEnabled: true,
      },
      resolver(),
    );

    expect(findings.every((finding) => finding.level === "pass")).toBe(true);
  });

  it("fails immediately when the sender domain has no public MX", async () => {
    const findings = await assessMailDnsReadiness(
      { emailFrom: "notify@example.com", inboundEnabled: true },
      resolver({ resolveMx: async () => [] }),
    );

    expect(findings).toEqual([
      expect.objectContaining({ code: "MX_MISSING", level: "error" }),
    ]);
  });

  it("rejects a Null MX instead of treating it as a mail host", async () => {
    const findings = await assessMailDnsReadiness(
      { emailFrom: "notify@example.com", inboundEnabled: true },
      resolver({
        resolveMx: async () => [{ exchange: ".", priority: 0 }],
      }),
    );

    expect(findings).toEqual([
      expect.objectContaining({ code: "MX_NULL", level: "error" }),
    ]);
  });

  it("uses the MX with the lowest priority value by default", async () => {
    const findings = await assessMailDnsReadiness(
      {
        emailFrom: "notify@example.com",
        strictAuthentication: true,
        inboundEnabled: true,
      },
      resolver({
        resolveMx: async () => [
          { exchange: "backup.example.com", priority: 20 },
          { exchange: "mail.example.com", priority: 10 },
        ],
      }),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MX_READY", level: "pass" }),
      ]),
    );
    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MX_TARGET_MISMATCH" }),
      ]),
    );
  });

  it("reports missing authentication as warnings until strict mode is enabled", async () => {
    const noAuthentication = resolver({ resolveTxt: async () => [] });
    const advisory = await assessMailDnsReadiness(
      {
        emailFrom: "notify@example.com",
        expectedMailHost: "mail.example.com",
      },
      noAuthentication,
    );
    const strict = await assessMailDnsReadiness(
      {
        emailFrom: "notify@example.com",
        expectedMailHost: "mail.example.com",
        strictAuthentication: true,
      },
      noAuthentication,
    );

    expect(advisory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPF_MISSING", level: "warning" }),
        expect.objectContaining({ code: "DMARC_MISSING", level: "warning" }),
        expect.objectContaining({
          code: "DKIM_SELECTOR_MISSING",
          level: "warning",
        }),
      ]),
    );
    expect(strict).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPF_MISSING", level: "error" }),
        expect.objectContaining({ code: "DMARC_MISSING", level: "error" }),
        expect.objectContaining({
          code: "DKIM_SELECTOR_MISSING",
          level: "error",
        }),
      ]),
    );
  });

  it("validates outbound authentication without requiring a public MX", async () => {
    const findings = await assessMailDnsReadiness(
      {
        emailFrom: "notify@example.com",
        expectedMailHost: "mail.example.com",
        dkimSelector: "forge",
        strictAuthentication: true,
        inboundEnabled: false,
      },
      resolver({ resolveMx: async () => [] }),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INBOUND_DISABLED", level: "pass" }),
        expect.objectContaining({
          code: "MAIL_HOST_ADDRESS_READY",
          level: "pass",
        }),
        expect.objectContaining({ code: "SPF_READY", level: "pass" }),
        expect.objectContaining({ code: "DKIM_READY", level: "pass" }),
        expect.objectContaining({ code: "DMARC_READY", level: "pass" }),
      ]),
    );
    expect(findings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MX_MISSING" })]),
    );
  });
});

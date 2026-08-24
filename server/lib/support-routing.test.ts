import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERNAL_HELPDESK_EMAIL,
  DEFAULT_EXTERNAL_HELPDESK_PORTAL_URL,
  DEFAULT_GENERAL_FALLBACK_EMAIL,
  DEFAULT_LEGAL_RIGHTS_EMAIL,
  internalSupportTicketsEnabled,
  publicSupportContacts,
  umfSupportOperationalWorkspaceEnabled,
} from "./support-routing.js";

describe("temporary external support routing", () => {
  it("fails closed to external routing when flags are absent", () => {
    expect(internalSupportTicketsEnabled({})).toBe(false);
    expect(umfSupportOperationalWorkspaceEnabled({})).toBe(false);
    expect(publicSupportContacts({})).toEqual({
      helpdeskPortalEnabled: false,
      helpdeskPortalUrl: DEFAULT_EXTERNAL_HELPDESK_PORTAL_URL,
      helpdeskEmail: DEFAULT_EXTERNAL_HELPDESK_EMAIL,
      generalFallbackEmail: DEFAULT_GENERAL_FALLBACK_EMAIL,
      legalRightsEmail: DEFAULT_LEGAL_RIGHTS_EMAIL,
    });
  });

  it("allows an explicit and reversible internal reactivation", () => {
    const environment = {
      INTERNAL_SUPPORT_TICKETS_ENABLED: "true",
      UMF_SUPPORT_OPERATIONAL_WORKSPACE_ENABLED: "TRUE",
    };
    expect(internalSupportTicketsEnabled(environment)).toBe(true);
    expect(umfSupportOperationalWorkspaceEnabled(environment)).toBe(true);
  });

  it("rejects malformed public contact addresses", () => {
    expect(() =>
      publicSupportContacts({ EXTERNAL_HELPDESK_EMAIL_ADDRESS: "invalid" }),
    ).toThrow(/email is invalid/i);
    expect(() =>
      publicSupportContacts({
        EXTERNAL_HELPDESK_PORTAL_URL: "http://support.example.com",
      }),
    ).toThrow(/portal URL is invalid/i);
  });
});

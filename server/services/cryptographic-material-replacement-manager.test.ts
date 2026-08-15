import { describe, expect, it } from "vitest";
import {
  getCryptographicMaterialFamilies,
  getCryptographicMaterialReplacementOverview,
  getLocallyGeneratedReplacementFamilies,
} from "./cryptographic-material-replacement-manager.js";

describe("cryptographic material replacement manager", () => {
  it("covers local, provider, offline and user-held material without exposing names", () => {
    const overview = getCryptographicMaterialReplacementOverview();

    expect(overview).toMatchObject({
      role: "encryption_manager_auxiliary",
      mode: "prepare_only",
      authority: "encryption_manager",
      policy: {
        automaticActivation: false,
        automaticRetirement: false,
        overwritesExistingMaterial: false,
        exposesRawMaterialThroughApi: false,
        requiresVerifiedMigrationPerFamily: true,
      },
    });
    expect(overview.families.map((family) => family.id)).toEqual(
      expect.arrayContaining([
        "email_queue",
        "manager_connections",
        "mfa_envelope",
        "private_content",
        "support_reply_tokens",
        "support_inbound_webhook",
        "mail_dkim",
        "turnstile",
        "transport_tls",
        "encrypted_backups",
        "user_authenticators",
      ]),
    );
    expect(JSON.stringify(overview)).not.toContain("ENCRYPTION_KEY");
    expect(JSON.stringify(overview)).not.toContain("WEBHOOK_SECRET");
  });

  it("only exposes application-owned local secret families to the generator", () => {
    const local = getLocallyGeneratedReplacementFamilies();
    expect(local.every((family) => family.secretEnvironmentName)).toBe(true);
    expect(local.map((family) => family.id)).not.toContain("mail_dkim");
    expect(local.map((family) => family.id)).not.toContain("turnstile");
    expect(local.map((family) => family.id)).not.toContain("encrypted_backups");
  });

  it("defines retirement gates for every cryptographic family", () => {
    expect(
      getCryptographicMaterialFamilies().every(
        (family) => family.retirementPreconditions.length > 0,
      ),
    ).toBe(true);
  });
});

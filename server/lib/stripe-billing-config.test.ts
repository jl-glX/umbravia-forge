import { describe, expect, it } from "vitest";
import { resolveStripeBillingConfiguration } from "./stripe-billing-config.js";

const configuredEnvironment = {
  STRIPE_BILLING_ENABLED: "true",
  STRIPE_RESTRICTED_API_KEY: "rk_test_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
  STRIPE_PRICE_FORGE_MONTHLY: "price_monthly",
  STRIPE_PRICE_FORGE_ANNUAL: "price_annual",
};

describe("Stripe billing configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveStripeBillingConfiguration({})).toBeNull();
  });

  it("accepts only a complete test-mode restricted configuration", () => {
    expect(resolveStripeBillingConfiguration(configuredEnvironment)).toEqual({
      restrictedApiKey: "rk_test_example",
      webhookSecret: "whsec_example",
      prices: { monthly: "price_monthly", annual: "price_annual" },
      portalConfigurationId: null,
      liveMode: false,
    });
  });

  it("rejects live and unrestricted keys", () => {
    expect(() =>
      resolveStripeBillingConfiguration({
        ...configuredEnvironment,
        STRIPE_RESTRICTED_API_KEY: "rk_live_example",
      }),
    ).toThrow("restricted Stripe test key");
    expect(() =>
      resolveStripeBillingConfiguration({
        ...configuredEnvironment,
        STRIPE_RESTRICTED_API_KEY: "sk_test_example",
      }),
    ).toThrow("restricted Stripe test key");
  });
});

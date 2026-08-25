import { describe, expect, it } from "vitest";
import { resolveStripeConnectConfiguration } from "./stripe-connect-config.js";

const sandboxEnvironment = {
  STRIPE_CONNECT_ENABLED: "true",
  STRIPE_CONNECT_MODE: "sandbox",
  STRIPE_CONNECT_RESTRICTED_API_KEY: "rk_test_example",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_example",
};

describe("Stripe Connect configuration", () => {
  it("is closed unless explicitly enabled", () => {
    expect(resolveStripeConnectConfiguration({})).toBeNull();
  });

  it("accepts an isolated Sandbox configuration", () => {
    expect(resolveStripeConnectConfiguration(sandboxEnvironment)).toMatchObject(
      {
        mode: "sandbox",
        liveMode: false,
      },
    );
  });

  it("rejects unrestricted or mode-mismatched keys", () => {
    expect(() =>
      resolveStripeConnectConfiguration({
        ...sandboxEnvironment,
        STRIPE_CONNECT_RESTRICTED_API_KEY: "sk_test_example",
      }),
    ).toThrow(/restricted Stripe sandbox key/);
    expect(() =>
      resolveStripeConnectConfiguration({
        ...sandboxEnvironment,
        STRIPE_CONNECT_MODE: "live",
        STRIPE_CONNECT_RESTRICTED_API_KEY: "rk_test_example",
      }),
    ).toThrow(/production deployment profile/);
  });

  it("requires a signed webhook endpoint", () => {
    expect(() =>
      resolveStripeConnectConfiguration({
        ...sandboxEnvironment,
        STRIPE_CONNECT_WEBHOOK_SECRET: "invalid",
      }),
    ).toThrow(/webhook secret/);
  });
});

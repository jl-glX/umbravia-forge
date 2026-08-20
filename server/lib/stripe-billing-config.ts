export type CommercialPlanKey = "monthly" | "annual";

export interface StripeBillingConfiguration {
  restrictedApiKey: string;
  webhookSecret: string;
  prices: Record<CommercialPlanKey, string>;
  portalConfigurationId: string | null;
  mode: "test" | "live";
  liveMode: boolean;
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`${name} is required when Stripe billing is enabled`);
  return value;
}

export function resolveStripeBillingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): StripeBillingConfiguration | null {
  if (environment.STRIPE_BILLING_ENABLED !== "true") return null;

  const restrictedApiKey = requiredValue(
    environment,
    "STRIPE_RESTRICTED_API_KEY",
  );
  const webhookSecret = requiredValue(environment, "STRIPE_WEBHOOK_SECRET");
  const monthlyPrice = requiredValue(environment, "STRIPE_PRICE_FORGE_MONTHLY");
  const annualPrice = requiredValue(environment, "STRIPE_PRICE_FORGE_ANNUAL");
  const portalConfigurationId =
    environment.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || null;
  const mode = environment.STRIPE_BILLING_MODE?.trim() || "test";

  if (mode !== "test" && mode !== "live") {
    throw new Error("STRIPE_BILLING_MODE must be test or live");
  }
  if (mode === "live" && environment.NODE_ENV !== "production") {
    throw new Error("Stripe Live billing requires NODE_ENV=production");
  }
  const expectedKeyPrefix = mode === "live" ? "rk_live_" : "rk_test_";
  if (!restrictedApiKey.startsWith(expectedKeyPrefix)) {
    throw new Error(
      `STRIPE_RESTRICTED_API_KEY must be a restricted Stripe ${mode} key`,
    );
  }
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be a Stripe webhook secret");
  }
  for (const [name, value] of [
    ["STRIPE_PRICE_FORGE_MONTHLY", monthlyPrice],
    ["STRIPE_PRICE_FORGE_ANNUAL", annualPrice],
  ] as const) {
    if (!value.startsWith("price_")) {
      throw new Error(`${name} must be a Stripe Price identifier`);
    }
  }
  if (portalConfigurationId && !portalConfigurationId.startsWith("bpc_")) {
    throw new Error(
      "STRIPE_PORTAL_CONFIGURATION_ID must be a Stripe portal configuration identifier",
    );
  }

  return {
    restrictedApiKey,
    webhookSecret,
    prices: { monthly: monthlyPrice, annual: annualPrice },
    portalConfigurationId,
    mode,
    liveMode: mode === "live",
  };
}

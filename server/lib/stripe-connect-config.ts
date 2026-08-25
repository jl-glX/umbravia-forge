import { resolveDeploymentProfile } from "./deployment-profile.js";

export interface StripeConnectConfiguration {
  restrictedApiKey: string;
  webhookSecret: string;
  mode: "sandbox" | "live";
  liveMode: boolean;
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`${name} is required when Stripe Connect is enabled`);
  return value;
}

export function resolveStripeConnectConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): StripeConnectConfiguration | null {
  if (environment.STRIPE_CONNECT_ENABLED !== "true") return null;

  const mode = environment.STRIPE_CONNECT_MODE?.trim() || "sandbox";
  if (mode !== "sandbox" && mode !== "live") {
    throw new Error("STRIPE_CONNECT_MODE must be sandbox or live");
  }
  if (
    mode === "live" &&
    (environment.NODE_ENV !== "production" ||
      resolveDeploymentProfile(environment) !== "production")
  ) {
    throw new Error(
      "Stripe Connect Live requires the production deployment profile",
    );
  }

  const restrictedApiKey = requiredValue(
    environment,
    "STRIPE_CONNECT_RESTRICTED_API_KEY",
  );
  const webhookSecret = requiredValue(
    environment,
    "STRIPE_CONNECT_WEBHOOK_SECRET",
  );
  const expectedPrefix = mode === "live" ? "rk_live_" : "rk_test_";
  if (!restrictedApiKey.startsWith(expectedPrefix)) {
    throw new Error(
      `STRIPE_CONNECT_RESTRICTED_API_KEY must be a restricted Stripe ${mode} key`,
    );
  }
  if (!webhookSecret.startsWith("whsec_")) {
    throw new Error(
      "STRIPE_CONNECT_WEBHOOK_SECRET must be a Stripe webhook secret",
    );
  }

  return {
    restrictedApiKey,
    webhookSecret,
    mode,
    liveMode: mode === "live",
  };
}

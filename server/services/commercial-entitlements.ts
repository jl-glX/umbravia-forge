import { db } from "../db/client.js";
import type { CommercialSubscriptionStatus } from "../db/types.js";
import { resolveStripeBillingConfiguration } from "../lib/stripe-billing-config.js";

const PAID_STATUSES = new Set<CommercialSubscriptionStatus>([
  "trialing",
  "active",
]);

export interface CommercialEntitlements {
  enforcementEnabled: boolean;
  source: "billing_disabled" | "stripe" | "commercial_trial" | "none";
  capabilities: {
    operationalCore: boolean;
    analytics: boolean;
    crm: boolean;
  };
}

export type CommercialCapability = keyof CommercialEntitlements["capabilities"];

export async function getCommercialEntitlements(
  facilityId: string,
): Promise<CommercialEntitlements> {
  const configuration = resolveStripeBillingConfiguration();
  if (!configuration) {
    return {
      enforcementEnabled: false,
      source: "billing_disabled",
      capabilities: { operationalCore: true, analytics: true, crm: true },
    };
  }

  const subscription = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select("status")
    .where("facilityId", "=", facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (subscription && PAID_STATUSES.has(subscription.status)) {
    return {
      enforcementEnabled: true,
      source: "stripe",
      capabilities: { operationalCore: true, analytics: true, crm: true },
    };
  }

  const now = Date.now();
  const trial = await db
    .selectFrom("commercialTrials")
    .select(["status", "expiresAt"])
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  const trialActive =
    trial?.expiresAt !== undefined &&
    trial.expiresAt > now &&
    [
      "trial_active",
      "trial_paused_support",
      "trial_conversion_review",
    ].includes(trial.status);
  if (trialActive) {
    return {
      enforcementEnabled: true,
      source: "commercial_trial",
      capabilities: { operationalCore: true, analytics: true, crm: true },
    };
  }

  return {
    enforcementEnabled: true,
    source: "none",
    capabilities: { operationalCore: true, analytics: false, crm: false },
  };
}

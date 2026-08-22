import { db } from "../db/client.js";
import { resolveUmfSupportEmailConfiguration } from "../lib/umf-support-email.js";
import { getEmailManagerReadiness } from "./email-manager.js";

export type UmfSupportMailConfigurationState =
  "configured" | "disabled" | "missing" | "invalid";

export type UmfSupportMailQueueState =
  "configured" | "development_fallback" | "missing" | "invalid";

export interface UmfSupportMailEvidence {
  outbound: boolean;
  inbound: boolean;
}

export interface UmfSupportMailReadiness {
  outbound: boolean;
  inbound: boolean;
  address: string | null;
  addressConfigured: boolean;
  configurationValid: boolean;
  outboundState: UmfSupportMailConfigurationState;
  queueState: UmfSupportMailQueueState;
  inboundState: Exclude<UmfSupportMailConfigurationState, "missing">;
  outboundOperationallyVerified: boolean;
  inboundOperationallyVerified: boolean;
}

export function resolveUmfSupportMailReadiness(
  environment: NodeJS.ProcessEnv,
  evidence: UmfSupportMailEvidence,
): UmfSupportMailReadiness {
  const delivery = getEmailManagerReadiness(environment);
  let inboundState: UmfSupportMailReadiness["inboundState"] = "disabled";
  try {
    if (resolveUmfSupportEmailConfiguration(environment)) {
      inboundState = "configured";
    }
  } catch {
    inboundState = "invalid";
  }

  return {
    outbound: delivery.capabilities.supportNotifications,
    inbound: inboundState === "configured",
    address:
      environment.UMF_SUPPORT_EMAIL_ADDRESS?.trim().toLowerCase() || null,
    addressConfigured: Boolean(environment.UMF_SUPPORT_EMAIL_ADDRESS?.trim()),
    configurationValid: inboundState !== "invalid",
    outboundState: delivery.outbound.state,
    queueState: delivery.queueProtection.state,
    inboundState,
    outboundOperationallyVerified: evidence.outbound,
    inboundOperationallyVerified: evidence.inbound,
  };
}

export async function getUmfSupportMailReadiness(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<UmfSupportMailReadiness> {
  const [outboundEvidence, inboundEvidence] = await Promise.all([
    db
      .selectFrom("emailDeliveries")
      .select("id")
      .where("platformScope", "=", "support")
      .where("status", "=", "sent")
      .where("sentAt", "is not", null)
      .executeTakeFirst(),
    db
      .selectFrom("umfSupportMessages")
      .select("id")
      .where("direction", "=", "inbound")
      .where("channel", "=", "email")
      .executeTakeFirst(),
  ]);

  return resolveUmfSupportMailReadiness(environment, {
    outbound: Boolean(outboundEvidence),
    inbound: Boolean(inboundEvidence),
  });
}

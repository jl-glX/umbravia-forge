import { db } from "../db/client.js";
import { captchaIsConfigured } from "./captcha.js";
import { getManagerCoordinationStatus } from "./manager-coordinator.js";
import { getSecurityEncryptionHardeningOverview } from "./encryption-manager.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECENT_EVENT_LIMIT = 50;
const SECURITY_EVENT_SCAN_LIMIT = 5_000;

type SecurityLevel = "low" | "medium" | "high";

interface SecurityEventMetadata {
  action?: string;
  level?: SecurityLevel;
  reason?: string;
  surface?: string;
}

function parseMetadata(value: string): SecurityEventMetadata {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const source = parsed as Record<string, unknown>;
    const metadata: SecurityEventMetadata = {};
    if (typeof source.action === "string")
      metadata.action = source.action.slice(0, 160);
    if (["low", "medium", "high"].includes(String(source.level))) {
      metadata.level = source.level as SecurityLevel;
    }
    if (typeof source.reason === "string")
      metadata.reason = source.reason.slice(0, 160);
    if (typeof source.surface === "string")
      metadata.surface = source.surface.slice(0, 160);
    return metadata;
  } catch {
    return {};
  }
}

export async function getSecurityManagerOverview() {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * DAY_MS;
  const oneDayAgo = now - DAY_MS;
  const rows = await db
    .selectFrom("securityEvents")
    .select(["id", "userId", "type", "createdAt", "metadata"])
    .where("createdAt", ">=", sevenDaysAgo)
    .orderBy("createdAt", "desc")
    .limit(SECURITY_EVENT_SCAN_LIMIT + 1)
    .execute();

  const sampleTruncated = rows.length > SECURITY_EVENT_SCAN_LIMIT;
  const events = rows.slice(0, SECURITY_EVENT_SCAN_LIMIT).map((event) => ({
    id: event.id,
    userId: event.userId,
    type: event.type,
    createdAt: event.createdAt,
    metadata: parseMetadata(event.metadata),
  }));
  const lastDay = events.filter((event) => event.createdAt >= oneDayAgo);
  const riskEvents = events.filter((event) => event.type === "risk_observed");

  return {
    generatedAt: now,
    mode: "observe" as const,
    automaticBlockingEnabled: false,
    controls: {
      captcha: {
        configured: captchaIsConfigured(),
        execution: "manual" as const,
        serverValidation: true,
      },
      trustedMutationOrigin: true,
      authenticationRateLimit: true,
      securityHeaders: true,
      riskEngine: "observe" as const,
    },
    metrics: {
      failedLogins24h: lastDay.filter((event) => event.type === "login_failed")
        .length,
      captchaFailures24h: lastDay.filter(
        (event) => event.type === "captcha_failed",
      ).length,
      captchaSuccesses24h: lastDay.filter(
        (event) => event.type === "captcha_succeeded",
      ).length,
      riskObservations7d: riskEvents.length,
      highRiskObservations7d: riskEvents.filter(
        (event) => event.metadata.level === "high",
      ).length,
      sampleTruncated,
    },
    encryption: getSecurityEncryptionHardeningOverview(),
    coordination: getManagerCoordinationStatus(),
    recentEvents: events.slice(0, RECENT_EVENT_LIMIT),
  };
}

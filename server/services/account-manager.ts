import { getSecurityOverview } from "./account-security.js";
import { getAccountLifecycle } from "./account-lifecycle.js";
import { getRecoveryCapabilities } from "./account-recovery.js";
import { getManagerCoordinationStatus } from "./manager-coordinator.js";
import { getAccountDataProtectionOverview } from "./encryption-manager.js";
import { getManagedEmailChannelCapabilities } from "./email-manager.js";

export async function getAccountManagerOverview(
  userId: string,
  sessionId: string,
  accountStatus: "pending_verification" | "active" | "security_review",
) {
  const [lifecycle, security] = await Promise.all([
    getAccountLifecycle(userId),
    getSecurityOverview(userId, sessionId),
  ]);
  const recoveryCapabilities = getRecoveryCapabilities();
  const activeRecoveryMethods = [
    "password",
    ...(accountStatus === "pending_verification" ? [] : ["email"]),
    ...(security.mfa.enabled && security.mfa.recoveryCodesRemaining > 0
      ? ["code"]
      : []),
    ...(security.passkeys.count > 0 ? ["passkey"] : []),
  ];

  return {
    accountStatus,
    security: {
      mfaEnabled: security.mfa.enabled,
      passkeyCount: security.passkeys.count,
      activeSessionCount: security.sessions.length,
      recoveryCodesRemaining: security.mfa.recoveryCodesRemaining,
    },
    lifecycle: {
      currentState: lifecycle.currentState,
      inactivityMonths: lifecycle.inactivityMonths,
      lastMeaningfulActivityAt: lifecycle.lastMeaningfulActivityAt,
      deletionRequest: lifecycle.deletionRequest,
      deletionExecutionEnabled: false as const,
    },
    recovery: {
      activeMethods: activeRecoveryMethods,
      availableMethods: recoveryCapabilities
        .filter((method) => method.status === "available")
        .map((method) => method.id),
      plannedMethods: recoveryCapabilities
        .filter((method) => method.status === "planned")
        .map((method) => method.id),
    },
    communication: getManagedEmailChannelCapabilities("account"),
    continuity: lifecycle.continuityBridge,
    dataProtection: getAccountDataProtectionOverview(),
    coordination: getManagerCoordinationStatus("commercial"),
  };
}

import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";

export type SecurityEventType =
  | "login_succeeded"
  | "email_verified"
  | "verification_email_sent"
  | "login_failed"
  | "captcha_succeeded"
  | "captcha_failed"
  | "form_verification_succeeded"
  | "risk_observed"
  | "mfa_challenge_created"
  | "mfa_challenge_failed"
  | "mfa_succeeded"
  | "mfa_enabled"
  | "mfa_disabled"
  | "passkey_registered"
  | "passkey_removed"
  | "passkey_login_succeeded"
  | "recovery_codes_regenerated"
  | "session_revoked"
  | "all_other_sessions_revoked"
  | "support_id_rotated"
  | "account_compromise_reported"
  | "deletion_preference_updated"
  | "account_deletion_scheduled"
  | "account_deletion_cancelled"
  | "account_data_deletion_draft_updated"
  | "account_recovery_requested"
  | "account_recovery_failed"
  | "account_recovery_password_reset"
  | "account_recovery_completed"
  | "account_representation_draft_saved"
  | "account_representation_revoked"
  | "retention_policy_drafted"
  | "retention_policy_reviewed"
  | "retention_hold_changed";

export async function recordSecurityEvent(
  type: SecurityEventType,
  userId: string | null,
  metadata: Record<string, string | number | boolean> = {},
): Promise<void> {
  await db
    .insertInto("securityEvents")
    .values({
      id: `security-${randomBytes(12).toString("hex")}`,
      userId,
      type,
      createdAt: Date.now(),
      metadata: JSON.stringify(metadata),
    })
    .execute();
}

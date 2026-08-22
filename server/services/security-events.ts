import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";

export type SecurityEventType =
  | "login_succeeded"
  | "email_verified"
  | "verification_email_sent"
  | "email_delivery_payload_rejected"
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
  | "mfa_recovery_code_used"
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
  | "account_deletion_preparation_notified"
  | "account_deletion_cancelled"
  | "account_deletion_completed"
  | "account_inactivity_review_queued"
  | "account_inactivity_review_delivered"
  | "account_inactivity_review_answered"
  | "account_inactivity_review_reminder_queued"
  | "account_data_deletion_draft_updated"
  | "account_recovery_requested"
  | "account_recovery_failed"
  | "account_recovery_password_reset"
  | "account_recovery_completed"
  | "account_representation_draft_saved"
  | "account_representation_revoked"
  | "retention_policy_drafted"
  | "retention_policy_reviewed"
  | "retention_hold_changed"
  | "private_content_accessed"
  | "private_content_rewrapped"
  | "private_attachment_uploaded"
  | "private_attachment_downloaded"
  | "private_attachment_deleted"
  | "e2ee_identity_change_rejected"
  | "e2ee_attachment_uploaded"
  | "e2ee_attachment_downloaded"
  | "e2ee_attachment_deleted"
  | "umf_support_access_requested"
  | "umf_support_access_approved"
  | "umf_support_access_rejected"
  | "umf_support_activation_failed"
  | "umf_support_account_activated"
  | "umf_support_staff_changed"
  | "umf_support_administrator_approved"
  | "umf_support_collaboration_space_changed"
  | "corporate_role_delegated"
  | "corporate_role_accepted"
  | "corporate_role_rejected"
  | "corporate_role_renounced"
  | "corporate_role_self_enabled"
  | "company_staff_updated"
  | "company_head_bootstrapped"
  | "email_change_requested"
  | "email_change_cancelled"
  | "email_change_expired"
  | "email_changed";

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

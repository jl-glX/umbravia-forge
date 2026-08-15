export type CryptographicMaterialFamilyId =
  | "email_queue"
  | "manager_connections"
  | "mfa_envelope"
  | "private_content"
  | "support_reply_tokens"
  | "support_inbound_webhook"
  | "mail_dkim"
  | "turnstile"
  | "transport_tls"
  | "encrypted_backups"
  | "user_authenticators";

export type CryptographicMaterialKind =
  | "symmetric_key"
  | "hmac_secret"
  | "asymmetric_keypair"
  | "provider_secret"
  | "certificate"
  | "offline_identity"
  | "user_credential";

export type ReplacementGenerationMode =
  | "local_supported"
  | "provider_managed"
  | "offline_operator"
  | "user_reenrollment";

export interface CryptographicMaterialFamily {
  id: CryptographicMaterialFamilyId;
  kind: CryptographicMaterialKind;
  owner: "encryption" | "email" | "security" | "deployment" | "user";
  custody:
    "application" | "restricted_file" | "provider" | "offline" | "user_device";
  generation: ReplacementGenerationMode;
  activationStrategy: string;
  retirementPreconditions: readonly string[];
  secretEnvironmentName?: string;
}

const MATERIAL_FAMILIES = [
  {
    id: "email_queue",
    kind: "symmetric_key",
    owner: "email",
    custody: "application",
    generation: "local_supported",
    secretEnvironmentName: "EMAIL_QUEUE_ENCRYPTION_KEY",
    activationStrategy: "drain_or_reencrypt_pending_queue_then_switch",
    retirementPreconditions: [
      "no_pending_records_encrypted_only_with_previous_key",
      "queue_delivery_and_recovery_verified",
    ],
  },
  {
    id: "manager_connections",
    kind: "symmetric_key",
    owner: "encryption",
    custody: "application",
    generation: "local_supported",
    secretEnvironmentName: "MANAGER_CONNECTION_ENCRYPTION_KEY",
    activationStrategy: "add_to_keyring_activate_then_retire_after_restart",
    retirementPreconditions: [
      "all_managers_accept_new_key_id",
      "encrypted_manager_signals_readable_or_expired",
    ],
  },
  {
    id: "mfa_envelope",
    kind: "symmetric_key",
    owner: "security",
    custody: "application",
    generation: "local_supported",
    secretEnvironmentName: "MFA_ENCRYPTION_KEY",
    activationStrategy: "reencrypt_totp_secrets_before_switch",
    retirementPreconditions: [
      "all_totp_secrets_reencrypted",
      "totp_login_and_recovery_verified",
    ],
  },
  {
    id: "private_content",
    kind: "symmetric_key",
    owner: "encryption",
    custody: "application",
    generation: "local_supported",
    secretEnvironmentName: "PRIVATE_CONTENT_ENCRYPTION_KEY",
    activationStrategy: "add_to_keyring_reencrypt_activate_then_retire",
    retirementPreconditions: [
      "private_content_migration_completed",
      "old_key_usage_count_is_zero",
    ],
  },
  {
    id: "support_reply_tokens",
    kind: "hmac_secret",
    owner: "email",
    custody: "application",
    generation: "local_supported",
    secretEnvironmentName: "SUPPORT_EMAIL_REPLY_TOKEN_KEY",
    activationStrategy:
      "expire_or_dual_validate_outstanding_tokens_then_switch",
    retirementPreconditions: [
      "outstanding_reply_window_closed_or_migrated",
      "reply_routing_verified",
    ],
  },
  {
    id: "support_inbound_webhook",
    kind: "hmac_secret",
    owner: "email",
    custody: "provider",
    generation: "local_supported",
    secretEnvironmentName: "SUPPORT_EMAIL_WEBHOOK_SECRET",
    activationStrategy: "coordinate_cloudflare_and_server_then_verify_inbound",
    retirementPreconditions: [
      "cloudflare_and_server_use_same_replacement",
      "signed_inbound_delivery_verified",
    ],
  },
  {
    id: "mail_dkim",
    kind: "asymmetric_keypair",
    owner: "email",
    custody: "restricted_file",
    generation: "local_supported",
    activationStrategy: "publish_new_selector_validate_dns_then_switch_signing",
    retirementPreconditions: [
      "new_selector_resolves_publicly",
      "signed_delivery_passes_dkim",
      "old_selector_retention_window_elapsed",
    ],
  },
  {
    id: "turnstile",
    kind: "provider_secret",
    owner: "security",
    custody: "provider",
    generation: "provider_managed",
    activationStrategy: "rotate_at_provider_then_coordinate_application_update",
    retirementPreconditions: [
      "new_provider_secret_validated",
      "signup_login_and_recovery_captcha_verified",
    ],
  },
  {
    id: "transport_tls",
    kind: "certificate",
    owner: "deployment",
    custody: "restricted_file",
    generation: "provider_managed",
    activationStrategy: "renew_with_acme_then_reload_services",
    retirementPreconditions: [
      "certificate_chain_and_hostname_validated",
      "https_and_starttls_verified",
    ],
  },
  {
    id: "encrypted_backups",
    kind: "offline_identity",
    owner: "deployment",
    custody: "offline",
    generation: "offline_operator",
    activationStrategy: "add_recipient_create_backup_restore_test_then_retire",
    retirementPreconditions: [
      "new_identity_stored_offline",
      "backup_encrypted_for_new_recipient",
      "full_restore_verified",
      "retained_backups_using_old_identity_expired_or_reencrypted",
    ],
  },
  {
    id: "user_authenticators",
    kind: "user_credential",
    owner: "user",
    custody: "user_device",
    generation: "user_reenrollment",
    activationStrategy:
      "revoke_compromised_credential_and_require_reenrollment",
    retirementPreconditions: [
      "replacement_authenticator_verified",
      "recovery_path_confirmed",
    ],
  },
] as const satisfies readonly CryptographicMaterialFamily[];

export function getCryptographicMaterialFamilies(): readonly CryptographicMaterialFamily[] {
  return MATERIAL_FAMILIES;
}

export function getLocallyGeneratedReplacementFamilies(): readonly CryptographicMaterialFamily[] {
  return MATERIAL_FAMILIES.filter(
    (family) =>
      family.generation === "local_supported" &&
      family.kind !== "asymmetric_keypair",
  );
}

export function getCryptographicMaterialReplacementOverview() {
  return {
    role: "encryption_manager_auxiliary" as const,
    mode: "prepare_only" as const,
    authority: "encryption_manager" as const,
    policy: {
      automaticActivation: false as const,
      automaticRetirement: false as const,
      overwritesExistingMaterial: false as const,
      exposesRawMaterialThroughApi: false as const,
      requiresVerifiedMigrationPerFamily: true as const,
    },
    families: MATERIAL_FAMILIES.map(
      ({
        id,
        kind,
        owner,
        custody,
        generation,
        activationStrategy,
        retirementPreconditions,
      }) => ({
        id,
        kind,
        owner,
        custody,
        generation,
        activationStrategy,
        retirementPreconditions: [...retirementPreconditions],
      }),
    ),
  };
}

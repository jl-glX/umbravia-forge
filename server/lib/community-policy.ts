export const profileVisibilities = [
  "public",
  "contacts",
  "facility",
  "selected_communities",
  "authorized_staff",
  "private",
] as const;

export type ProfileVisibility = (typeof profileVisibilities)[number];

export const facilityLinkStatuses = [
  "facility_link_requested",
  "facility_link_accepted",
  "facility_link_rejected",
  "facility_link_active",
  "facility_link_suspended",
  "facility_link_expired",
  "facility_link_terminated",
] as const;

export const contactStatuses = [
  "contact_requested",
  "contact_accepted",
  "contact_rejected",
  "contact_blocked",
  "contact_removed",
] as const;

export const communityStatuses = [
  "community_active",
  "community_read_only",
  "community_suspended",
  "community_closed",
] as const;

export const parentalControlStatuses = [
  "parental_control_inactive",
  "parental_control_pending",
  "parental_control_active",
  "parental_control_under_review",
  "parental_control_transitioning",
  "parental_control_ended",
] as const;

export const moderationStatuses = [
  "unrestricted",
  "muted",
  "removed_from_chat",
  "temporarily_blocked",
  "blocked_by_facility",
  "under_central_review",
  "appeal_open",
  "platform_suspended",
] as const;

export const moderationCategories = [
  "conduct",
  "harassment",
  "threats",
  "hate",
  "spam",
  "privacy",
  "impersonation",
  "unsafe_content",
  "other",
] as const;

export type ModerationCategory = (typeof moderationCategories)[number];

export function isModerationCategory(
  value: unknown,
): value is ModerationCategory {
  return (
    typeof value === "string" &&
    moderationCategories.includes(value as ModerationCategory)
  );
}

export const institutionalPrinciples = {
  neutrality:
    "La plataforma no condiciona el acceso a adhesiones políticas, religiosas o ideológicas.",
  reciprocity:
    "La libertad, privacidad y dignidad de cada persona exigen el mismo respeto hacia usuarios, centros y plataforma.",
  conductBasedModeration:
    "Las decisiones se basan en conducta, contexto, pruebas, daño, reiteración, gravedad y proporcionalidad.",
} as const;

export const institutionalPrincipleIds = [
  "neutrality",
  "reciprocity",
  "conductBasedModeration",
] as const;

export type InstitutionalPrincipleId =
  (typeof institutionalPrincipleIds)[number];

export function institutionalPrinciplesResponse(format: unknown) {
  if (format === "keys") {
    return {
      version: 2 as const,
      principleIds: institutionalPrincipleIds,
    };
  }
  return institutionalPrinciples;
}

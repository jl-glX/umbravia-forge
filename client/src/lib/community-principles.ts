export const communityPrincipleIds = [
  "neutrality",
  "reciprocity",
  "conductBasedModeration",
] as const;

export const communityPrinciplesEndpoint =
  "/api/community/principles?format=keys";

export type CommunityPrincipleId = (typeof communityPrincipleIds)[number];

export const communityPrincipleTranslationKeys = {
  neutrality: "community.institutionalPrinciples.neutrality",
  reciprocity: "community.institutionalPrinciples.reciprocity",
  conductBasedModeration:
    "community.institutionalPrinciples.conductBasedModeration",
} as const satisfies Record<CommunityPrincipleId, string>;

function isCommunityPrincipleId(value: unknown): value is CommunityPrincipleId {
  return (
    typeof value === "string" &&
    communityPrincipleIds.includes(value as CommunityPrincipleId)
  );
}

function isLegacyPrinciplesResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ("version" in record) return false;
  return communityPrincipleIds.every(
    (principleId) => typeof record[principleId] === "string",
  );
}

export function readCommunityPrincipleIds(
  value: unknown,
): CommunityPrincipleId[] {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 2 &&
    Array.isArray((value as { principleIds?: unknown }).principleIds)
  ) {
    return [
      ...new Set(
        (value as { principleIds: unknown[] }).principleIds.filter(
          isCommunityPrincipleId,
        ),
      ),
    ];
  }
  return isLegacyPrinciplesResponse(value) ? [...communityPrincipleIds] : [];
}

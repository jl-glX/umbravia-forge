import { describe, expect, it } from "vitest";
import {
  communityPrincipleIds,
  communityPrinciplesEndpoint,
  readCommunityPrincipleIds,
} from "./community-principles";

describe("community principle contract", () => {
  it("requests the opt-in semantic response without replacing the v1 endpoint", () => {
    expect(communityPrinciplesEndpoint).toBe(
      "/api/community/principles?format=keys",
    );
  });

  it("accepts the versioned semantic response without duplicates or unknown ids", () => {
    expect(
      readCommunityPrincipleIds({
        version: 2,
        principleIds: [
          "neutrality",
          "unknown",
          "reciprocity",
          "neutrality",
          "conductBasedModeration",
        ],
      }),
    ).toEqual(communityPrincipleIds);
  });

  it("maps the legacy textual response to local ids without returning its prose", () => {
    const legacyProse = {
      neutrality: "legacy neutrality text",
      reciprocity: "legacy reciprocity text",
      conductBasedModeration: "legacy moderation text",
    };
    const result = readCommunityPrincipleIds(legacyProse);

    expect(result).toEqual(communityPrincipleIds);
    expect(result).not.toContain(Object.values(legacyProse).join(" "));
  });

  it.each([
    null,
    [],
    { version: 2, principleIds: ["unknown"] },
    {
      version: 3,
      neutrality: "future text",
      reciprocity: "future text",
      conductBasedModeration: "future text",
    },
    {},
  ])("fails closed for malformed or unsupported input %#", (value) => {
    expect(readCommunityPrincipleIds(value)).toEqual([]);
  });
});

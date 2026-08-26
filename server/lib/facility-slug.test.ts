import { describe, expect, it } from "vitest";
import {
  createFacilitySlug,
  createTrialSubdomain,
  isAllowedFacilitySlug,
  normalizeFacilitySlugBase,
} from "./facility-slug.js";

describe("facility DNS slugs", () => {
  it("normalizes names into stable ASCII labels", () => {
    expect(normalizeFacilitySlugBase("  Gimnasio Ártico / Jaén  ")).toBe(
      "gimnasio-artico-jaen",
    );
    expect(createFacilitySlug("Gimnasio Ártico", "1234abcd")).toBe(
      "gimnasio-artico-1234abcd",
    );
  });

  it("keeps reserved infrastructure names out of tenant labels", () => {
    expect(isAllowedFacilitySlug("admin")).toBe(false);
    expect(isAllowedFacilitySlug("support")).toBe(false);
    expect(createFacilitySlug("Admin", "1234abcd")).toBe(
      "admin-centro-1234abcd",
    );
    expect(createTrialSubdomain("Support")).toBe("support-centro-demo");
  });

  it("rejects nested, malformed and oversized DNS labels", () => {
    expect(isAllowedFacilitySlug("alpha.beta")).toBe(false);
    expect(isAllowedFacilitySlug("-alpha")).toBe(false);
    expect(isAllowedFacilitySlug("a".repeat(64))).toBe(false);
  });
});

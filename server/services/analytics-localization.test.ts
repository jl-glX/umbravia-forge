import { describe, expect, it } from "vitest";
import { formatAnalyticsMonth } from "./analytics.js";

describe("analytics month localization", () => {
  it.each([
    ["en", "January"],
    ["fr", "janvier"],
    ["ca-valencia", "gener"],
  ])("uses the persisted %s locale", (locale, monthName) => {
    expect(formatAnalyticsMonth(2026, 1, locale).toLowerCase()).toContain(
      monthName.toLowerCase(),
    );
  });

  it("falls back explicitly to Spanish when a persisted locale is missing", () => {
    expect(formatAnalyticsMonth(2026, 1, undefined).toLowerCase()).toContain(
      "enero",
    );
  });
});

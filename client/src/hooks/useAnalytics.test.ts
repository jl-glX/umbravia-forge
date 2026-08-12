import { describe, expect, it } from "vitest";
import { analyticsPeriodBounds } from "./useAnalytics";

describe("analyticsPeriodBounds", () => {
  it("builds a local calendar day rather than a rolling 24-hour interval", () => {
    const reference = new Date(2026, 7, 12, 18, 45, 0);
    const bounds = analyticsPeriodBounds("day", reference);
    const from = new Date(bounds.from);
    const to = new Date(bounds.to);

    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getDate()).toBe(from.getDate() + 1);
    expect(to.getHours()).toBe(0);
    expect(bounds.utcOffsetMinutes).toBe(-reference.getTimezoneOffset());
  });

  it("starts a week on Monday and a month on its first local day", () => {
    const reference = new Date(2026, 7, 12, 18, 45, 0);
    const week = new Date(analyticsPeriodBounds("week", reference).from);
    const month = new Date(analyticsPeriodBounds("month", reference).from);

    expect(week.getDay()).toBe(1);
    expect(week.getDate()).toBe(10);
    expect(month.getDate()).toBe(1);
  });
});

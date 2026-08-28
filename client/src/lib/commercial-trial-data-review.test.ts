import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS,
  COMMERCIAL_TRIAL_REFRESH_RETRY_MS,
  scheduleCommercialTrialDataReviewRefresh,
  scheduleCommercialTrialDataReviewRefreshIfNeeded,
} from "./commercial-trial-data-review";

describe("commercial trial data-review refresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the server delay and refreshes once at the boundary despite client clock skew", async () => {
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    const refresh = vi.fn(async () => true);
    const cancel = scheduleCommercialTrialDataReviewRefresh({
      opensAt: 1_000_100,
      serverNow: 1_000_000,
      refresh,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(COMMERCIAL_TRIAL_REFRESH_RETRY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("chunks delays above the platform timer maximum", async () => {
    const refresh = vi.fn(async () => true);
    const cancel = scheduleCommercialTrialDataReviewRefresh({
      opensAt: COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS + 101,
      serverNow: 1,
      refresh,
    });

    await vi.advanceTimersByTimeAsync(COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("backs off after a failed refresh instead of spinning", async () => {
    const refresh = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const cancel = scheduleCommercialTrialDataReviewRefresh({
      opensAt: 11,
      serverNow: 10,
      refresh,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(COMMERCIAL_TRIAL_REFRESH_RETRY_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    cancel();
  });

  it("cancels scheduled work on rerender or unmount", async () => {
    const refresh = vi.fn(async () => true);
    const cancel = scheduleCommercialTrialDataReviewRefresh({
      opensAt: 101,
      serverNow: 1,
      refresh,
    });
    cancel();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    "cleanup-started",
    "inapplicable-state",
    "already-declared",
    null,
  ] as const)(
    "does not schedule repeated refreshes for %s",
    async (declarationBlockReason) => {
      const refresh = vi.fn(async () => true);
      const cancel = scheduleCommercialTrialDataReviewRefreshIfNeeded({
        dataReview: {
          opensAt: 1,
          serverNow: 100,
          declarationBlockReason,
        },
        refresh,
      });

      expect(cancel).toBeUndefined();
      await vi.runAllTimersAsync();
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing server time", { opensAt: 100, serverNow: undefined }],
    ["NaN opening", { opensAt: Number.NaN, serverNow: 1 }],
    ["infinite opening", { opensAt: Number.POSITIVE_INFINITY, serverNow: 1 }],
    ["zero opening", { opensAt: 0, serverNow: 1 }],
    ["negative opening", { opensAt: -1, serverNow: 1 }],
    ["NaN server time", { opensAt: 100, serverNow: Number.NaN }],
    [
      "infinite server time",
      { opensAt: 100, serverNow: Number.POSITIVE_INFINITY },
    ],
    ["zero server time", { opensAt: 100, serverNow: 0 }],
    ["negative server time", { opensAt: 100, serverNow: -1 }],
    ["elapsed server boundary", { opensAt: 100, serverNow: 100 }],
  ])("fails closed for %s", async (_label, dataReview) => {
    const refresh = vi.fn(async () => true);
    const cancel = scheduleCommercialTrialDataReviewRefreshIfNeeded({
      dataReview: { ...dataReview, declarationBlockReason: "not-open" },
      refresh,
    });

    expect(cancel).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not schedule for a legacy overview without dataReview", async () => {
    const refresh = vi.fn(async () => true);
    expect(
      scheduleCommercialTrialDataReviewRefreshIfNeeded({ refresh }),
    ).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });
});

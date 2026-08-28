import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS,
  COMMERCIAL_TRIAL_MIN_EPOCH_MS,
  getCommercialTrialDataReviewAvailability,
} from "./commercial-trial.js";

describe("commercial trial real-data review window", () => {
  const expiresAt = Date.parse("2026-09-30T18:00:00.000Z");
  const opensAt = expiresAt - COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
  const pending = {
    status: "trial_active",
    realDataDeclaration: "undeclared" as const,
    expiresAt,
    cleanupEligibleAt: null,
  };

  it.each([
    ["six hours plus one millisecond", opensAt - 1, false, false, "not-open"],
    ["exactly six hours", opensAt, true, true, null],
    ["one millisecond before expiry", expiresAt - 1, true, true, null],
    ["exactly at expiry", expiresAt, true, true, null],
  ] as const)(
    "%s resolves visibility and declaration consistently",
    (_label, now, visible, canDeclare, declarationBlockReason) => {
      expect(getCommercialTrialDataReviewAvailability(pending, now)).toEqual({
        visible,
        canDeclare,
        opensAt,
        declarationBlockReason,
      });
    },
  );

  it("keeps a pending expired trial actionable after its end", () => {
    expect(
      getCommercialTrialDataReviewAvailability(
        {
          ...pending,
          status: "trial_expired",
          cleanupEligibleAt: expiresAt + 6 * 60 * 60 * 1000,
        },
        expiresAt + 1,
      ),
    ).toEqual({
      visible: true,
      canDeclare: true,
      opensAt,
      declarationBlockReason: null,
    });
  });

  it("uses the extended expiry after a support pause is resumed", () => {
    const extendedExpiry = expiresAt + 2 * 24 * 60 * 60 * 1000;
    const extendedOpening =
      extendedExpiry - COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
    const resumed = { ...pending, expiresAt: extendedExpiry };
    expect(
      getCommercialTrialDataReviewAvailability(resumed, extendedOpening - 1),
    ).toEqual({
      visible: false,
      canDeclare: false,
      opensAt: extendedOpening,
      declarationBlockReason: "not-open",
    });
    expect(
      getCommercialTrialDataReviewAvailability(resumed, extendedOpening),
    ).toEqual({
      visible: true,
      canDeclare: true,
      opensAt: extendedOpening,
      declarationBlockReason: null,
    });
  });

  it.each([
    ["yes", "trial_conversion_review"],
    ["no", "trial_closed"],
    ["assistance", "trial_paused_support"],
  ] as const)(
    "preserves a legacy %s decision while hiding it until the opening boundary",
    (realDataDeclaration, status) => {
      const trial = {
        status,
        realDataDeclaration,
        expiresAt,
        cleanupEligibleAt: null,
      };
      const snapshot = { ...trial };
      expect(
        getCommercialTrialDataReviewAvailability(trial, opensAt - 1),
      ).toEqual({
        visible: false,
        canDeclare: false,
        opensAt,
        declarationBlockReason: "already-declared",
      });
      for (const now of [opensAt, opensAt + 1]) {
        expect(getCommercialTrialDataReviewAvailability(trial, now)).toEqual({
          visible: true,
          canDeclare: false,
          opensAt,
          declarationBlockReason: "already-declared",
        });
      }
      expect(trial).toEqual(snapshot);
    },
  );

  it.each([
    [
      "support-paused assistance",
      "trial_paused_support",
      "assistance",
      null,
      true,
    ],
    ["recorded real data", "trial_conversion_review", "yes", null, true],
    ["scheduled deletion after no", "trial_closed", "no", expiresAt, true],
    ["support cancellation", "trial_closed", "undeclared", expiresAt, false],
    ["converted trial", "trial_converted", "yes", null, false],
  ] as const)(
    "%s follows the existing state model",
    (_label, status, realDataDeclaration, cleanupEligibleAt, visible) => {
      expect(
        getCommercialTrialDataReviewAvailability(
          { status, realDataDeclaration, expiresAt, cleanupEligibleAt },
          expiresAt + 1,
        ),
      ).toEqual({
        visible,
        canDeclare: false,
        opensAt,
        declarationBlockReason:
          realDataDeclaration === "undeclared"
            ? "cleanup-started"
            : "already-declared",
      });
    },
  );

  it("stops declarations when cleanup becomes eligible", () => {
    const cleanupEligibleAt = expiresAt + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
    const trial = {
      ...pending,
      status: "trial_expired",
      cleanupEligibleAt,
    };
    expect(
      getCommercialTrialDataReviewAvailability(trial, cleanupEligibleAt - 1),
    ).toMatchObject({
      visible: true,
      canDeclare: true,
      declarationBlockReason: null,
    });
    for (const now of [cleanupEligibleAt, cleanupEligibleAt + 1]) {
      expect(getCommercialTrialDataReviewAvailability(trial, now)).toEqual({
        visible: false,
        canDeclare: false,
        opensAt,
        declarationBlockReason: "cleanup-started",
      });
    }
  });

  it.each([
    ["NaN expiry", { expiresAt: Number.NaN }, expiresAt],
    [
      "positive infinite expiry",
      { expiresAt: Number.POSITIVE_INFINITY },
      expiresAt,
    ],
    [
      "negative infinite expiry",
      { expiresAt: Number.NEGATIVE_INFINITY },
      expiresAt,
    ],
    ["zero expiry", { expiresAt: 0 }, expiresAt],
    ["negative expiry", { expiresAt: -1 }, expiresAt],
    ["NaN cleanup", { cleanupEligibleAt: Number.NaN }, expiresAt],
    [
      "positive infinite cleanup",
      { cleanupEligibleAt: Number.POSITIVE_INFINITY },
      expiresAt,
    ],
    ["zero cleanup", { cleanupEligibleAt: 0 }, expiresAt],
    ["negative cleanup", { cleanupEligibleAt: -1 }, expiresAt],
    ["NaN current time", {}, Number.NaN],
    ["positive infinite current time", {}, Number.POSITIVE_INFINITY],
    ["negative infinite current time", {}, Number.NEGATIVE_INFINITY],
    ["zero current time", {}, 0],
    ["negative current time", {}, -1],
  ] as const)("fails closed for %s", (_label, overrides, now) => {
    expect(
      getCommercialTrialDataReviewAvailability(
        { ...pending, ...overrides },
        now,
      ),
    ).toEqual({
      visible: false,
      canDeclare: false,
      opensAt: null,
      declarationBlockReason: "invalid-time",
    });
  });

  it("defines the minimum accepted epoch and avoids timezone parsing", () => {
    expect(COMMERCIAL_TRIAL_MIN_EPOCH_MS).toBe(1);
    expect(
      getCommercialTrialDataReviewAvailability(
        { ...pending, expiresAt: COMMERCIAL_TRIAL_MIN_EPOCH_MS },
        COMMERCIAL_TRIAL_MIN_EPOCH_MS,
      ),
    ).toMatchObject({
      visible: true,
      canDeclare: true,
      declarationBlockReason: null,
    });
    expect(Date.parse("2026-09-30T20:00:00.000+02:00")).toBe(expiresAt);
  });
});

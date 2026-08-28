export const COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS = 2_147_000_000;
export const COMMERCIAL_TRIAL_REFRESH_RETRY_MS = 30_000;

type RefreshCommercialTrial = () => Promise<boolean>;

type CommercialTrialDataReviewRefreshState = {
  opensAt?: number | null;
  serverNow?: number;
  declarationBlockReason?: NonNullable<
    CommercialTrialOverview["dataReview"]
  >["declarationBlockReason"];
};

export function scheduleCommercialTrialDataReviewRefreshIfNeeded(input: {
  dataReview?: CommercialTrialDataReviewRefreshState;
  refresh: RefreshCommercialTrial;
}): (() => void) | undefined {
  if (!input.dataReview) return undefined;
  const { opensAt, serverNow } = input.dataReview;
  if (
    input.dataReview.declarationBlockReason !== "not-open" ||
    typeof opensAt !== "number" ||
    !Number.isFinite(opensAt) ||
    opensAt <= 0 ||
    typeof serverNow !== "number" ||
    !Number.isFinite(serverNow) ||
    serverNow <= 0 ||
    opensAt <= serverNow
  ) {
    return undefined;
  }
  return scheduleCommercialTrialDataReviewRefresh({
    opensAt,
    serverNow,
    refresh: input.refresh,
  });
}

export function scheduleCommercialTrialDataReviewRefresh(input: {
  opensAt: number;
  serverNow: number;
  refresh: RefreshCommercialTrial;
}): () => void {
  let cancelled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (
    !Number.isFinite(input.opensAt) ||
    input.opensAt <= 0 ||
    !Number.isFinite(input.serverNow) ||
    input.serverNow <= 0 ||
    input.opensAt <= input.serverNow
  ) {
    return () => {
      cancelled = true;
    };
  }
  // Preserve the server-reported delta. Transport/render time can make the
  // card open slightly late, but never early because of a skewed client clock.
  let remaining = input.opensAt - input.serverNow;

  const schedule = (delay: number, callback: () => void) => {
    timeout = setTimeout(callback, delay);
  };
  const refresh = async () => {
    const succeeded = await input.refresh().catch(() => false);
    if (!cancelled && !succeeded) {
      schedule(COMMERCIAL_TRIAL_REFRESH_RETRY_MS, () => void refresh());
    }
  };
  const advance = () => {
    if (remaining > COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS) {
      remaining -= COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS;
      schedule(COMMERCIAL_TRIAL_REFRESH_MAX_DELAY_MS, advance);
      return;
    }
    schedule(remaining, () => void refresh());
  };

  advance();
  return () => {
    cancelled = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
import type { CommercialTrialOverview } from "./commercial";

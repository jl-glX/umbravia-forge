import type { TFunction } from "i18next";

type CommercialTrialErrorBody = {
  code?: string;
  retryAfterSeconds?: unknown;
};

export class CommercialTrialRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: unknown,
  ) {
    super(message);
  }
}

export function formatCommercialTrialRequestError(
  cause: unknown,
  t: TFunction,
): string {
  if (cause instanceof CommercialTrialRequestError) {
    if (cause.code === "COMMERCIAL_TRIALS_DISABLED")
      return t("commercial.trial.errors.provisioningDisabled");
    if (cause.code === "COMMERCIAL_TRIAL_EDIT_COOLDOWN") {
      const retryAfterSeconds =
        typeof cause.retryAfterSeconds === "number" &&
        Number.isFinite(cause.retryAfterSeconds) &&
        cause.retryAfterSeconds > 0
          ? cause.retryAfterSeconds
          : 60;
      return t("commercial.trial.errors.editCooldown", {
        count: Math.max(1, Math.ceil(retryAfterSeconds / 60)),
      });
    }
    if (cause.code === "COMMERCIAL_TRIAL_NOT_EDITABLE")
      return t("commercial.trial.errors.notEditable");
    if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_INVALID")
      return t("commercial.trial.errors.subdomainInvalid");
    if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_UNAVAILABLE")
      return t("commercial.trial.errors.subdomainUnavailable");
    if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_LOCKED")
      return t("commercial.trial.errors.subdomainLocked");
    if (cause.code === "COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN")
      return t("commercial.trial.requestFailed");
  }
  return t("commercial.trial.requestFailed");
}

export async function readCommercialTrialResponse<T>(
  response: Response,
): Promise<T> {
  const body = (await response.json()) as T & CommercialTrialErrorBody;
  if (!response.ok) {
    throw new CommercialTrialRequestError(
      "Commercial trial request failed",
      body.code,
      body.retryAfterSeconds,
    );
  }
  return body;
}

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  LockKeyhole,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { authFetch } from "../lib/api";
import { VerifiedForm } from "../components/VerifiedForm";
import { PasswordInput } from "../components/PasswordInput";
import { useAuth } from "../hooks/useAuth";

type DataCategory =
  | "account_profile"
  | "preferences"
  | "bookings"
  | "sessions"
  | "authentication_factors"
  | "delegations"
  | "billing_records"
  | "security_events";

interface DeletionReview {
  accountEmail: string;
  mfaRequired: boolean;
  gracePeriodDays: number;
  deletionRequest: {
    id: string;
    graceEndsAt: number;
  } | null;
  dataDisposition: {
    executionEnabled: boolean;
    categories: Array<{
      dataCategory: DataCategory;
      defaultDisposition:
        | "delete"
        | "delete_or_anonymize"
        | "cancel_future_anonymize_history"
        | "revoke_and_delete"
        | "retain_only_if_policy_applies";
      retentionRequiresReviewedPolicy: boolean;
      reviewState: "policy_review_required" | "draft_policy" | "unclassified";
      retainedRecordCount: number;
    }>;
  };
  deletionDraft: {
    selectedCategories: DataCategory[];
    intent: "selected_data" | "account_closure";
    updatedAt: number;
  } | null;
  legalRetentionNoticeRequired: true;
  closureImpact: {
    reservationsAffected: number;
    activeSessions: number;
    delegationGrantsAffected: number;
    dataExportStatus: "planned";
    executionEnabled: boolean;
  };
}

async function reviewRequest(
  path = "/deletion-review",
  init?: RequestInit,
): Promise<DeletionReview> {
  const response = await authFetch(`/api/account/lifecycle${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as
    DeletionReview | { error?: string; code?: string };
  if (!response.ok) {
    throw new Error(
      "code" in body && body.code
        ? body.code
        : "error" in body && body.error
          ? body.error
          : "REQUEST_FAILED",
    );
  }
  return body as DeletionReview;
}

export function AccountDataDeletionPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [review, setReview] = useState<DeletionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const userFacingError = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : "REQUEST_FAILED";
    if (code === "SECURITY_CONFIRMATION_FAILED") {
      return t("accountDataDeletion.passwordRejected");
    }
    if (code === "MFA_CONFIRMATION_FAILED") {
      return t("accountDataDeletion.totpRejected");
    }
    if (code === "FORM_VERIFICATION_REQUIRED") {
      return t("accountDataDeletion.formVerificationExpired");
    }
    return t("accountDataDeletion.requestFailed");
  };

  const load = useCallback(async () => {
    const result = await reviewRequest();
    setReview(result);
  }, []);

  useEffect(() => {
    load().catch((cause) => setError(userFacingError(cause)));
    // The error mapper depends on the active language; loading again is already
    // handled by the page lifecycle and should not be coupled to translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const saveDraft = async (
    intent: "selected_data" | "account_closure",
    categories: DataCategory[],
  ) => {
    const result = await reviewRequest("/deletion-review", {
      method: "PUT",
      body: JSON.stringify({ selectedCategories: categories, intent }),
    });
    setReview(result);
  };

  const scheduleAccountClosure = async (
    submittedPassword: string,
    submittedTotpCode: string,
  ) => {
    if (!review) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const allCategories = review.dataDisposition.categories.map(
        (category) => category.dataCategory,
      );
      await saveDraft("account_closure", allCategories);
      await reviewRequest("/deletion", {
        method: "POST",
        body: JSON.stringify({
          password: submittedPassword,
          totpCode: review.mfaRequired ? submittedTotpCode : undefined,
        }),
      });
      await load();
      setPassword("");
      setTotpCode("");
      setNotice(t("accountDataDeletion.accountScheduled"));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancelAccountClosure = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await reviewRequest("/deletion", { method: "DELETE" });
      await load();
      setNotice(t("accountDataDeletion.accountCancelled"));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(timestamp);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <Button asChild variant="ghost" className="-ml-3">
          <Link to="/account/lifecycle">
            <ArrowLeft size={17} />
            {t("accountDataDeletion.back")}
          </Link>
        </Button>

        <header className="mt-5">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-red-700">
            {t("accountDataDeletion.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">
            {t("accountDataDeletion.title")}
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            {t("accountDataDeletion.description")}
          </p>
        </header>

        {(error || notice) && (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {error || notice}
          </div>
        )}

        <VerifiedForm
          className="mt-8 space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void scheduleAccountClosure(
              String(form.get("password") ?? ""),
              String(form.get("totpCode") ?? ""),
            );
          }}
        >
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-950">
                  {t("accountDataDeletion.reviewTitle")}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {t("accountDataDeletion.reviewDescription")}
                </p>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                {t("accountDataDeletion.operationalMode")}
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {review?.dataDisposition.categories.map((category) => (
                <div
                  key={category.dataCategory}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <span>
                    <span className="block font-bold text-slate-900">
                      {t(
                        `accountLifecycle.dataCategories.${category.dataCategory}`,
                      )}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-slate-600">
                      {t(
                        `accountLifecycle.dispositions.${category.defaultDisposition}`,
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      {t(
                        `accountLifecycle.reviewStates.${category.reviewState}`,
                      )}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-6 border-amber-200 bg-amber-50 p-6">
            <CircleAlert className="text-amber-700" />
            <h2 className="mt-3 text-lg font-black text-amber-950">
              {t("accountDataDeletion.legalTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-950">
              {t("accountDataDeletion.legalDescription")}
            </p>
            <p className="mt-3 text-xs leading-5 text-amber-800">
              {t("accountDataDeletion.legalPending")}
            </p>
          </Card>

          <Card className="mt-6 p-6">
            <Trash2 className="text-red-700" />
            <h2 className="mt-3 text-xl font-black text-slate-950">
              {t("accountDataDeletion.accountTitle")}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {t("accountDataDeletion.accountDescription", {
                count: review?.gracePeriodDays ?? 30,
              })}
            </p>

            {review && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
                  {t("accountDataDeletion.impactBookings", {
                    count: review.closureImpact.reservationsAffected,
                  })}
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
                  {t("accountDataDeletion.impactSessions", {
                    count: review.closureImpact.activeSessions,
                  })}
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
                  {t("accountDataDeletion.impactDelegations", {
                    count: review.closureImpact.delegationGrantsAffected,
                  })}
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
                  {t("accountDataDeletion.impactDownloads")}
                </div>
              </div>
            )}

            {review?.deletionRequest ? (
              <>
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  {t("accountDataDeletion.pendingUntil", {
                    date: formatDate(review.deletionRequest.graceEndsAt),
                  })}
                </div>
                <Button
                  type="button"
                  className="mt-4"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void cancelAccountClosure()}
                >
                  <RotateCcw size={17} />
                  {t("accountDataDeletion.cancelAccount")}
                </Button>
              </>
            ) : (
              <div className="mt-5 max-w-xl">
                <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                  {t("accountDataDeletion.confirmingAccount", {
                    email: review?.accountEmail ?? user?.email ?? "",
                  })}
                </div>
                <label className="block text-sm font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <LockKeyhole size={17} />
                    {t("accountDataDeletion.passwordConfirmation")}
                  </span>
                  <PasswordInput
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    maxLength={128}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
                  />
                </label>
                {review?.mfaRequired && (
                  <label className="mt-4 block text-sm font-semibold text-slate-800">
                    {t("accountDataDeletion.totpConfirmation")}
                    <input
                      name="totpCode"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={totpCode}
                      onChange={(event) =>
                        setTotpCode(event.target.value.replace(/\D/gu, ""))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono tracking-[0.25em]"
                    />
                  </label>
                )}
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {t("accountDataDeletion.reauthenticationNotice")}
                </p>
                <Button
                  type="submit"
                  className="mt-4"
                  variant="destructive"
                  disabled={busy || !review}
                >
                  <Trash2 size={17} />
                  {t("accountDataDeletion.deleteAccount")}
                </Button>
              </div>
            )}
          </Card>
        </VerifiedForm>
      </div>
    </main>
  );
}

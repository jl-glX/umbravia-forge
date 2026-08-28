import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { authFetch } from "../lib/api";
import { resolveIntlLocale } from "../i18n/supported-locales";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { VerifiedForm } from "../components/VerifiedForm";

interface AccountLifecycle {
  currentState: string;
  inactivityMonths: number | null;
  lastMeaningfulActivityAt: number;
  inactivityReview: {
    status: "none" | "pending";
    stage: "awaiting_usage_confirmation" | "confirm_deletion" | null;
    deliveredAt: number | null;
    responseDueAt: number | null;
  };
}

const inactivityOptions = [6, 12, 18, 24, 36] as const;

async function lifecycleRequest(
  path = "/inactivity",
  init?: RequestInit,
): Promise<AccountLifecycle> {
  const response = await authFetch(`/api/account/lifecycle${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as
    AccountLifecycle | { error?: string; code?: string };
  if (!response.ok) {
    throw new Error(
      "code" in body && body.code
        ? body.code
        : "error" in body && body.error
          ? body.error
          : "REQUEST_FAILED",
    );
  }
  return body as AccountLifecycle;
}

export function AccountLifecyclePage() {
  const { t, i18n } = useTranslation();
  const [lifecycle, setLifecycle] = useState<AccountLifecycle | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState("disabled");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const userFacingError = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : "REQUEST_FAILED";
    if (code === "FORM_VERIFICATION_REQUIRED") {
      return t("accountLifecycle.formVerificationExpired");
    }
    if (code === "INACTIVITY_REVIEW_NOT_PENDING") {
      return t("accountLifecycle.reviewNotPending");
    }
    return t("accountLifecycle.requestFailed");
  };

  const load = useCallback(async () => {
    const result = await lifecycleRequest("");
    setLifecycle(result);
    setSelectedPeriod(
      result.inactivityMonths === null
        ? "disabled"
        : String(result.inactivityMonths),
    );
  }, []);

  useEffect(() => {
    load().catch((cause) => setError(userFacingError(cause)));
    // The error mapper depends on the active language; loading again is already
    // handled by the page lifecycle and should not be coupled to translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const savePreference = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await lifecycleRequest("/inactivity", {
        method: "PUT",
        body: JSON.stringify({
          inactivityMonths:
            selectedPeriod === "disabled" ? null : Number(selectedPeriod),
        }),
      });
      setLifecycle(result);
      setNotice(t("accountLifecycle.preferenceSaved"));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setBusy(false);
    }
  };

  const answerReview = async (
    stage: "usage" | "deletion",
    answer: "yes" | "no",
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await lifecycleRequest("/inactivity-review", {
        method: "POST",
        body: JSON.stringify({ stage, answer }),
      });
      setLifecycle(result);
      setNotice(t("accountLifecycle.reviewAnswerSaved"));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(resolveIntlLocale(i18n.language), {
      dateStyle: "long",
      timeStyle: "short",
    }).format(timestamp);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <header>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">
            {t("accountLifecycle.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950 sm:text-4xl">
            {t("accountLifecycle.title")}
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            {t("accountLifecycle.description")}
          </p>
        </header>

        {lifecycle && (
          <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            {t("accountLifecycle.currentState", {
              state: t(`accountLifecycle.states.${lifecycle.currentState}`),
            })}
          </div>
        )}

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

        {lifecycle?.inactivityReview.status === "pending" && (
          <Card className="mt-6 border-amber-200 bg-amber-50 p-6">
            <CalendarClock className="text-amber-700" />
            <h2 className="mt-3 text-xl font-black text-amber-950">
              {lifecycle.inactivityReview.stage ===
              "awaiting_usage_confirmation"
                ? t("accountLifecycle.usageQuestion")
                : t("accountLifecycle.deletionQuestion")}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-950">
              {lifecycle.inactivityReview.stage ===
              "awaiting_usage_confirmation"
                ? t("accountLifecycle.usageQuestionDescription", {
                    date: lifecycle.inactivityReview.responseDueAt
                      ? formatDate(lifecycle.inactivityReview.responseDueAt)
                      : "",
                  })
                : t("accountLifecycle.deletionQuestionDescription")}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void answerReview(
                    lifecycle.inactivityReview.stage ===
                      "awaiting_usage_confirmation"
                      ? "usage"
                      : "deletion",
                    "yes",
                  )
                }
              >
                {t("accountLifecycle.yes")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void answerReview(
                    lifecycle.inactivityReview.stage ===
                      "awaiting_usage_confirmation"
                      ? "usage"
                      : "deletion",
                    "no",
                  )
                }
              >
                {t("accountLifecycle.no")}
              </Button>
            </div>
          </Card>
        )}

        <VerifiedForm
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            void savePreference();
          }}
        >
          <Card className="p-6">
            <CalendarClock className="text-blue-700" />
            <h2 className="mt-4 text-xl font-black text-slate-950">
              {t("accountLifecycle.inactivityTitle")}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {t("accountLifecycle.inactivityDescription")}
            </p>
            <label className="mt-5 block max-w-xl text-sm font-semibold text-slate-800">
              {t("accountLifecycle.periodLabel")}
              <select
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
              >
                <option value="disabled">
                  {t("accountLifecycle.disabled")}
                </option>
                {inactivityOptions.map((months) => (
                  <option key={months} value={months}>
                    {t("accountLifecycle.months", { count: months })}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              className="mt-4"
              disabled={busy || !lifecycle}
            >
              {t("common.save")}
            </Button>
            {lifecycle && (
              <p className="mt-4 text-xs leading-5 text-slate-500">
                {t("accountLifecycle.lastActivity", {
                  date: formatDate(lifecycle.lastMeaningfulActivityAt),
                })}
              </p>
            )}
          </Card>
        </VerifiedForm>

        <div className="mt-6 flex justify-center">
          <Button
            asChild
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50"
          >
            <Link to="/account/delete-data">
              <Trash2 size={17} />
              {t("accountLifecycle.reviewDeletion")}
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

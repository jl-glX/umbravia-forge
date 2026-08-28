import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import { resolveIntlLocale } from "../i18n/supported-locales";
import { VerifiedForm } from "../components/VerifiedForm";

type RepresentationScope =
  | "cancel_bookings"
  | "stop_subscriptions"
  | "download_authorized_documents"
  | "manage_pending_payments"
  | "contact_support"
  | "request_account_closure";

type RepresentationReason =
  | "hospitalization"
  | "temporary_incapacity"
  | "permanent_incapacity"
  | "death_contingency"
  | "other";

interface Representation {
  id: string;
  supportIdentifier: string;
  scopes: RepresentationScope[];
  reason: RepresentationReason;
  status: "draft" | "pending_review" | "approved" | "revoked" | "expired";
  startsAt: number;
  expiresAt: number | null;
}

interface ContinuityOverview {
  status: "draft_available";
  executionEnabled: false;
  identityTransferAllowed: false;
  scopes: RepresentationScope[];
  reasons: RepresentationReason[];
  representations: Representation[];
  excludedCapabilities: string[];
}

export function AccountContinuityPage() {
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<ContinuityOverview | null>(null);
  const [supportIdentifier, setSupportIdentifier] = useState("");
  const [reason, setReason] = useState<RepresentationReason>("hospitalization");
  const [expiresOn, setExpiresOn] = useState("");
  const [scopes, setScopes] = useState<RepresentationScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(resolveIntlLocale(i18n.language), {
        dateStyle: "medium",
      }),
    [i18n.language],
  );

  const loadOverview = useCallback(async () => {
    const response = await authFetch("/api/account/continuity");
    if (!response.ok) throw new Error(t("accountContinuity.loadError"));
    setOverview((await response.json()) as ContinuityOverview);
  }, [t]);

  useEffect(() => {
    loadOverview().catch(() => setError(t("accountContinuity.loadError")));
  }, [loadOverview, t]);

  function toggleScope(scope: RepresentationScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const response = await authFetch(
        "/api/account/continuity/representations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supportIdentifier,
            scopes,
            reason,
            expiresAt: expiresOn
              ? new Date(`${expiresOn}T23:59:59.999`).getTime()
              : null,
          }),
        },
      );
      if (!response.ok) throw new Error(t("accountContinuity.saveError"));
      setOverview((await response.json()) as ContinuityOverview);
      setSupportIdentifier("");
      setScopes([]);
      setExpiresOn("");
      setMessage(t("accountContinuity.saved"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("accountContinuity.saveError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(representationId: string) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const response = await authFetch(
        `/api/account/continuity/representations/${representationId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(t("accountContinuity.revokeError"));
      setOverview((await response.json()) as ContinuityOverview);
      setMessage(t("accountContinuity.revoked"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("accountContinuity.revokeError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/account"
          className="inline-flex items-center gap-2 font-semibold text-blue-700"
        >
          <ArrowLeft size={18} /> {t("accountContinuity.back")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">
            {t("accountContinuity.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">
            {t("accountContinuity.title")}
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            {t("accountContinuity.description")}
          </p>
        </header>

        <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">{t("accountContinuity.demoTitle")}</p>
              <p className="mt-1 text-sm leading-6">
                {t("accountContinuity.demoDescription")}
              </p>
            </div>
          </div>
        </section>

        <VerifiedForm
          onSubmit={submit}
          className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-2xl font-black text-slate-950">
            {t("accountContinuity.formTitle")}
          </h2>
          <p className="mt-2 text-slate-600">
            {t("accountContinuity.formDescription")}
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="font-semibold text-slate-900">
              {t("accountContinuity.identifierLabel")}
              <input
                required
                maxLength={19}
                pattern="GT-U-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}"
                value={supportIdentifier}
                onChange={(event) =>
                  setSupportIdentifier(event.target.value.toUpperCase())
                }
                placeholder="GT-U-0000-0000-0000"
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono font-normal uppercase"
              />
            </label>
            <label className="font-semibold text-slate-900">
              {t("accountContinuity.reasonLabel")}
              <select
                value={reason}
                onChange={(event) =>
                  setReason(event.target.value as RepresentationReason)
                }
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              >
                {(overview?.reasons ?? []).map((item) => (
                  <option key={item} value={item}>
                    {t(`accountContinuity.reasons.${item}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-semibold text-slate-900">
              {t("accountContinuity.expiryLabel")}
              <input
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>
          </div>

          <fieldset className="mt-6">
            <legend className="font-bold text-slate-950">
              {t("accountContinuity.scopesLabel")}
            </legend>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(overview?.scopes ?? []).map((scope) => (
                <label
                  key={scope}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="mt-1"
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    {t(`accountContinuity.scopes.${scope}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {(error || message) && (
            <div
              className={`mt-5 rounded-2xl p-4 text-sm ${
                error
                  ? "bg-red-50 text-red-800"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {error ?? message}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !overview || scopes.length === 0}
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-blue-700 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : (
              <UserRoundCog size={18} />
            )}
            {t("accountContinuity.saveDraft")}
          </button>
        </VerifiedForm>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black text-slate-950">
            {t("accountContinuity.listTitle")}
          </h2>
          <div className="mt-5 space-y-3">
            {!overview ? (
              <p className="text-slate-600">{t("common.loading")}</p>
            ) : overview.representations.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-5 text-slate-600">
                {t("accountContinuity.empty")}
              </p>
            ) : (
              overview.representations.map((representation) => (
                <article
                  key={representation.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono font-bold text-slate-950">
                        {representation.supportIdentifier}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {t(
                          `accountContinuity.reasons.${representation.reason}`,
                        )}{" "}
                        ·{" "}
                        {t(
                          `accountContinuity.statuses.${representation.status}`,
                        )}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {representation.scopes
                          .map((scope) =>
                            t(`accountContinuity.scopes.${scope}`),
                          )
                          .join(" · ")}
                      </p>
                      {representation.expiresAt && (
                        <p className="mt-2 text-sm text-slate-500">
                          {t("accountContinuity.expires", {
                            date: dateFormatter.format(
                              representation.expiresAt,
                            ),
                          })}
                        </p>
                      )}
                    </div>
                    {["draft", "pending_review", "approved"].includes(
                      representation.status,
                    ) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => revoke(representation.id)}
                        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                      >
                        {t("accountContinuity.revoke")}
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="mt-6 flex items-start gap-3 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
          <CircleAlert className="mt-0.5 shrink-0" size={19} />
          <p>{t("accountContinuity.identityNotice")}</p>
        </section>
      </div>
    </main>
  );
}

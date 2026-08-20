import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { VerifiedForm } from "../components/VerifiedForm";
import { authFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

type PlanKey = "monthly" | "annual";
type SubscriptionStatus =
  | "inactive"
  | "checkout_pending"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "canceled"
  | "incomplete"
  | "incomplete_expired";

interface SubscriptionOverview {
  configured: boolean;
  testMode: boolean;
  plans: Record<PlanKey, boolean>;
  subscription: {
    plan: PlanKey | null;
    status: SubscriptionStatus;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    canOpenPortal: boolean;
  };
  entitlements: {
    enforcementEnabled: boolean;
    source: string;
    capabilities: {
      operationalCore: boolean;
      analytics: boolean;
      crm: boolean;
    };
  };
}

const API_PATH = "/api/commercial-subscription";

export function CommercialSubscriptionPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlanKey | "portal" | null>(null);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authFetch(API_PATH);
      if (!response.ok) throw new Error("overview unavailable");
      setOverview((await response.json()) as SubscriptionOverview);
    } catch {
      setError(t("subscription.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const openStripe = async (path: string, body?: Record<string, string>) => {
    setBusy(
      body?.plan === "annual"
        ? "annual"
        : body?.plan === "monthly"
          ? "monthly"
          : "portal",
    );
    setError("");
    try {
      const response = await authFetch(`${API_PATH}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url) throw new Error(result.error);
      window.location.assign(result.url);
    } catch {
      setError(t("subscription.actionError"));
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6 text-slate-600">
        {t("common.loading")}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 pb-16">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-orange-600">
          {t("subscription.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
          {t("subscription.title")}
        </h1>
        <p className="mt-2 max-w-3xl leading-7 text-slate-600">
          {t("subscription.description")}
        </p>
      </header>

      {searchParams.get("checkout") === "success" && (
        <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="mt-0.5 shrink-0" />
          <p>{t("subscription.checkoutSuccess")}</p>
        </div>
      )}
      {searchParams.get("checkout") === "cancelled" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          {t("subscription.checkoutCancelled")}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      {!overview?.configured ? (
        <Card className="border-amber-200 bg-amber-50 p-6">
          <h2 className="font-bold text-amber-950">
            {t("subscription.notConfiguredTitle")}
          </h2>
          <p className="mt-2 leading-6 text-amber-900">
            {t("subscription.notConfiguredDescription")}
          </p>
        </Card>
      ) : (
        <>
          {overview.testMode && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              {t("subscription.testMode")}
            </div>
          )}

          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  {t("subscription.current")}
                </p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">
                  {t(`subscription.status.${overview.subscription.status}`)}
                </h2>
                {overview.subscription.plan && (
                  <p className="mt-1 text-slate-600">
                    {t(`subscription.plan.${overview.subscription.plan}`)}
                  </p>
                )}
                {overview.subscription.currentPeriodEnd && (
                  <p className="mt-3 text-sm text-slate-600">
                    {overview.subscription.cancelAtPeriodEnd
                      ? t("subscription.endsOn")
                      : t("subscription.renewsOn")}{" "}
                    {new Intl.DateTimeFormat(
                      i18n.resolvedLanguage ?? i18n.language,
                      {
                        dateStyle: "long",
                      },
                    ).format(overview.subscription.currentPeriodEnd)}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={() => void loadOverview()}>
                <RefreshCw /> {t("common.refresh")}
              </Button>
            </div>
            {overview.subscription.canOpenPortal && (
              <VerifiedForm className="mt-5">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void openStripe("portal")}
                >
                  <ExternalLink />
                  {busy === "portal"
                    ? t("subscription.opening")
                    : t("subscription.manage")}
                </Button>
              </VerifiedForm>
            )}
          </Card>

          {!["active", "trialing"].includes(overview.subscription.status) && (
            <section>
              <h2 className="text-xl font-black text-slate-950">
                {t("subscription.choosePlan")}
              </h2>
              <p className="mt-1 text-slate-600">
                {t("subscription.priceNotice")}
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {(["monthly", "annual"] as const).map((plan) => (
                  <Card key={plan} className="p-6">
                    <CreditCard className="text-orange-500" />
                    <h3 className="mt-4 text-xl font-black">
                      {t(`subscription.plan.${plan}`)}
                    </h3>
                    <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">
                      {t(`subscription.planDescription.${plan}`)}
                    </p>
                    <VerifiedForm className="mt-5">
                      <Button
                        type="button"
                        disabled={!overview.plans[plan] || busy !== null}
                        onClick={() => void openStripe("checkout", { plan })}
                      >
                        {busy === plan
                          ? t("subscription.opening")
                          : t("subscription.continueToCheckout")}
                      </Button>
                    </VerifiedForm>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

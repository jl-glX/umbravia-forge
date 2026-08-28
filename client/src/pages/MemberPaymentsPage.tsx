import { useCallback, useEffect, useState } from "react";
import { CreditCard, ReceiptText, ShoppingBag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import { localizedApiErrorMessage } from "../lib/api-error";
import { resolveIntlLocale } from "../i18n/supported-locales";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface MemberPaymentSummary {
  id: string;
  concept: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: number | null;
  paidAt: number | null;
  invoiceNumber: string;
}

interface CommerceSummary {
  payments: MemberPaymentSummary[];
  orders: unknown[];
  capabilities: {
    payments: boolean;
    manualRecords: boolean;
    orders: boolean;
    bankPayments: boolean;
  };
}

export function MemberPaymentsPage() {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<CommerceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(
        `${API_BASE}/api/member-commerce/summary`,
      );
      if (!response.ok) {
        throw new Error(
          await localizedApiErrorMessage(
            response,
            t("memberCommerce.loadFailed"),
            (key) => t(key),
          ),
        );
      }
      const body = (await response.json()) as CommerceSummary;
      setSummary(body);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("memberCommerce.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const formatAmount = (record: MemberPaymentSummary) =>
    new Intl.NumberFormat(resolveIntlLocale(i18n.language), {
      style: "currency",
      currency: record.currency,
    }).format(record.amountCents / 100);

  const pay = async (paymentId: string) => {
    setPayingId(paymentId);
    try {
      const response = await authFetch(
        `${API_BASE}/api/member-commerce/payments/${paymentId}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) {
        throw new Error(
          await localizedApiErrorMessage(
            response,
            t("memberCommerce.checkoutFailed"),
            (key) => t(key),
          ),
        );
      }
      const body = (await response.json()) as { url: string };
      window.location.assign(body.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("memberCommerce.checkoutFailed"),
      );
      setPayingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-10 sm:px-6 2xl:px-8">
        <header className="mb-8 max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.2em] text-blue-600">
            {t("memberCommerce.eyebrow")}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">
            {t("memberCommerce.title")}
          </h1>
          <p className="mt-3 text-lg leading-8 text-slate-600">
            {t("memberCommerce.description")}
          </p>
        </header>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CreditCard size={24} />
            </div>
            <h2 className="mt-5 text-xl font-bold text-slate-950">
              {t("memberCommerce.paymentsTitle")}
            </h2>
            <p className="mt-2 leading-7 text-slate-600">
              {t("memberCommerce.paymentsDescription")}
            </p>
            <div className="mt-6 space-y-3">
              {loading ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  {t("common.loading")}
                </div>
              ) : summary?.payments.length ? (
                summary.payments.map((payment) => (
                  <article
                    key={payment.id}
                    className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {payment.concept}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {t(`billing.status.${payment.status}`)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold text-slate-950">
                        {formatAmount(payment)}
                      </p>
                      {payment.status !== "paid" &&
                        summary.capabilities.payments && (
                          <button
                            type="button"
                            className="mt-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            disabled={payingId === payment.id}
                            onClick={() => void pay(payment.id)}
                          >
                            {payingId === payment.id
                              ? t("memberCommerce.openingCheckout")
                              : t("memberCommerce.payWithStripe")}
                          </button>
                        )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  {t("memberCommerce.notAvailable")}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <ShoppingBag size={24} />
            </div>
            <h2 className="mt-5 text-xl font-bold text-slate-950">
              {t("memberCommerce.ordersTitle")}
            </h2>
            <p className="mt-2 leading-7 text-slate-600">
              {t("memberCommerce.ordersDescription")}
            </p>
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              {summary?.capabilities.orders && summary.orders.length
                ? t("memberCommerce.ordersAvailable")
                : t("memberCommerce.ordersUnavailable")}
            </div>
          </section>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          <ReceiptText className="mt-0.5 shrink-0" size={20} />
          <p>{t("memberCommerce.secureNotice")}</p>
        </div>
      </div>
    </main>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { VerifiedForm } from "../components/VerifiedForm";
import { BillingInvoice } from "../components/BillingInvoice";
import {
  formatBillingDate,
  getDeviceTimeZone,
  type BillingCycle,
  type BillingRecord,
  type BillingStatus,
} from "../lib/billing";
import { authFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ConfirmDialog } from "../components/ui/confirm-dialog";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const CURRENCY_KEY = "umbravia-forge-billing-currency";
type RecordFilter = "active" | "archived" | "all";
const billingCurrencies = [
  "EUR",
  "CHF",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "PEN",
  "UYU",
  "DOP",
  "CRC",
  "GTQ",
] as const;
type BillingCurrency = (typeof billingCurrencies)[number];

function readSavedCurrency(): BillingCurrency {
  const saved = localStorage.getItem(CURRENCY_KEY);
  return billingCurrencies.includes(saved as BillingCurrency)
    ? (saved as BillingCurrency)
    : "EUR";
}

function createEmptyForm(currency: BillingCurrency) {
  return {
    userId: null as string | null,
    customerName: "",
    customerEmail: "",
    concept: "",
    billingCycle: "monthly" as BillingCycle,
    customCycleLabel: "",
    amount: "",
    currency,
    status: "pending" as BillingStatus,
    dueDate: "",
    invoiceNumber: "",
    notes: "",
  };
}

interface BillingMemberResult {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  publicId: string | null;
}

interface StripeConnectOverview {
  configured: boolean;
  mode: "disabled" | "sandbox" | "live";
  testMode: boolean;
  canManage: boolean;
  account: null | {
    status: "onboarding_required" | "restricted" | "ready";
    cardPaymentsStatus: string;
    sepaDebitPaymentsStatus: string;
    payoutsStatus: string;
    requirementsStatus: string;
    lastReconciledAt: number | null;
  };
}

export function BillingPage() {
  const { t, i18n } = useTranslation();
  const editingLanguage = i18n.resolvedLanguage ?? i18n.language;
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => createEmptyForm(readSavedCurrency()));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printRecord, setPrintRecord] = useState<BillingRecord | null>(null);
  const [recordFilter, setRecordFilter] = useState<RecordFilter>("active");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<BillingMemberResult[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [deleteRecord, setDeleteRecord] = useState<BillingRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const [connect, setConnect] = useState<StripeConnectOverview | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const timeZone = useMemo(getDeviceTimeZone, []);

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await authFetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok)
      throw new Error(body?.error ?? t("billing.requestFailed"));
    return body as T;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [billingRecords, connectOverview] = await Promise.all([
        request<BillingRecord[]>("/api/billing"),
        request<StripeConnectOverview>("/api/stripe-connect"),
      ]);
      setRecords(billingRecords);
      setConnect(connectOverview);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    // request only depends on the current language error text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flow = new URLSearchParams(window.location.search).get(
      "stripe-connect",
    );
    if (flow === "return") void load();
  }, [load]);

  useEffect(() => {
    const clearPrintRecord = () => setPrintRecord(null);
    window.addEventListener("afterprint", clearPrintRecord);
    return () => window.removeEventListener("afterprint", clearPrintRecord);
  }, []);

  const activeRecords = useMemo(
    () => records.filter((record) => record.archivedAt == null),
    [records],
  );
  const visibleRecords = useMemo(
    () =>
      records.filter((record) => {
        if (recordFilter === "active") return record.archivedAt == null;
        if (recordFilter === "archived") return record.archivedAt != null;
        return true;
      }),
    [recordFilter, records],
  );
  const summary = useMemo(
    () => ({
      paid: activeRecords.filter((record) => record.status === "paid").length,
      unpaid: activeRecords.filter((record) => record.status === "unpaid")
        .length,
      pending: activeRecords.filter((record) => record.status === "pending")
        .length,
      trial: activeRecords.filter(
        (record) => record.billingCycle === "trial_day",
      ).length,
      archived: records.filter((record) => record.archivedAt != null).length,
    }),
    [activeRecords, records],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await request<BillingRecord>("/api/billing", {
        method: "POST",
        body: JSON.stringify({
          userId: form.userId,
          customerName: form.customerName,
          customerEmail: form.customerEmail,
          concept: form.concept,
          billingCycle: form.billingCycle,
          customCycleLabel:
            form.billingCycle === "custom" ? form.customCycleLabel : "",
          amountCents: Math.round(Number(form.amount) * 100),
          currency: form.currency,
          status: form.status,
          dueAt: form.dueDate
            ? new Date(`${form.dueDate}T12:00:00`).getTime()
            : null,
          paidAt: null,
          invoiceNumber: form.invoiceNumber || null,
          notes: form.notes,
        }),
      });
      setRecords((current) => [created, ...current]);
      setForm(createEmptyForm(form.currency));
      setMemberQuery("");
      setMemberResults([]);
      setRecordFilter("active");
      setExpandedId(created.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const searchMembers = async () => {
    if (memberQuery.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    setMemberSearching(true);
    try {
      setMemberResults(
        await request<BillingMemberResult[]>(
          `/api/billing/members?query=${encodeURIComponent(memberQuery.trim())}`,
        ),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMemberSearching(false);
    }
  };

  const selectMember = (member: BillingMemberResult) => {
    setForm((current) => ({
      ...current,
      userId: member.id,
      customerName: member.name,
      customerEmail: member.email,
    }));
    setMemberQuery(member.name);
    setMemberResults([]);
  };

  const update = async (id: string, values: Partial<BillingRecord>) => {
    try {
      const updated = await request<BillingRecord>(`/api/billing/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setRecords((current) =>
        current.map((record) => (record.id === id ? updated : record)),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (record: BillingRecord) => {
    setDeletingRecord(true);
    try {
      await request<void>(`/api/billing/${record.id}`, { method: "DELETE" });
      setRecords((current) =>
        current.filter((currentRecord) => currentRecord.id !== record.id),
      );
      setExpandedId((current) => (current === record.id ? null : current));
      setError("");
      setDeleteRecord(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingRecord(false);
    }
  };

  const money = (record: BillingRecord) =>
    new Intl.NumberFormat(editingLanguage, {
      style: "currency",
      currency: record.currency,
    }).format(record.amountCents / 100);

  const cycle = (record: BillingRecord) =>
    record.billingCycle === "custom" && record.customCycleLabel
      ? record.customCycleLabel
      : t(`billing.cycles.${record.billingCycle}`);

  const changeCurrency = (value: BillingCurrency) => {
    localStorage.setItem(CURRENCY_KEY, value);
    setForm((current) => ({ ...current, currency: value }));
  };

  const openPrintDialog = (record: BillingRecord) => {
    setPrintRecord(record);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const connectAction = async (
    action: "account" | "onboarding" | "reconcile",
  ) => {
    setConnectBusy(true);
    try {
      const result = await request<StripeConnectOverview | { url: string }>(
        `/api/stripe-connect/${action}`,
        { method: "POST", body: "{}" },
      );
      if ("url" in result) {
        window.location.assign(result.url);
        return;
      }
      setConnect(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectBusy(false);
    }
  };

  return (
    <>
      <main className="min-h-screen bg-slate-50 px-4 py-8 print:hidden sm:px-6">
        <div className="mx-auto max-w-[96rem]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
                {t("billing.eyebrow")}
              </p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">
                {t("billing.title")}
              </h1>
              <p className="mt-2 max-w-3xl text-slate-600">
                {t("billing.description")}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("billing.timeZone.label")}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {timeZone}
                </p>
                <p className="mt-1 max-w-72 text-xs text-slate-500">
                  {t("billing.timeZone.hint")}
                </p>
              </div>
              <Button variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className={loading ? "animate-spin" : ""} />
                {t("common.refresh")}
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {connect && (
            <Card className="mt-6 rounded-3xl border-blue-200 p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                    <ShieldCheck />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-950">
                        {t("billing.connect.title")}
                      </h2>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {t(`billing.connect.mode.${connect.mode}`)}
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      {t("billing.connect.description")}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      {connect.account
                        ? t(`billing.connect.status.${connect.account.status}`)
                        : connect.configured
                          ? t("billing.connect.status.notCreated")
                          : t("billing.connect.status.disabled")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("billing.connect.feeNotice")}
                    </p>
                  </div>
                </div>
                {connect.canManage && connect.configured && (
                  <VerifiedForm
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connectAction(
                        !connect.account
                          ? "account"
                          : connect.account.status === "ready"
                            ? "reconcile"
                            : "onboarding",
                      );
                    }}
                  >
                    <Button type="submit" disabled={connectBusy}>
                      {connect.account?.status === "ready" ? (
                        <RefreshCw
                          className={connectBusy ? "animate-spin" : ""}
                        />
                      ) : (
                        <ExternalLink />
                      )}
                      {!connect.account
                        ? t("billing.connect.create")
                        : connect.account.status === "ready"
                          ? t("billing.connect.reconcile")
                          : t("billing.connect.continue")}
                    </Button>
                  </VerifiedForm>
                )}
              </div>
            </Card>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {(["paid", "unpaid", "pending", "trial", "archived"] as const).map(
              (key) => (
                <Card
                  key={key}
                  className="rounded-2xl border-slate-200 p-5 shadow-sm"
                >
                  <p className="text-sm font-medium text-slate-600">
                    {t(`billing.summary.${key}`)}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {summary[key]}
                  </p>
                </Card>
              ),
            )}
          </div>

          <Card className="mt-6 rounded-3xl border-slate-200 p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Plus className="text-blue-600" /> {t("billing.newRecord")}
            </h2>
            <VerifiedForm
              onSubmit={submit}
              lang={editingLanguage}
              spellCheck
              className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4"
            >
              <div className="relative md:col-span-2 lg:col-span-4">
                <Label htmlFor="billing-member-search">
                  {t("billing.memberSearch")}
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="billing-member-search"
                    value={memberQuery}
                    maxLength={120}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchMembers();
                      }
                    }}
                    placeholder={t("billing.memberSearchPlaceholder")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void searchMembers()}
                    disabled={memberSearching || memberQuery.trim().length < 2}
                  >
                    <Search /> {t("billing.search")}
                  </Button>
                </div>
                {form.userId && (
                  <p className="mt-2 text-sm font-medium text-emerald-700">
                    {t("billing.memberLinked", { name: form.customerName })}
                  </p>
                )}
                {memberResults.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    {memberResults.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => selectMember(member)}
                        className="flex w-full items-start justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span>
                          <span className="block font-semibold text-slate-900">
                            {member.name}
                          </span>
                          <span className="block text-sm text-slate-600">
                            {member.email}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {member.publicId ?? member.id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Field label={t("billing.customer")}>
                <Input
                  required
                  maxLength={120}
                  value={form.customerName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      userId: null,
                      customerName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("common.email")}>
                <Input
                  type="email"
                  maxLength={254}
                  value={form.customerEmail}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      userId: null,
                      customerEmail: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("billing.concept")}>
                <Input
                  required
                  maxLength={160}
                  value={form.concept}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      concept: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("billing.amount")}>
                <Input
                  required
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("billing.currencyLabel")}>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={form.currency}
                  onChange={(event) =>
                    changeCurrency(event.target.value as BillingCurrency)
                  }
                >
                  {billingCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {t(`billing.currencies.${currency}`)} ({currency})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("billing.cycleLabel")}>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={form.billingCycle}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      billingCycle: event.target.value as BillingCycle,
                    }))
                  }
                >
                  {(
                    [
                      "monthly",
                      "quarterly",
                      "semiannual",
                      "annual",
                      "trial_day",
                      "custom",
                    ] as const
                  ).map((billingCycle) => (
                    <option key={billingCycle} value={billingCycle}>
                      {t(`billing.cycles.${billingCycle}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {form.billingCycle === "custom" && (
                <Field label={t("billing.customCycleLabel")}>
                  <Input
                    required
                    maxLength={160}
                    value={form.customCycleLabel}
                    placeholder={t("billing.customCyclePlaceholder")}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        customCycleLabel: event.target.value,
                      }))
                    }
                  />
                </Field>
              )}
              <Field label={t("billing.statusLabel")}>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as BillingStatus,
                    }))
                  }
                >
                  {(["paid", "unpaid", "pending"] as const).map((status) => (
                    <option key={status} value={status}>
                      {t(`billing.status.${status}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("billing.dueDate")}>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("billing.invoiceNumber")}>
                <Input
                  value={form.invoiceNumber}
                  maxLength={80}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      invoiceNumber: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="md:col-span-2 lg:col-span-3">
                <Field label={t("billing.notes")}>
                  <textarea
                    lang={editingLanguage}
                    spellCheck
                    className="min-h-24 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100"
                    value={form.notes}
                    maxLength={1000}
                    placeholder={t("billing.notesPlaceholder")}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Button type="submit" className="self-end">
                <CreditCard /> {t("billing.add")}
              </Button>
            </VerifiedForm>
          </Card>

          <Card className="mt-6 overflow-hidden rounded-3xl border-slate-200 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-slate-950">
                  {t("billing.recordsTitle")}
                </h2>
                <p className="text-sm text-slate-500">
                  {t("billing.recordsDescription")}
                </p>
              </div>
              <select
                aria-label={t("billing.recordsDescription")}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={recordFilter}
                onChange={(event) =>
                  setRecordFilter(event.target.value as RecordFilter)
                }
              >
                {(["active", "archived", "all"] as const).map((filter) => (
                  <option key={filter} value={filter}>
                    {t(`billing.filters.${filter}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    {(
                      [
                        "customer",
                        "concept",
                        "cycleLabel",
                        "amount",
                        "statusLabel",
                        "dueDate",
                        "invoiceNumber",
                        "actions",
                      ] as const
                    ).map((key) => (
                      <th key={key} className="px-4 py-3">
                        {t(`billing.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visibleRecords.map((record) => (
                    <Fragment key={record.id}>
                      <tr
                        className={
                          record.archivedAt
                            ? "bg-amber-50/50 text-slate-600"
                            : "hover:bg-slate-50"
                        }
                      >
                        <td className="px-4 py-3">
                          <strong className="block">
                            {record.customerName}
                          </strong>
                          <span className="text-xs text-slate-500">
                            {record.customerEmail}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block">{record.concept}</span>
                          {record.notes && (
                            <span className="mt-1 block max-w-56 truncate text-xs text-slate-500">
                              {record.notes}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">{cycle(record)}</td>
                        <td className="px-4 py-3 font-semibold">
                          {money(record)}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={t("billing.statusLabel")}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                            value={record.status}
                            disabled={record.archivedAt != null}
                            onChange={(event) =>
                              void update(record.id, {
                                status: event.target.value as BillingStatus,
                              })
                            }
                          >
                            {(["paid", "unpaid", "pending"] as const).map(
                              (status) => (
                                <option key={status} value={status}>
                                  {t(`billing.status.${status}`)}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {formatBillingDate(
                            record.dueAt,
                            editingLanguage,
                            timeZone,
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {record.invoiceNumber ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("billing.viewDetail")}
                              aria-expanded={expandedId === record.id}
                              onClick={() =>
                                setExpandedId((current) =>
                                  current === record.id ? null : record.id,
                                )
                              }
                            >
                              {expandedId === record.id ? (
                                <ChevronUp />
                              ) : (
                                <ChevronDown />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={
                                record.archivedAt
                                  ? t("billing.restore")
                                  : t("billing.archive")
                              }
                              onClick={() =>
                                void update(record.id, {
                                  archivedAt: record.archivedAt
                                    ? null
                                    : Date.now(),
                                })
                              }
                            >
                              {record.archivedAt ? (
                                <ArchiveRestore className="text-emerald-600" />
                              ) : (
                                <Archive className="text-amber-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("billing.delete")}
                              onClick={() => setDeleteRecord(record)}
                            >
                              <Trash2 className="text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === record.id && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 p-4 sm:p-6">
                            <BillingInvoice
                              record={record}
                              timeZone={timeZone}
                              onPrint={() => openPrintDialog(record)}
                              onSavePdf={() => openPrintDialog(record)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {!loading && visibleRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-slate-500"
                      >
                        {recordFilter === "archived"
                          ? t("billing.noArchived")
                          : t("billing.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
      <ConfirmDialog
        open={Boolean(deleteRecord)}
        title={t("billing.deleteTitle")}
        description={t("billing.deleteConfirm")}
        confirmLabel={deletingRecord ? t("common.loading") : t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={deletingRecord}
        onCancel={() => setDeleteRecord(null)}
        onConfirm={() => {
          if (deleteRecord) void remove(deleteRecord);
        }}
      />

      {printRecord && (
        <div className="hidden print:block">
          <BillingInvoice record={printRecord} timeZone={timeZone} printable />
        </div>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="block space-y-2">
      <span className="block">{label}</span>
      {children}
    </Label>
  );
}

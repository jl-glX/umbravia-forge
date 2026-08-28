import { Building2, FileDown, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBillingDate, type BillingRecord } from "../lib/billing";
import { Button } from "./ui/button";
import { useFacilityProfile } from "../hooks/useFacilityProfile";
import { resolveIntlLocale } from "../i18n/supported-locales";

export function BillingInvoice({
  record,
  timeZone,
  printable = false,
  onPrint,
  onSavePdf,
}: {
  record: BillingRecord;
  timeZone: string;
  printable?: boolean;
  onPrint?: () => void;
  onSavePdf?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = resolveIntlLocale(i18n.resolvedLanguage ?? i18n.language);
  const { profile } = useFacilityProfile();
  const gymName = profile.name;
  const money = new Intl.NumberFormat(language, {
    style: "currency",
    currency: record.currency,
  }).format(record.amountCents / 100);
  const cycle =
    record.billingCycle === "custom" && record.customCycleLabel
      ? record.customCycleLabel
      : t(`billing.cycles.${record.billingCycle}`);

  return (
    <article
      className={
        printable
          ? "invoice-print-sheet bg-white p-10 text-slate-950"
          : "rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
      }
    >
      <header className="flex flex-col gap-5 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          {profile.logoDataUrl ? (
            <img
              src={profile.logoDataUrl}
              alt={t("billing.gymLogoAlt", { gym: gymName })}
              className="h-14 w-14 rounded-xl object-contain"
            />
          ) : (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: profile.accentColor }}
            >
              <Building2 className="h-7 w-7" />
            </div>
          )}
          <div>
            <p className="text-lg font-bold">{gymName}</p>
            <p className="text-sm text-slate-500">
              {t("billing.facilityIdentity")}
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
            {t("billing.invoiceDetail")}
          </p>
          <p className="mt-1 text-2xl font-bold">
            {record.invoiceNumber || t("billing.noInvoiceNumber")}
          </p>
          {record.archivedAt && (
            <span className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {t("billing.archived")}
            </span>
          )}
        </div>
      </header>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <InvoiceValue
          label={t("billing.customer")}
          value={record.customerName}
        />
        <InvoiceValue
          label={t("common.email")}
          value={record.customerEmail || "—"}
        />
        <InvoiceValue label={t("billing.concept")} value={record.concept} />
        <InvoiceValue label={t("billing.amount")} value={money} emphasize />
        <InvoiceValue label={t("billing.cycleLabel")} value={cycle} />
        <InvoiceValue
          label={t("billing.statusLabel")}
          value={t(`billing.status.${record.status}`)}
        />
        <InvoiceValue
          label={t("billing.issueDate")}
          value={formatBillingDate(record.createdAt, language, timeZone)}
        />
        <InvoiceValue
          label={t("billing.dueDate")}
          value={formatBillingDate(record.dueAt, language, timeZone)}
        />
      </div>

      <section className="mt-5 rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-900">{t("billing.notes")}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
          {record.notes || t("billing.noNotes")}
        </p>
      </section>

      {!profile.logoDataUrl && (
        <p className="mt-4 text-xs text-slate-500">
          {t("billing.logoConfigurationHint")}
        </p>
      )}

      {!printable && (
        <footer className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
          <Button type="button" variant="outline" onClick={onPrint}>
            <Printer /> {t("billing.print")}
          </Button>
          <Button type="button" variant="outline" onClick={onSavePdf}>
            <FileDown /> {t("billing.savePdf")}
          </Button>
          <p className="w-full text-xs text-slate-500">
            {t("billing.pdfHint")}
          </p>
        </footer>
      )}
    </article>
  );
}

function InvoiceValue({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={emphasize ? "mt-1 text-xl font-bold" : "mt-1 font-medium"}>
        {value}
      </p>
    </div>
  );
}

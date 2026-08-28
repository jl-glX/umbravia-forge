import { resolveIntlLocale } from "../i18n/supported-locales";

export type BillingStatus = "paid" | "unpaid" | "pending";
export type BillingCycle =
  "monthly" | "quarterly" | "semiannual" | "annual" | "trial_day" | "custom";

export interface BillingRecord {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  concept: string;
  billingCycle: BillingCycle;
  customCycleLabel: string;
  amountCents: number;
  currency: string;
  status: BillingStatus;
  dueAt: number | null;
  paidAt: number | null;
  invoiceNumber: string | null;
  notes: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function formatBillingDate(
  timestamp: number | null,
  language: string,
  timeZone = getDeviceTimeZone(),
) {
  if (timestamp == null) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(resolveIntlLocale(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

export function getDeviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

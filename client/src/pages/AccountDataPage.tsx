import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  FileText,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchSupportContacts, type SupportContacts } from "../lib/support";

const fallbackContacts: SupportContacts = {
  helpdeskPortalEnabled: true,
  helpdeskPortalUrl: "https://support.umbraviaforge.com",
  helpdeskEmail: "umbravia-forge-scrf@support.openhelpdesk.dev",
  generalFallbackEmail: "umbraviaforge@gmail.com",
  legalRightsEmail: "umbraviaforge@gmail.com",
  internalTicketingEnabled: false,
};

export function AccountDataPage() {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState(fallbackContacts);

  useEffect(() => {
    void fetchSupportContacts()
      .then(setContacts)
      .catch(() => undefined);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/account/preferences"
          className="inline-flex items-center gap-2 font-semibold text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {t("accountData.back")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
            {t("accountData.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">
            {t("accountData.title")}
          </h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            {t("accountData.description")}
          </p>
        </header>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
              <FileText aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-xl font-bold">
              {t("accountData.policyTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t("accountData.policyDescription")}
            </p>
            <Link
              to="/privacy"
              className="mt-5 inline-flex rounded-xl border border-slate-300 px-4 py-2.5 font-semibold hover:bg-slate-50"
            >
              {t("accountData.openPolicy")}
            </Link>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <ShieldCheck aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-xl font-bold">
              {t("accountData.rightsTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t("accountData.rightsDescription")}
            </p>
            <a
              href={`mailto:${contacts.legalRightsEmail}`}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800"
            >
              <Mail size={17} aria-hidden="true" />
              {t("accountData.contactRights")}
            </a>
            <p className="mt-3 break-all text-xs text-slate-500">
              {contacts.legalRightsEmail}
            </p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
              <Download aria-hidden="true" />
            </span>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">
                {t("accountData.exportTitle")}
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {t("accountData.planned")}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t("accountData.exportDescription")}
            </p>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-red-700">
                <Trash2 aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  {t("accountData.closureTitle")}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
                  {t("accountData.closureDescription")}
                </p>
              </div>
            </div>
            <Link
              to="/account/delete-data"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 font-semibold text-red-800 hover:bg-red-100"
            >
              <Trash2 size={17} aria-hidden="true" />
              {t("accountData.reviewClosure")}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

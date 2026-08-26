import { useEffect, useState } from "react";
import { ExternalLink, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
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

export function SupportPage() {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState(fallbackContacts);

  useEffect(() => {
    void fetchSupportContacts()
      .then(setContacts)
      .catch(() => undefined);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-10">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600">
              <LifeBuoy aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
                {t("support.external.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">
                {t("support.external.title")}
              </h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                {t("support.external.description")}
              </p>
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <LifeBuoy className="text-blue-600" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold">
              {t("support.external.ticketTitle")}
            </h2>
            <p className="mt-2 text-slate-600">
              {t("support.external.ticketDescription")}
            </p>
            {contacts.helpdeskPortalEnabled ? (
              <a
                href={contacts.helpdeskPortalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
              >
                <ExternalLink size={18} aria-hidden="true" />
                {t("support.external.openPortal")}
              </a>
            ) : (
              <p className="mt-6 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                {t("support.external.portalUnavailable")}
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <Mail className="text-blue-600" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold">
              {t("support.external.generalTitle")}
            </h2>
            <p className="mt-2 text-slate-600">
              {t("support.external.generalDescription")}
            </p>
            <a
              href={`mailto:${contacts.generalFallbackEmail}`}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Mail size={18} aria-hidden="true" />
              {t("support.external.writeGeneral", {
                email: contacts.generalFallbackEmail,
              })}
            </a>
          </section>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm sm:p-8">
            <ShieldCheck className="text-amber-700" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold">
              {t("support.external.rightsTitle")}
            </h2>
            <p className="mt-2 text-slate-700">
              {t("support.external.rightsDescription")}
            </p>
            <a
              href={`mailto:${contacts.legalRightsEmail}`}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white hover:bg-slate-800"
            >
              <Mail size={18} aria-hidden="true" />
              {t("support.external.writeRights", {
                email: contacts.legalRightsEmail,
              })}
            </a>
          </section>
        </div>

        <aside className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-950">
          <p className="font-semibold">
            {t("support.external.migrationNotice")}
          </p>
          <p className="mt-1">{t("support.external.safetyNotice")}</p>
        </aside>
      </div>
    </main>
  );
}

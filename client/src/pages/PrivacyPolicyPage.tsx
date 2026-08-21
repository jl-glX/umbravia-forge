import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandLockup } from "../components/BrandLockup";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { LegalFooter } from "../components/LegalFooter";

const sections = [
  "controller",
  "roles",
  "data",
  "purposes",
  "sources",
  "recipients",
  "transfers",
  "retention",
  "rights",
  "minors",
  "security",
  "cookies",
  "changes",
] as const;

export function PrivacyPolicyPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/">
            <BrandLockup className="h-14 w-auto max-w-64" />
          </Link>
          <LanguageSwitcher compact />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-500"
          to="/"
        >
          <ArrowLeft size={16} /> {t("legal.back")}
        </Link>
        <article className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <ShieldCheck size={24} />
          </div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
            {t("privacyPolicy.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("privacyPolicy.title")}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            {t("privacyPolicy.updated")}
          </p>
          <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            <strong>{t("privacyPolicy.pendingTitle")}</strong>{" "}
            {t("privacyPolicy.pendingBody")}
          </div>
          <p className="mt-8 whitespace-pre-line leading-7 text-slate-700">
            {t("privacyPolicy.introduction")}
          </p>
          <div className="mt-10 space-y-9">
            {sections.map((section) => (
              <section key={section}>
                <h2 className="text-xl font-semibold text-slate-950">
                  {t(`privacyPolicy.sections.${section}.title`)}
                </h2>
                <p className="mt-3 whitespace-pre-line leading-7 text-slate-700">
                  {t(`privacyPolicy.sections.${section}.body`)}
                </p>
              </section>
            ))}
          </div>
          <section className="mt-10 border-t border-slate-200 pt-8">
            <h2 className="text-xl font-semibold">
              {t("privacyPolicy.officialSources")}
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-blue-700">
              <li>
                <a
                  className="hover:underline"
                  href="https://eur-lex.europa.eu/eli/reg/2016/679/oj"
                  target="_blank"
                  rel="noreferrer"
                >
                  RGPD — EUR-Lex
                </a>
              </li>
              <li>
                <a
                  className="hover:underline"
                  href="https://www.boe.es/eli/es/lo/2018/12/05/3/con"
                  target="_blank"
                  rel="noreferrer"
                >
                  LOPDGDD — BOE
                </a>
              </li>
              <li>
                <a
                  className="hover:underline"
                  href="https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("privacyPolicy.aepdInformation")}
                </a>
              </li>
            </ul>
          </section>
        </article>
      </main>
      <LegalFooter variant="light" />
    </div>
  );
}

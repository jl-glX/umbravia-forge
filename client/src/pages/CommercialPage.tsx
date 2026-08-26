import { ArrowRight, Blocks, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { BrandLockup } from "../components/BrandLockup";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useAuth } from "../hooks/useAuth";
import { getAccessRole } from "../context/auth-context";
import { CommercialArticle } from "../components/CommercialArticle";
import commercialSpanishMarkdown from "../content/commercial.es.md?raw";

export function CommercialPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const accessRole = getAccessRole(user);
  const primaryTarget = user
    ? accessRole === "admin"
      ? "/admin/commercial-trial"
      : "/"
    : "/signup";
  const primaryLabel = user
    ? accessRole === "admin"
      ? t("commercial.public.openEnvironment")
      : t("commercial.public.returnHome")
    : t("commercial.public.explore");
  const highlights = [
    {
      Icon: Blocks,
      key: "modular",
      cardClassName: "border-brand-night bg-brand-night",
      iconClassName: "bg-white/10 text-brand-ember",
      accentClassName: "bg-brand-ember",
      titleClassName: "text-white",
      textClassName: "text-slate-300",
    },
    {
      Icon: Sparkles,
      key: "editable",
      cardClassName: "border-brand-slate bg-brand-slate",
      iconClassName: "bg-white/10 text-white",
      accentClassName: "bg-brand-steel",
      titleClassName: "text-white",
      textClassName: "text-slate-200",
    },
    {
      Icon: ShieldCheck,
      key: "respectful",
      cardClassName: "border-white/80 bg-white/90",
      iconClassName: "bg-brand-steel/10 text-brand-steel",
      accentClassName: "bg-brand-ember",
      titleClassName: "text-brand-night",
      textClassName: "text-brand-steel",
    },
  ] as const;

  return (
    <main className="commercial-identity-canvas relative min-h-screen overflow-hidden px-5 py-8 sm:px-8 sm:py-10 lg:py-12">
      <div
        className="brand-corner-dots pointer-events-none absolute right-0 top-0 h-72 w-96"
        aria-hidden="true"
      />
      <div
        className="commercial-brand-corner-lines pointer-events-none absolute bottom-0 left-0 h-80 w-80"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-24 top-52 h-72 w-72 rounded-full bg-brand-steel/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-brand-ember/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/commercial"
            aria-label="Umbravia Forge"
            className="rounded-2xl border border-white/80 bg-white/90 px-3 py-2 shadow-lg shadow-slate-900/5 backdrop-blur-sm"
          >
            <BrandLockup className="h-12 w-auto max-w-56 sm:h-14 sm:max-w-64" />
          </Link>
          <LanguageSwitcher />
        </header>

        <section className="pb-10 pt-16 sm:pt-20 lg:pb-14 lg:pt-24">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-ember">
            {t("commercial.public.eyebrow")}
          </p>
          <h1 className="mt-4 max-w-5xl text-4xl font-black tracking-tight text-brand-night sm:text-5xl md:text-6xl lg:text-7xl">
            {t("commercial.public.title")}
          </h1>
          <div
            className="mt-6 h-1 w-28 rounded-full bg-gradient-to-r from-brand-ember via-brand-steel to-brand-night"
            aria-hidden="true"
          />
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
            {t("commercial.public.description")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to={primaryTarget} viewTransition>
                {primaryLabel} <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="bg-white/85">
              <Link to="/centres" viewTransition>
                {t("commercial.public.browseCentres")}
              </Link>
            </Button>
            {!user && (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-white/85"
              >
                <Link to="/login" viewTransition>
                  {t("commercial.public.signIn")}
                </Link>
              </Button>
            )}
          </div>
        </section>

        <div className="grid gap-5 md:grid-cols-3">
          {highlights.map(
            ({
              Icon,
              key,
              cardClassName,
              iconClassName,
              accentClassName,
              titleClassName,
              textClassName,
            }) => (
              <Card
                key={key}
                className={`relative overflow-hidden p-6 shadow-lg shadow-slate-900/10 backdrop-blur-sm ${cardClassName}`}
              >
                <span
                  className={`absolute inset-x-0 top-0 h-1 ${accentClassName}`}
                  aria-hidden="true"
                />
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClassName}`}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <h2 className={`mt-5 text-lg font-bold ${titleClassName}`}>
                  {t(`commercial.public.cards.${key}.title`)}
                </h2>
                <p className={`mt-2 text-sm leading-6 ${textClassName}`}>
                  {t(`commercial.public.cards.${key}.description`)}
                </p>
              </Card>
            ),
          )}
        </div>

        <CommercialArticle source={commercialSpanishMarkdown} />

        <footer className="pt-10 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Umbravia Forge
        </footer>
      </div>
    </main>
  );
}

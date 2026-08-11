import { ArrowRight, Blocks, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { getAccessRole } from "../context/auth-context";

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
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-16">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-blue-700">
          {t("commercial.public.eyebrow")}
        </p>
        <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-slate-950 md:text-6xl">
          {t("commercial.public.title")}
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
          {t("commercial.public.description")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to={primaryTarget}>
              {primaryLabel} <ArrowRight />
            </Link>
          </Button>
          {!user && (
            <Button asChild size="lg" variant="outline">
              <Link to="/login">{t("commercial.public.signIn")}</Link>
            </Button>
          )}
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {[
            [Blocks, "modular"],
            [Sparkles, "editable"],
            [ShieldCheck, "respectful"],
          ].map(([Icon, key]) => (
            <Card key={String(key)} className="p-6">
              <Icon className="text-blue-700" />
              <h2 className="mt-4 text-lg font-bold text-slate-950">
                {t(`commercial.public.cards.${key}.title`)}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {t(`commercial.public.cards.${key}.description`)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}

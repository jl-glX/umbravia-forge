import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { BrandLockup } from "./BrandLockup";
import { BrandGlyph } from "./BrandGlyph";
import type { BrandGlyphKind } from "../lib/brand-system";

interface AuthShellProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  utilityMenu?: ReactNode;
  contentSurface?: "card" | "integrated";
}

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  utilityMenu,
  contentSurface = "card",
}: AuthShellProps) {
  const { t } = useTranslation();
  const highlights: Array<{ kind: BrandGlyphKind; text: string }> = [
    { kind: "structure", text: t("auth.highlights.weekly") },
    { kind: "community", text: t("auth.highlights.waitlists") },
    { kind: "guidance", text: t("auth.highlights.secure") },
  ];

  return (
    <main className="auth-shell-enter grid min-h-screen bg-brand-night lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -left-40 top-1/3 h-96 w-96 rounded-full bg-brand-ember/20 blur-3xl" />
        <div className="absolute -right-32 -top-20 h-80 w-80 rounded-full bg-brand-path/15 blur-3xl" />

        <div className="relative inline-flex w-fit rounded-2xl bg-white px-3 py-2 shadow-xl shadow-black/20">
          <BrandLockup className="h-14 w-auto max-w-64" />
        </div>

        <div className="relative max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-ember">
            {t("auth.brandTagline")}
          </p>
          <h1 className="mt-5 text-5xl font-bold leading-[1.08] tracking-tight xl:text-6xl">
            {t("auth.brandTitle")}
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-300">
            {t("auth.brandDescription")}
          </p>
          <div className="mt-10 space-y-4">
            {highlights.map(({ kind, text }) => (
              <div
                key={text}
                className="flex items-center gap-3 text-sm text-slate-200"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 ring-1 ring-white/10">
                  <BrandGlyph kind={kind} size={18} />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-slate-500">
          © {new Date().getFullYear()} Umbravia Forge
        </p>
      </section>

      <section className="brand-identity-canvas relative flex min-h-screen flex-col overflow-hidden">
        <div
          className="brand-corner-dots pointer-events-none absolute right-0 top-0 h-64 w-80"
          aria-hidden="true"
        />
        <div
          className="brand-corner-lines pointer-events-none absolute bottom-0 left-0 h-72 w-72"
          aria-hidden="true"
        />
        <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-6 flex items-center justify-end gap-2">
              <LanguageSwitcher />
              {utilityMenu}
            </div>
            <div className="mb-8 lg:hidden">
              <BrandLockup className="h-14 w-auto max-w-64" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ember">
              {eyebrow}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {description}
            </p>
            <div
              className={
                contentSurface === "card"
                  ? "mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8"
                  : "mt-8"
              }
            >
              {children}
            </div>
          </div>
        </div>
        <p className="relative z-10 px-4 pb-6 text-center text-xs text-slate-400 lg:hidden">
          © {new Date().getFullYear()} Umbravia Forge
        </p>
      </section>
    </main>
  );
}

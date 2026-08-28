import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canonicalizeLocale } from "../i18n/supported-locales";
import { sortedLanguageOptions } from "../i18n/language-options";

interface LanguageSwitcherProps {
  compact?: boolean;
  inverted?: boolean;
}

export function LanguageSwitcher({
  compact = false,
  inverted = false,
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const language = canonicalizeLocale(i18n.resolvedLanguage ?? i18n.language);
  const options = sortedLanguageOptions(
    (key) => t(key),
    i18n.resolvedLanguage ?? i18n.language,
    compact ? "compact" : "full",
  );

  return (
    <label
      className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm ${inverted ? "bg-white/8 text-white ring-1 ring-white/10" : "bg-slate-100 text-slate-700"}`}
    >
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={language}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        className={`cursor-pointer bg-transparent font-semibold outline-none ${compact ? "w-10" : "w-auto"} ${inverted ? "text-white [&>option]:text-slate-900" : "text-slate-700"}`}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {compact ? option.compactLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

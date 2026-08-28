import {
  resolveIntlLocale,
  supportedLocales,
  type SupportedLocale,
} from "./supported-locales";

export type LanguageOption = {
  code: SupportedLocale;
  label: string;
  compactLabel: string;
};

const languageLabelKey: Record<SupportedLocale, string> = {
  es: "language.es",
  en: "language.en",
  de: "language.de",
  "de-CH": "language.deCH",
  fr: "language.fr",
  it: "language.it",
  gl: "language.gl",
  ca: "language.ca",
  "ca-valencia": "language.caValencia",
  eu: "language.eu",
  "oc-aranes": "language.ocAranes",
};

const compactLanguageLabel: Record<SupportedLocale, string> = {
  es: "ES",
  en: "EN",
  de: "DE",
  "de-CH": "CH",
  fr: "FR",
  it: "IT",
  gl: "GL",
  ca: "CA",
  "ca-valencia": "VAL",
  eu: "EU",
  "oc-aranes": "AR",
};

export function sortedLanguageOptions(
  translate: (key: string) => string,
  interfaceLocale: string | null | undefined,
  display: "full" | "compact" = "full",
): LanguageOption[] {
  const collator = new Intl.Collator(resolveIntlLocale(interfaceLocale), {
    sensitivity: "base",
  });
  return supportedLocales
    .map((code) => ({
      code,
      label: translate(languageLabelKey[code]),
      compactLabel: compactLanguageLabel[code],
    }))
    .sort((left, right) => {
      const leftLabel = display === "compact" ? left.compactLabel : left.label;
      const rightLabel =
        display === "compact" ? right.compactLabel : right.label;
      const byLabel = collator.compare(leftLabel, rightLabel);
      if (byLabel !== 0) return byLabel;
      return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    });
}

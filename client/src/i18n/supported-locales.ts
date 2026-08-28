export const supportedLocales = [
  "es",
  "en",
  "de",
  "de-CH",
  "fr",
  "it",
  "gl",
  "ca",
  "ca-valencia",
  "eu",
  "oc-aranes",
] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export const regionalLocaleFallbacks = {
  "de-CH": "de",
  "ca-valencia": "ca",
} as const satisfies Partial<Record<SupportedLocale, SupportedLocale>>;

export const fullCatalogLocales = supportedLocales.filter(
  (locale) => !(locale in regionalLocaleFallbacks),
);

const supportedLocaleByLowerCase = new Map(
  supportedLocales.map((locale) => [locale.toLowerCase(), locale]),
);

type ParsedLanguageTag = {
  language: string;
  region?: string;
  variants: string[];
};

function parseLanguageTag(
  value: string | null | undefined,
): ParsedLanguageTag | null {
  const normalized = value?.trim().replaceAll("_", "-");
  if (!normalized) return null;
  let canonical: string;
  try {
    [canonical] = Intl.getCanonicalLocales(normalized);
  } catch {
    return null;
  }
  if (!canonical) return null;
  const subtags = canonical.split("-");
  const language = subtags.shift()?.toLowerCase();
  if (!language) return null;
  if (subtags[0] && /^[A-Za-z]{4}$/.test(subtags[0])) subtags.shift();
  const region =
    subtags[0] && /^(?:[A-Za-z]{2}|\d{3})$/.test(subtags[0])
      ? subtags.shift()?.toUpperCase()
      : undefined;
  const variants: string[] = [];
  while (
    subtags[0] &&
    /^(?:\d[A-Za-z0-9]{3}|[A-Za-z0-9]{5,8})$/.test(subtags[0])
  ) {
    variants.push(subtags.shift()!.toLowerCase());
  }
  if (subtags.length > 0) return null;
  return { language, region, variants };
}

const intlLocaleBySupportedLocale: Record<SupportedLocale, string> = {
  es: "es-ES",
  en: "en-GB",
  de: "de-DE",
  "de-CH": "de-CH",
  fr: "fr-FR",
  it: "it-IT",
  gl: "gl-ES",
  ca: "ca-ES",
  "ca-valencia": "ca-ES-valencia",
  eu: "eu-ES",
  "oc-aranes": "oc-ES",
};

export function canonicalizeLocale(
  value: string | null | undefined,
): SupportedLocale {
  const parsed = parseLanguageTag(value);
  if (!parsed) return "es";
  if (parsed.language === "ca") {
    if (parsed.variants.length === 0) return "ca";
    return parsed.variants.length === 1 &&
      parsed.variants[0] === "valencia" &&
      (parsed.region === undefined || parsed.region === "ES")
      ? "ca-valencia"
      : "es";
  }
  if (parsed.language === "oc") {
    if (parsed.variants.length === 0) return "es";
    return parsed.variants.length === 1 &&
      parsed.variants[0] === "aranes" &&
      (parsed.region === undefined || parsed.region === "ES")
      ? "oc-aranes"
      : "es";
  }
  if (parsed.variants.length > 0) return "es";
  if (parsed.language === "de" && parsed.region === "CH") return "de-CH";
  return supportedLocaleByLowerCase.get(parsed.language) ?? "es";
}

export function resolveIntlLocale(value: string | null | undefined): string {
  return intlLocaleBySupportedLocale[canonicalizeLocale(value)];
}

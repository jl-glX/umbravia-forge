export const SUPPORTED_LOCALES = [
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

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type PlatformLocale = SupportedLocale;

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);
const SUPPORTED_LOCALE_BY_LOWER_CASE = new Map(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
);

type ParsedLanguageTag = {
  language: string;
  region?: string;
  variants: string[];
};

function parseLanguageTag(value: unknown): ParsedLanguageTag | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/_/g, "-");
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

const INTL_LOCALE_BY_SUPPORTED_LOCALE: Record<SupportedLocale, string> = {
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

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

export function canonicalizeLocaleOrNull(
  value: unknown,
): SupportedLocale | null {
  const parsed = parseLanguageTag(value);
  if (!parsed) return null;
  if (parsed.language === "ca") {
    if (parsed.variants.length === 0) return "ca";
    return parsed.variants.length === 1 &&
      parsed.variants[0] === "valencia" &&
      (parsed.region === undefined || parsed.region === "ES")
      ? "ca-valencia"
      : null;
  }
  if (parsed.language === "oc") {
    if (parsed.variants.length === 0) return null;
    return parsed.variants.length === 1 &&
      parsed.variants[0] === "aranes" &&
      (parsed.region === undefined || parsed.region === "ES")
      ? "oc-aranes"
      : null;
  }
  if (parsed.variants.length > 0) return null;
  if (parsed.language === "de" && parsed.region === "CH") return "de-CH";
  return SUPPORTED_LOCALE_BY_LOWER_CASE.get(parsed.language) ?? null;
}

export function canonicalizeLocale(value: unknown): SupportedLocale {
  return canonicalizeLocaleOrNull(value) ?? "es";
}

export function supportedLocaleOrDefault(value: unknown): SupportedLocale {
  return canonicalizeLocale(value);
}

export function resolveIntlLocale(value: unknown): string {
  return INTL_LOCALE_BY_SUPPORTED_LOCALE[supportedLocaleOrDefault(value)];
}

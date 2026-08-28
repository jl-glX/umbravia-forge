const TURNSTILE_LANGUAGES = new Set(["de", "en", "es", "fr", "it"]);

export function turnstileLanguage(language: string | undefined): string {
  const normalized = language?.trim().replaceAll("_", "-");
  if (!normalized) return "auto";

  let canonical: string;
  try {
    [canonical] = Intl.getCanonicalLocales(normalized);
  } catch {
    return "auto";
  }
  if (!canonical) return "auto";

  const subtags = canonical.split("-");
  const baseLanguage = subtags.shift()?.toLowerCase();
  if (!baseLanguage || !TURNSTILE_LANGUAGES.has(baseLanguage)) return "auto";

  if (subtags[0] && /^[A-Za-z]{4}$/.test(subtags[0])) subtags.shift();
  if (subtags[0] && /^(?:[A-Za-z]{2}|\d{3})$/.test(subtags[0])) subtags.shift();

  return subtags.length === 0 ? baseLanguage : "auto";
}

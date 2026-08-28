import { describe, expect, it } from "vitest";
import { sortedLanguageOptions } from "./language-options";
import caValencia from "./locales/ca-valencia.json";
import ca from "./locales/ca.json";
import deCh from "./locales/de-CH.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import eu from "./locales/eu.json";
import fr from "./locales/fr.json";
import gl from "./locales/gl.json";
import itLocale from "./locales/it.json";
import ocAranes from "./locales/oc-aranes.json";
import { resolveIntlLocale, supportedLocales } from "./supported-locales";

type LanguageResource = { language?: Record<string, string> };

const fullResources = {
  es,
  en,
  de,
  fr,
  it: itLocale,
  gl,
  ca,
  eu,
  "oc-aranes": ocAranes,
} as const;

function effectiveLanguageResource(
  locale: (typeof supportedLocales)[number],
): Record<string, string> {
  if (locale === "de-CH") {
    return {
      ...(de as LanguageResource).language,
      ...(deCh as LanguageResource).language,
    };
  }
  if (locale === "ca-valencia") {
    return {
      ...(ca as LanguageResource).language,
      ...(caValencia as LanguageResource).language,
    };
  }
  return (fullResources[locale] as LanguageResource).language ?? {};
}

const labelsByInterfaceLocale = {
  es: [
    "Español",
    "English",
    "Alemán",
    "Alemán (Suiza)",
    "Francés",
    "Italiano",
    "Gallego",
    "Catalán",
    "Valenciano",
    "Euskera",
    "Aranés",
  ],
  en: [
    "Spanish",
    "English",
    "German",
    "German (Switzerland)",
    "French",
    "Italian",
    "Galician",
    "Catalan",
    "Valencian",
    "Basque",
    "Aranese",
  ],
  de: [
    "Spanisch",
    "Englisch",
    "Deutsch",
    "Deutsch (Schweiz)",
    "Französisch",
    "Italienisch",
    "Galicisch",
    "Katalanisch",
    "Valencianisch",
    "Baskisch",
    "Aranesisch",
  ],
  "ca-valencia": [
    "Espanyol",
    "Anglès",
    "Alemany",
    "Alemany (Suïssa)",
    "Francès",
    "Italià",
    "Gallec",
    "Català",
    "Valencià",
    "Basc",
    "Aranès",
  ],
} as const;

describe("localized language options", () => {
  it.each(Object.entries(labelsByInterfaceLocale))(
    "sorts the exact locale set by visible label in %s",
    (interfaceLocale, labels) => {
      const labelByKey = new Map(
        supportedLocales.map((code, index) => [code, labels[index]]),
      );
      const options = sortedLanguageOptions((key) => {
        const suffix = key.slice("language.".length);
        const code =
          suffix === "deCH"
            ? "de-CH"
            : suffix === "caValencia"
              ? "ca-valencia"
              : suffix === "ocAranes"
                ? "oc-aranes"
                : suffix;
        return labelByKey.get(code as (typeof supportedLocales)[number]) ?? key;
      }, interfaceLocale);
      expect(options).toHaveLength(supportedLocales.length);
      expect(new Set(options.map(({ code }) => code))).toEqual(
        new Set(supportedLocales),
      );
      const collator = new Intl.Collator(resolveIntlLocale(interfaceLocale), {
        sensitivity: "base",
      });
      for (let index = 1; index < options.length; index += 1) {
        expect(
          collator.compare(options[index - 1].label, options[index].label),
        ).toBeLessThanOrEqual(0);
      }
    },
  );

  it("breaks equal visible labels deterministically by canonical code", () => {
    const first = sortedLanguageOptions(() => "Same label", "ca-valencia");
    const second = sortedLanguageOptions(() => "Same label", "ca-valencia");
    const expected = [...supportedLocales].sort();
    expect(first.map(({ code }) => code)).toEqual(expected);
    expect(second).toEqual(first);
  });

  it.each(["es", "en", "de", "ca-valencia"])(
    "sorts compact mode by the labels actually rendered in %s",
    (interfaceLocale) => {
      const options = sortedLanguageOptions(
        () => "Ignored full label",
        interfaceLocale,
        "compact",
      );
      expect(options).toHaveLength(supportedLocales.length);
      expect(new Set(options.map(({ code }) => code))).toEqual(
        new Set(supportedLocales),
      );
      const collator = new Intl.Collator(resolveIntlLocale(interfaceLocale), {
        sensitivity: "base",
      });
      for (let index = 1; index < options.length; index += 1) {
        expect(
          collator.compare(
            options[index - 1].compactLabel,
            options[index].compactLabel,
          ),
        ).toBeLessThanOrEqual(0);
      }
    },
  );

  it.each(supportedLocales)(
    "resolves and sorts all real language labels in %s",
    (interfaceLocale) => {
      const labels = effectiveLanguageResource(interfaceLocale);
      const translate = (key: string) => {
        const field = key.slice("language.".length);
        return labels[field] ?? key;
      };

      for (const display of ["full", "compact"] as const) {
        const options = sortedLanguageOptions(
          translate,
          interfaceLocale,
          display,
        );
        expect(options).toHaveLength(supportedLocales.length);
        expect(new Set(options.map(({ code }) => code))).toEqual(
          new Set(supportedLocales),
        );
        expect(new Set(options.map(({ code }) => code)).size).toBe(
          supportedLocales.length,
        );
        for (const option of options) {
          expect(option.label.trim()).not.toBe("");
          expect(option.label).not.toMatch(/^language\./);
        }

        const collator = new Intl.Collator(resolveIntlLocale(interfaceLocale), {
          sensitivity: "base",
        });
        for (let index = 1; index < options.length; index += 1) {
          const previous =
            display === "compact"
              ? options[index - 1].compactLabel
              : options[index - 1].label;
          const current =
            display === "compact"
              ? options[index].compactLabel
              : options[index].label;
          expect(collator.compare(previous, current)).toBeLessThanOrEqual(0);
        }
      }
    },
  );
});

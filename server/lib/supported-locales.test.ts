import { describe, expect, it } from "vitest";
import {
  canonicalizeLocale,
  canonicalizeLocaleOrNull,
  resolveIntlLocale,
  SUPPORTED_LOCALES,
  supportedLocaleOrDefault,
} from "./supported-locales.js";

describe("supported server locales", () => {
  it.each([
    ["de_ch", "de-CH"],
    ["ca-ES-valencia", "ca-valencia"],
    ["oc-ES-aranes", "oc-aranes"],
    ["fr-FR", "fr"],
    ["it_IT", "it"],
    ["gl-ES", "gl"],
    ["eu-ES", "eu"],
  ] as const)("canonicalizes %s without losing variants", (input, expected) => {
    expect(canonicalizeLocale(input)).toBe(expected);
  });

  it("accepts every persisted locale and defaults unknown values", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(supportedLocaleOrDefault(locale)).toBe(locale);
    }
    expect(supportedLocaleOrDefault("xx")).toBe("es");
    expect(canonicalizeLocaleOrNull("xx")).toBeNull();
    expect(canonicalizeLocaleOrNull("")).toBeNull();
  });

  it.each([
    "ca-notvalencian",
    "oc-fake-aranesjunk",
    "ca-aranes",
    "oc-valencia",
    "oc",
    "oc-ES",
    "oc-FR",
    "oc-Latn-ES",
    "ca-FR-valencia",
    "ca-US-valencia",
    "oc-FR-aranes",
    "ca-valencia-valencia",
    "ca-valencia-x-private",
  ])("rejects malformed or incompatible locale %s", (input) => {
    expect(canonicalizeLocaleOrNull(input)).toBeNull();
    expect(canonicalizeLocale(input)).toBe("es");
  });

  it("maps every persisted locale to an Intl-compatible locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const intlLocale = resolveIntlLocale(locale);
      expect(() => new Intl.DateTimeFormat(intlLocale)).not.toThrow();
      expect(() => new Intl.NumberFormat(intlLocale)).not.toThrow();
    }
  });
});

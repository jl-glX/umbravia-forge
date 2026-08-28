import { describe, expect, it } from "vitest";
import {
  canonicalizeLocale,
  resolveIntlLocale,
  supportedLocales,
} from "./supported-locales";

describe("supported client locales", () => {
  it.each([
    ["de_ch", "de-CH"],
    ["ca-valencia", "ca-valencia"],
    ["ca-ES-valencia", "ca-valencia"],
    ["oc-aranes", "oc-aranes"],
    ["oc-ES-aranes", "oc-aranes"],
    ["fr-FR", "fr"],
    ["eu-ES", "eu"],
  ] as const)("canonicalizes %s without losing variants", (input, expected) => {
    expect(canonicalizeLocale(input)).toBe(expected);
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
    expect(canonicalizeLocale(input)).toBe("es");
  });

  it("maps every persisted locale to an Intl-compatible locale", () => {
    for (const locale of supportedLocales) {
      const intlLocale = resolveIntlLocale(locale);
      expect(() => new Intl.DateTimeFormat(intlLocale)).not.toThrow();
      expect(() => new Intl.NumberFormat(intlLocale)).not.toThrow();
    }
  });
});

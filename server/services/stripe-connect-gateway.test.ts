import { describe, expect, it } from "vitest";
import {
  resolveStripeAccountLocale,
  type StripeAccountLocale,
} from "./stripe-connect-gateway.js";
import {
  SUPPORTED_LOCALES,
  type PlatformLocale,
} from "../lib/supported-locales.js";

describe("Stripe account locale adaptation", () => {
  it.each<[PlatformLocale, StripeAccountLocale | undefined]>([
    ["es", "es"],
    ["en", "en"],
    ["de", "de"],
    ["de-CH", "de"],
    ["fr", "fr"],
    ["it", "it"],
    ["gl", undefined],
    ["ca", undefined],
    ["ca-valencia", undefined],
    ["eu", undefined],
    ["oc-aranes", undefined],
  ])(
    "maps the platform locale %s without a Spanish fallback",
    (input, expected) => {
      expect(resolveStripeAccountLocale(input)).toBe(expected);
    },
  );

  it("covers every platform locale explicitly", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(11);
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => resolveStripeAccountLocale(locale)).not.toThrow();
    }
  });

  it.each([undefined, null, "", "xx", "fr-CA"])(
    "keeps an unknown provider locale neutral: %s",
    (locale) => {
      expect(resolveStripeAccountLocale(locale)).toBeUndefined();
    },
  );
});

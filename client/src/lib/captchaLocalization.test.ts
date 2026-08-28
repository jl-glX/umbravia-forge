import { describe, expect, it } from "vitest";
import { turnstileLanguage } from "./captchaLocalization";

describe("Turnstile language resolution", () => {
  it.each([
    [undefined, "auto"],
    ["", "auto"],
    ["xx", "auto"],
    ["gl", "auto"],
    ["ca-valencia", "auto"],
    ["eu", "auto"],
    ["oc-aranes", "auto"],
    ["fr-FR", "fr"],
    ["fr_Latn_FR", "fr"],
    ["it_IT", "it"],
    ["de-CH", "de"],
    ["fr-notvalencian", "auto"],
    ["fr-valencia", "auto"],
    ["fr-FR-extraordinary", "auto"],
    ["fr-u-ca-gregory", "auto"],
    ["it-IT-u-nu-latn", "auto"],
    ["fr-x-private", "auto"],
    ["fr-💥", "auto"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(turnstileLanguage(input)).toBe(expected);
  });
});

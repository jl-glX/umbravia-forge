import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface LocaleTree {
  [key: string]: string | LocaleTree;
}

function readLocale(name: string): LocaleTree {
  return JSON.parse(
    readFileSync(resolve("client/src/i18n/locales", `${name}.json`), "utf8"),
  ) as LocaleTree;
}

function flatten(tree: LocaleTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "string"
        ? [[path, value]]
        : Object.entries(flatten(value, path));
    }),
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

describe("translation catalogues", () => {
  const english = flatten(readLocale("en"));

  it.each(["es", "de"])(
    "%s contains every translation key and preserves placeholders",
    (language) => {
      const locale = flatten(readLocale(language));

      expect(Object.keys(locale).sort()).toEqual(Object.keys(english).sort());

      for (const [key, value] of Object.entries(locale)) {
        expect(placeholders(value), key).toEqual(placeholders(english[key]));
      }
    },
  );

  it("combines the de-CH regional overrides with the complete German catalogue", () => {
    const german = flatten(readLocale("de"));
    const overrides = flatten(readLocale("de-CH"));
    const swissGerman = { ...german, ...overrides };

    expect(Object.keys(swissGerman).sort()).toEqual(
      Object.keys(english).sort(),
    );
    expect(Object.keys(overrides).every((key) => key in german)).toBe(true);
    for (const [key, value] of Object.entries(swissGerman)) {
      expect(placeholders(value), key).toEqual(placeholders(english[key]));
    }
    expect(Object.values(swissGerman).join("\n")).not.toContain("ß");
  });
});

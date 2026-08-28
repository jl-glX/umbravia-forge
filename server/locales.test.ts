import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  fullCatalogLocales,
  regionalLocaleFallbacks,
  supportedLocales as clientSupportedLocales,
} from "../client/src/i18n/supported-locales.js";
import { SUPPORTED_LOCALES as serverSupportedLocales } from "./lib/supported-locales.js";

interface LocaleTree {
  [key: string]: string | LocaleTree;
}

interface LocalizationPolicy {
  generatedFullCatalogLocales: string[];
  pilotModel: {
    id: string;
    revision: string;
    license: string;
    weightFile: string;
    weightSha256: string;
    promptDate: string;
    promptTemplate: string;
    status: string;
    rejectedPilotSha256: string[];
  };
  pilotTargets: Record<
    string,
    { targetName: string; reviewGlossary: Record<string, string> }
  >;
  technicalTokens: string[];
  pluralizableTechnicalTokens: string[];
  requiredExactTokensByKey: Record<string, string[]>;
  reviewedResidualTermsByLocale: Record<
    string,
    Array<{ term: string; reason: string; evidence: string }>
  >;
  sensitiveReviewKeys: string[];
  languageTables: Record<string, Record<string, string>>;
  generatedStructureExceptions: GeneratedStructureException[];
  generatedSemanticExceptions: GeneratedSemanticException[];
}

const localizationPolicy = JSON.parse(
  readFileSync(resolve("scripts/localization-policy.json"), "utf8"),
) as LocalizationPolicy;

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

const EXECUTABLE_STRUCTURE =
  /\{\{[^{}\r\n]+\}\}|https?:\/\/(?=\s|$|[.,;:!?)}\]])|https?:\/\/[^\s"'<>]+|[A-Za-z0-9_.+-]+@[A-Za-z0-9_.-]+\.[A-Za-z]{2,}|<\/?[A-Za-z][^>\r\n]*>|`[^`\r\n]+`|(?:[A-Za-z]:\\|(?<![\p{L}\p{N}_])\/)[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%\\-]+|&(?:amp;)*(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);|\r\n|\r|\n/gu;
const KNOWN_BRAND =
  /\b(?:UMF Support|Umbravia Forge|Forge Support|Cloudflare Turnstile|Cloudflare|Stripe Connect|Stripe|Caddy|WebAuthn|WhatsApp|Microsoft|Google|Apple)\b/g;
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pluralizableTechnicalTokens = new Set(
  localizationPolicy.pluralizableTechnicalTokens,
);
const pluralizableTechnicalTokenSource = localizationPolicy.technicalTokens
  .filter((token) => pluralizableTechnicalTokens.has(token))
  .map(escapeRegex)
  .join("|");
const exactTechnicalTokenSource = localizationPolicy.technicalTokens
  .filter((token) => !pluralizableTechnicalTokens.has(token))
  .map(escapeRegex)
  .join("|");
const TECHNICAL_TOKEN = new RegExp(
  `(?<![A-Za-z0-9_])(?:(?:${pluralizableTechnicalTokenSource})(?=s?(?:[^A-Za-z0-9_]|$))|(?:${exactTechnicalTokenSource})(?![A-Za-z0-9_]))`,
  "g",
);
const PROTECTED_STRUCTURE = new RegExp(
  `${EXECUTABLE_STRUCTURE.source}|${KNOWN_BRAND.source}|${TECHNICAL_TOKEN.source}`,
  "gu",
);

interface GeneratedStructureException {
  locale: string;
  key: string;
  reason: string;
  sourceSignatureSha256: string;
  targetSignatureSha256: string;
}

interface GeneratedSemanticException {
  locale: string;
  key: string;
  kind: string;
  evidence: string;
  reason: string;
  valueSha256: string;
}

interface LocalizationPilotEvidence {
  locale: string;
  model: string;
  revision: string;
  license: string;
  weightFile: string;
  weightSha256: string;
  promptDate: string;
  manifestFile: string;
  manifestRelativePath: string;
  manifestSha256: string;
  policySha256: string;
  sourceCatalogSha256: string;
  comparisonCatalogSha256: string;
  generatorSha256: string;
  sourceSegmentsSha256: string;
  catalogKeyCount: number;
  sampleCount: number;
  translatedSegmentCount: number;
  reviewGlossary: Record<string, string>;
  entries: Array<{ key: string; source: string; target: string }>;
  language: Record<string, string>;
}

// Every entry must name one reviewed locale/key pair and pin both signatures.
// Keep this empty unless a generated catalogue needs a legitimate local
// punctuation change or protected-brand reordering.
const GENERATED_STRUCTURE_EXCEPTIONS: readonly GeneratedStructureException[] =
  localizationPolicy.generatedStructureExceptions;

function immediateTokenSignature(value: string, source: string) {
  let cursor = 0;
  return [...source.matchAll(PROTECTED_STRUCTURE)].map((match) => {
    const token = match[0];
    const index = value.indexOf(token, cursor);
    if (index < 0) return [`<missing:${token}>`, "", ""] as const;
    cursor = index + token.length;
    const before = value.slice(0, index).match(/[^\p{L}\p{N}_]*$/u)?.[0] ?? "";
    const after =
      value.slice(index + token.length).match(/^[^\p{L}\p{N}_]*/u)?.[0] ?? "";
    return [token, before, after] as const;
  });
}

function protectedCounts(value: string, source: string) {
  const sourceMatches = [...source.matchAll(PROTECTED_STRUCTURE)];
  const valueMatches = [...value.matchAll(PROTECTED_STRUCTURE)];
  return [...new Set(sourceMatches.map((match) => match[0]))].map((token) => ({
    token,
    expected: sourceMatches.filter((match) => match[0] === token).length,
    actual: valueMatches.filter((match) => match[0] === token).length,
  }));
}

function tokenCounts(value: string, pattern: RegExp) {
  const tokens = [...value.matchAll(pattern)].map((match) => match[0]);
  return [...new Set(tokens)].sort().map((token) => ({
    token,
    count: tokens.filter((candidate) => candidate === token).length,
  }));
}

function commonStructure(value: string) {
  return {
    strictTokens: [...value.matchAll(EXECUTABLE_STRUCTURE)].map(
      (match) => match[0],
    ),
    knownBrands: tokenCounts(value, KNOWN_BRAND),
    technicalTokens: tokenCounts(value, TECHNICAL_TOKEN),
    leadingWhitespace: value.match(/^\s*/)?.[0] ?? "",
    trailingWhitespace: value.match(/\s*$/)?.[0] ?? "",
    lineBreaks: [...value.matchAll(/\r?\n[ \t]*/g)].map((match) => match[0]),
  };
}

function exceptionStructure(value: string) {
  return {
    executableTokens: tokenCounts(value, EXECUTABLE_STRUCTURE),
    knownBrands: tokenCounts(value, KNOWN_BRAND),
    technicalTokens: tokenCounts(value, TECHNICAL_TOKEN),
    leadingWhitespace: value.match(/^\s*/)?.[0] ?? "",
    trailingWhitespace: value.match(/\s*$/)?.[0] ?? "",
    lineBreaks: [...value.matchAll(/\r?\n[ \t]*/g)].map((match) => match[0]),
  };
}

function exactTokenCount(value: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...value.matchAll(
      new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g"),
    ),
  ].length;
}

function requiredExactTokensAreValid(
  key: string,
  value: string,
  source: string,
): boolean {
  return (localizationPolicy.requiredExactTokensByKey[key] ?? []).every(
    (token) =>
      exactTokenCount(source, token) > 0 &&
      exactTokenCount(value, token) === exactTokenCount(source, token),
  );
}

function protectedStructure(value: string, source = value) {
  return {
    ...commonStructure(value),
    counts: protectedCounts(value, source),
    tokens: immediateTokenSignature(value, source),
  };
}

function maintainedCatalogStructure(value: string) {
  return {
    // Maintained translations may reorder placeholders and tags, translate
    // generic acronyms and revise product copy. Executable identities and
    // known-brand counts remain immutable, as do outer whitespace and
    // line-break indentation.
    executableTokens: tokenCounts(value, EXECUTABLE_STRUCTURE),
    knownBrands: tokenCounts(value, KNOWN_BRAND),
    leadingWhitespace: value.match(/^\s*/)?.[0] ?? "",
    trailingWhitespace: value.match(/\s*$/)?.[0] ?? "",
    lineBreaks: [...value.matchAll(/\r?\n[ \t]*/g)].map((match) => match[0]),
  };
}

function structureHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function executableTokens(value: string): string[] {
  return [...value.matchAll(EXECUTABLE_STRUCTURE)].map((match) => match[0]);
}

function isUsableTranslationValue(value: string): boolean {
  return (
    value !== "" && !value.includes("\uFFFD") && !/\bundefined\b/i.test(value)
  );
}

interface GeneratedSemanticFinding {
  locale: string;
  key: string;
  kind: "exact-en" | "exact-es" | "exact-other" | "residual-en" | "residual-es";
  evidence: string;
  valueSha256: string;
}

const ENGLISH_RESIDUAL_TERMS = [
  "account",
  "administrator",
  "billing",
  "commercial trial",
  "data review",
  "delete",
  "deletion",
  "facility",
  "invoice",
  "member",
  "password",
  "payment",
  "sign in",
  "support ticket",
  "trainer",
] as const;
const SPANISH_RESIDUAL_TERMS = [
  "administrador",
  "contraseña",
  "cuenta",
  "eliminación",
  "eliminar",
  "entrenador",
  "facturación",
  "iniciar sesión",
  "miembro",
  "pago",
  "prueba comercial",
  "revisión de datos",
  "ticket de soporte",
] as const;

function valueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function residualMatches(value: string, terms: readonly string[]): string[] {
  const lexicalValue = value.replace(PROTECTED_STRUCTURE, " ");
  return terms.filter((term) =>
    new RegExp(
      `(?:^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}])`,
      "iu",
    ).test(lexicalValue),
  );
}

function reviewedResidualTerms(locale: string): ReadonlySet<string> {
  return new Set(
    (localizationPolicy.reviewedResidualTermsByLocale[locale] ?? []).map(
      ({ term }) => term.toLocaleLowerCase("en"),
    ),
  );
}

function generatedSemanticFindings(input: {
  locale: string;
  values: Record<string, string>;
  catalogs: Record<string, Record<string, string>>;
}): GeneratedSemanticFinding[] {
  const findings: GeneratedSemanticFinding[] = [];
  const reviewedTerms = reviewedResidualTerms(input.locale);
  for (const [key, value] of Object.entries(input.values)) {
    const hash = valueHash(value);
    const lexicalValue = value.replace(PROTECTED_STRUCTURE, " ");
    const hasLexicalContent = /[\p{L}\p{N}]/u.test(lexicalValue);
    const add = (kind: GeneratedSemanticFinding["kind"], evidence: string) =>
      findings.push({
        locale: input.locale,
        key,
        kind,
        evidence,
        valueSha256: hash,
      });
    if (hasLexicalContent) {
      if (value === input.catalogs.en[key]) add("exact-en", "en");
      if (
        input.catalogs.es[key] !== input.catalogs.en[key] &&
        value === input.catalogs.es[key]
      ) {
        add("exact-es", "es");
      }
    }
    const matchingLocales = hasLexicalContent
      ? localizationPolicy.generatedFullCatalogLocales
          .filter(
            (locale) =>
              locale !== input.locale &&
              input.catalogs[locale]?.[key] === value &&
              value !== input.catalogs.en[key] &&
              value !== input.catalogs.es[key],
          )
          .sort()
      : [];
    if (matchingLocales.length > 0) {
      add("exact-other", matchingLocales.join(","));
    }
    for (const term of residualMatches(value, ENGLISH_RESIDUAL_TERMS)) {
      if (!reviewedTerms.has(term.toLocaleLowerCase("en"))) {
        add("residual-en", term);
      }
    }
    for (const term of residualMatches(value, SPANISH_RESIDUAL_TERMS)) {
      if (!reviewedTerms.has(term.toLocaleLowerCase("en"))) {
        add("residual-es", term);
      }
    }
  }
  return findings;
}

function unapprovedSemanticFindings(
  findings: readonly GeneratedSemanticFinding[],
  exceptions: readonly GeneratedSemanticException[] = localizationPolicy.generatedSemanticExceptions,
): GeneratedSemanticFinding[] {
  return findings.filter(
    (finding) =>
      !exceptions.some(
        (exception) =>
          exception.locale === finding.locale &&
          exception.key === finding.key &&
          exception.kind === finding.kind &&
          exception.evidence === finding.evidence &&
          exception.reason.trim() !== "" &&
          exception.valueSha256 === finding.valueSha256,
      ),
  );
}

function generatedCatalogStructureIsValid(input: {
  locale: string;
  key: string;
  value: string;
  source: string;
  exceptions?: readonly GeneratedStructureException[];
}): boolean {
  if (!requiredExactTokensAreValid(input.key, input.value, input.source)) {
    return false;
  }
  const expected = protectedStructure(input.source);
  const actual = protectedStructure(input.value, input.source);
  if (
    isDeepStrictEqual(
      commonStructure(input.value),
      commonStructure(input.source),
    )
  ) {
    return true;
  }

  // Exceptions may approve only a reviewed token reordering. Token identity
  // and counts, brands, technical terms, outer whitespace and line breaks
  // remain immutable.
  if (
    !isDeepStrictEqual(
      exceptionStructure(input.value),
      exceptionStructure(input.source),
    )
  ) {
    return false;
  }
  const exception = (input.exceptions ?? GENERATED_STRUCTURE_EXCEPTIONS).find(
    (candidate) =>
      candidate.locale === input.locale && candidate.key === input.key,
  );
  return Boolean(
    exception?.reason.trim() &&
    exception.sourceSignatureSha256 === structureHash(expected.tokens) &&
    exception.targetSignatureSha256 === structureHash(actual.tokens),
  );
}

function invalidGeneratedCatalogKeys(
  locale: string,
  values: Record<string, string>,
  sources: Record<string, string>,
  exceptions: readonly GeneratedStructureException[] = GENERATED_STRUCTURE_EXCEPTIONS,
): string[] {
  return Object.entries(values).flatMap(([key, value]) =>
    generatedCatalogStructureIsValid({
      locale,
      key,
      value,
      source: sources[key],
      exceptions,
    })
      ? []
      : [key],
  );
}

describe("translation catalogues", () => {
  const english = flatten(readLocale("en"));

  it("keeps client, server, catalogues and regional fallbacks in sync", () => {
    expect([...clientSupportedLocales]).toEqual([...serverSupportedLocales]);
    expect(
      readdirSync(resolve("client/src/i18n/locales"))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .sort(),
    ).toEqual([...clientSupportedLocales].sort());
    expect(
      [...fullCatalogLocales, ...Object.keys(regionalLocaleFallbacks)].sort(),
    ).toEqual([...clientSupportedLocales].sort());
    for (const [regional, fallback] of Object.entries(
      regionalLocaleFallbacks,
    )) {
      expect(clientSupportedLocales).toContain(regional);
      expect(fullCatalogLocales).toContain(fallback);
    }
    expect(localizationPolicy.generatedFullCatalogLocales).toEqual([
      "fr",
      "it",
      "gl",
      "ca",
      "eu",
      "oc-aranes",
    ]);
    expect(new Set(localizationPolicy.technicalTokens).size).toBe(
      localizationPolicy.technicalTokens.length,
    );
    expect(localizationPolicy.technicalTokens).toEqual(
      expect.arrayContaining(["AMRAP", "For Time", "EMOM", "Tabata"]),
    );
    expect(localizationPolicy.technicalTokens).not.toContain("ID");
    expect(localizationPolicy.pluralizableTechnicalTokens).toEqual([
      "API",
      "GIF",
      "PDF",
      "PNG",
      "URL",
    ]);
    expect(
      localizationPolicy.pluralizableTechnicalTokens.every((token) =>
        localizationPolicy.technicalTokens.includes(token),
      ),
    ).toBe(true);
    expect(localizationPolicy.requiredExactTokensByKey).toEqual({
      "support.addAgentDescription": ["ID"],
    });
    for (const [key, tokens] of Object.entries(
      localizationPolicy.requiredExactTokensByKey,
    )) {
      expect(english[key], key).toBeTruthy();
      for (const token of tokens) {
        expect(
          exactTokenCount(english[key], token),
          `${key}:${token}`,
        ).toBeGreaterThan(0);
      }
    }
    const residualTerms = new Set<string>([
      ...ENGLISH_RESIDUAL_TERMS,
      ...SPANISH_RESIDUAL_TERMS,
    ]);
    for (const [locale, entries] of Object.entries(
      localizationPolicy.reviewedResidualTermsByLocale,
    )) {
      expect(localizationPolicy.generatedFullCatalogLocales).toContain(locale);
      expect(new Set(entries.map(({ term }) => term)).size).toBe(
        entries.length,
      );
      for (const { term, reason, evidence } of entries) {
        expect(residualTerms).toContain(term);
        expect(reason.trim()).not.toBe("");
        expect(new URL(evidence).protocol).toBe("https:");
      }
    }
    expect(localizationPolicy.sensitiveReviewKeys).toHaveLength(51);
    for (const key of localizationPolicy.sensitiveReviewKeys) {
      expect(english[key], key).toBeTruthy();
    }
    expect(Object.keys(localizationPolicy.languageTables).sort()).toEqual(
      [...localizationPolicy.generatedFullCatalogLocales].sort(),
    );
    expect(Object.keys(localizationPolicy.pilotTargets)).toEqual(["fr"]);
    expect(localizationPolicy.pilotModel).toEqual({
      id: "BSC-LT/salamandraTA-2b-instruct",
      revision: "bd61551e6b5b2ff486ea5e9fa0b39a7477f2edbc",
      license: "Apache-2.0",
      weightFile: "model.safetensors",
      weightSha256:
        "b8040eab8c2fe404cc9be3e46559e77f95600f42ccbdd4ea62a728d774341f63",
      promptDate: "2026-08-27",
      promptTemplate:
        "Translate the following text from English into {target}.\nEnglish: {text} \n{target}:",
      status: "rejected",
      rejectedPilotSha256: [
        "955ae0a5ee0dfbc34201aae94cf9ab1acc34f1ceed7a38d44df9267f0b65d11b",
        "5f49e0679a4ab092ec59a6f840eb7c69101de6a9f04ae516c5fa9983f83697a4",
      ],
    });
  });

  it.each(fullCatalogLocales.filter((language) => language !== "en"))(
    "%s contains every translation key and preserves protected structure",
    (language) => {
      const locale = flatten(readLocale(language));

      expect(Object.keys(locale).sort()).toEqual(Object.keys(english).sort());
      if (!["es", "de"].includes(language)) {
        expect(invalidGeneratedCatalogKeys(language, locale, english)).toEqual(
          [],
        );
      }

      for (const [key, value] of Object.entries(locale)) {
        expect(isUsableTranslationValue(value), key).toBe(true);
        if (["es", "de"].includes(language)) {
          expect(maintainedCatalogStructure(value), key).toEqual(
            maintainedCatalogStructure(english[key]),
          );
        }
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
    expect(Object.keys(overrides)).toHaveLength(1_803);
    expect(Object.keys(overrides).every((key) => key in german)).toBe(true);
    for (const [key, value] of Object.entries(overrides)) {
      expect(isUsableTranslationValue(value), key).toBe(true);
    }
    for (const [key, value] of Object.entries(swissGerman)) {
      expect(isUsableTranslationValue(value), key).toBe(true);
      expect(maintainedCatalogStructure(value), key).toEqual(
        maintainedCatalogStructure(english[key]),
      );
    }
    expect(Object.values(swissGerman).join("\n")).not.toContain("ß");
  });

  it("combines Valencian regional overrides with the complete Catalan catalogue", () => {
    const catalan = flatten(readLocale("ca"));
    const overrides = flatten(readLocale("ca-valencia"));
    const valencian = { ...catalan, ...overrides };

    expect(Object.keys(valencian).sort()).toEqual(Object.keys(english).sort());
    expect(Object.keys(overrides)).toHaveLength(394);
    expect(Object.keys(overrides).every((key) => key in catalan)).toBe(true);
    for (const [key, value] of Object.entries(overrides)) {
      expect(isUsableTranslationValue(value), key).toBe(true);
    }
    for (const [key, value] of Object.entries(valencian)) {
      expect(isUsableTranslationValue(value), key).toBe(true);
      expect(maintainedCatalogStructure(value), key).toEqual(
        maintainedCatalogStructure(english[key]),
      );
    }
  });

  it("detects changes to interpolation, HTML, routes, line breaks and significant spaces", () => {
    const source =
      "Open {{ value }}:\n  <strong>https://example.com/api/health</strong> with UMF Support";
    const preserved =
      "Ouvrez {{ value }}:\n  <strong>https://example.com/api/health</strong> avec UMF Support";

    expect(protectedStructure(preserved, source)).toEqual(
      protectedStructure(source),
    );
    expect(executableTokens("socio/a · adestrador/a")).toEqual([]);
    expect(executableTokens("Abra /api/health")).toEqual(["/api/health"]);
    expect(protectedStructure("Adresse E-mail", "Account email")).toEqual({
      strictTokens: [],
      knownBrands: [],
      technicalTokens: [],
      leadingWhitespace: "",
      trailingWhitespace: "",
      lineBreaks: [],
      counts: [],
      tokens: [],
    });
    expect(
      protectedStructure("Account <em>email</em>", "Account email"),
    ).not.toEqual(protectedStructure("Account email"));
    expect(
      protectedStructure("Use API then API now", "Use API now"),
    ).not.toEqual(protectedStructure("Use API now"));
    expect(
      protectedStructure(
        "Open Umbravia Forge and Umbravia Forge",
        "Open Umbravia Forge",
      ),
    ).not.toEqual(protectedStructure("Open Umbravia Forge"));
    expect(protectedStructure("Use API with TVA now", "Use API now")).toEqual(
      protectedStructure("Use API now"),
    );
    expect(protectedStructure("Examinez le PDF", "Review the PDFs")).toEqual(
      protectedStructure("Review the PDFs"),
    );
    expect(protectedStructure("Tabatas", "Tabata")).not.toEqual(
      protectedStructure("Tabata"),
    );
    const modalitySource = "Configure AMRAP, For Time, EMOM and Tabata.";
    const modalityTranslation = "Configurez AMRAP, For Time, EMOM et Tabata.";
    expect(protectedStructure(modalityTranslation, modalitySource)).toEqual(
      protectedStructure(modalitySource),
    );
    for (const changed of [
      modalityTranslation.replace("For Time", "Pour le temps"),
      modalityTranslation.replace("Tabata", "tabata"),
    ]) {
      expect(protectedStructure(changed, modalitySource)).not.toEqual(
        protectedStructure(modalitySource),
      );
    }
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "support.addAgentDescription",
        value: "Saisissez l'identifiant interne du compte.",
        source: "Enter the account's internal ID.",
      }),
    ).toBe(false);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "support.addAgentDescription",
        value: "Saisissez l'ID interne du compte.",
        source: "Enter the account's internal ID.",
      }),
    ).toBe(true);
    expect(
      maintainedCatalogStructure("Utilisez aujourd'hui Umbravia Forge"),
    ).toEqual(maintainedCatalogStructure("Use Umbravia Forge today"));
    expect(
      maintainedCatalogStructure("Ouvrez {{ value }} et continuez"),
    ).toEqual(maintainedCatalogStructure("Open {{ value }}: and continue"));
    expect(maintainedCatalogStructure("{{name}} herunterladen")).toEqual(
      maintainedCatalogStructure("Download {{name}}"),
    );
    expect(maintainedCatalogStructure("EEE y CCO")).toEqual(
      maintainedCatalogStructure("EEA and BCC"),
    );
    expect(maintainedCatalogStructure("CUENTA DE MIEMBRO")).toEqual(
      maintainedCatalogStructure("MEMBER ACCOUNT"),
    );
    for (const changed of [
      preserved.replace("{{ value }}", "{{value}}"),
      preserved.replace(" }}:", " }} :"),
      preserved.replace("<strong>", "<b>"),
      preserved.replace("/api/health", "/api/live"),
      preserved.replace("\n  ", " "),
      preserved.replace("UMF Support", "Assistance UMF"),
    ]) {
      expect(protectedStructure(changed, source)).not.toEqual(
        protectedStructure(source),
      );
    }

    const boundaries =
      "API, translate this: UMF Support (CPU)/URL-HTML.\n{{ name }}API";
    const translated =
      "API, traduisez ceci: UMF Support (CPU)/URL-HTML.\n{{ name }}API";
    expect(protectedStructure(translated, boundaries)).toEqual(
      protectedStructure(boundaries),
    );
    for (const changed of [
      translated.replace("API,", "API"),
      translated.replace(": UMF Support", " - UMF Support"),
      translated.replace("(CPU)", "CPU"),
      translated.replace(")/URL", ") URL"),
      translated.replace("URL-HTML", "URL HTML"),
      translated.replace("HTML.\n", "HTML:\n"),
      translated.replace("{{ name }}API", "{{ name }} API"),
    ]) {
      expect(protectedStructure(changed, boundaries)).not.toEqual(
        protectedStructure(boundaries),
      );
    }

    const frenchColonSource =
      "Open {{ first }} then {{ second }} with Umbravia Forge";
    const frenchColon =
      "Ouvrez {{ second }} puis {{ first }} avec Umbravia Forge";
    const reviewedException: GeneratedStructureException = {
      locale: "fr",
      key: "test.frenchColon",
      reason: "French syntax requires a reviewed interpolation reordering.",
      sourceSignatureSha256: structureHash(
        protectedStructure(frenchColonSource).tokens,
      ),
      targetSignatureSha256: structureHash(
        protectedStructure(frenchColon, frenchColonSource).tokens,
      ),
    };
    expect(structureHash(protectedStructure(frenchColonSource).tokens)).toBe(
      "8355397127d77581170b0b582e88cb3bfcf9bfd1d3683a74c6843989ace9cccf",
    );
    expect(
      structureHash(protectedStructure(frenchColon, frenchColonSource).tokens),
    ).toBe("28d34a7358ac053a4ed76f046e4f5023cb86378a1ba9bc67be69c40c3e8e1a84");
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.frenchColon",
        value: frenchColon,
        source: frenchColonSource,
      }),
    ).toBe(false);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.addedTechnicalToken",
        value: "Votre compte API est prêt",
        source: "Your account is ready",
      }),
    ).toBe(false);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.addedBrand",
        value: "Votre compte Stripe est prêt",
        source: "Your account is ready",
      }),
    ).toBe(false);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.targetAcronym",
        value: "TVA applicable",
        source: "Applicable tax",
      }),
    ).toBe(true);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.frenchColon",
        value: frenchColon,
        source: frenchColonSource,
        exceptions: [reviewedException],
      }),
    ).toBe(true);
    expect(
      generatedCatalogStructureIsValid({
        locale: "fr",
        key: "test.frenchColon",
        value: frenchColon.replace(
          "Umbravia Forge",
          "Umbravia Forge Umbravia Forge",
        ),
        source: frenchColonSource,
        exceptions: [reviewedException],
      }),
    ).toBe(false);
    expect(
      invalidGeneratedCatalogKeys(
        "fr",
        { "test.frenchColon": frenchColon },
        { "test.frenchColon": frenchColonSource },
        [reviewedException],
      ),
    ).toEqual([]);
    expect(
      invalidGeneratedCatalogKeys(
        "it",
        { "test.frenchColon": frenchColon },
        { "test.frenchColon": frenchColonSource },
        [reviewedException],
      ),
    ).toEqual(["test.frenchColon"]);
    expect(
      invalidGeneratedCatalogKeys(
        "fr",
        { "test.otherKey": frenchColon },
        { "test.otherKey": frenchColonSource },
        [reviewedException],
      ),
    ).toEqual(["test.otherKey"]);
    expect(
      invalidGeneratedCatalogKeys(
        "fr",
        { "test.frenchColon": frenchColon },
        { "test.frenchColon": frenchColonSource },
        [
          {
            ...reviewedException,
            targetSignatureSha256: "stale-hash",
          },
        ],
      ),
    ).toEqual(["test.frenchColon"]);
  });

  it("uses canonical boundaries for executable translation tokens", () => {
    const positiveCases: ReadonlyArray<readonly [string, readonly string[]]> = [
      [
        "Keep&nbsp;&amp;&#160;&#xA0;&amp;nbsp;safe",
        ["&nbsp;", "&amp;", "&#160;", "&#xA0;", "&amp;nbsp;"],
      ],
      [
        '<strong title="x">https://example.com/api/health</strong>',
        ['<strong title="x">', "https://example.com/api/health", "</strong>"],
      ],
      ["{{ value }}\n", ["{{ value }}", "\n"]],
      ["`/api/health` and /api/health", ["`/api/health`", "/api/health"]],
      ["Use https:// or http://.", ["https://", "http://"]],
    ];
    for (const [value, expected] of positiveCases) {
      expect(executableTokens(value), value).toEqual(expected);
    }

    const negativeCases: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["{{}}", []],
      ["{{ value\n}}", ["\n"]],
      ["<123>", []],
      ["< strong>", []],
      ["`multi\nline`", ["\n"]],
    ];
    for (const [value, expected] of negativeCases) {
      expect(executableTokens(value), value).toEqual(expected);
    }

    expect(
      [
        ..."Apple, Stripe-like and UMF Support.".matchAll(PROTECTED_STRUCTURE),
      ].map((match) => match[0]),
    ).toEqual(["Apple", "Stripe", "UMF Support"]);
    expect(
      [
        ..."PineApple and Caddying are ordinary words.".matchAll(
          PROTECTED_STRUCTURE,
        ),
      ].map((match) => match[0]),
    ).toEqual([]);
    expect(
      [..."API HTML URL CPU".matchAll(PROTECTED_STRUCTURE)].map(
        (match) => match[0],
      ),
    ).toEqual(["API", "HTML", "URL", "CPU"]);
    expect(
      [..."MEMBER ACCOUNT EEA BCC".matchAll(PROTECTED_STRUCTURE)].map(
        (match) => match[0],
      ),
    ).toEqual([]);
  });

  it("rejects unusable values in complete catalogues and regional overrides", () => {
    expect(isUsableTranslationValue("")).toBe(false);
    expect(isUsableTranslationValue("Replacement \uFFFD character")).toBe(
      false,
    );
    expect(isUsableTranslationValue("undefined")).toBe(false);
    expect(isUsableTranslationValue("Value is undefined here")).toBe(false);
    expect(isUsableTranslationValue("Valor regional válido")).toBe(true);
  });

  it("reports generated semantic residuals and requires pinned exceptions", () => {
    const catalogs = {
      en: {
        english: "Account ready",
        spanish: "Different English",
        other: "Different again",
        residualEnglish: "Source A",
        residualSpanish: "Source B",
        placeholder: "Trial for {{facility}}",
        structuralOnly: "{{facility}} · {{status}}",
        structuralPeer: "{{facility}} / {{status}}",
      },
      es: {
        english: "Cuenta distinta",
        spanish: "Cuenta lista",
        other: "Otra distinta",
        residualEnglish: "Origen A",
        residualSpanish: "Origen B",
        placeholder: "Prueba para {{facility}}",
        structuralOnly: "{{facility}} · {{status}}",
        structuralPeer: "{{facility}} - {{status}}",
      },
      it: {
        english: "Conto pronto",
        spanish: "Altro",
        other: "Valore condiviso",
        residualEnglish: "Altro A",
        residualSpanish: "Altro B",
        placeholder: "Prova per {{facility}}",
        structuralOnly: "{{facility}} · {{status}}",
        structuralPeer: "{{facility}} · {{status}}",
      },
    };
    const values = {
      english: "Account ready",
      spanish: "Cuenta lista",
      other: "Valore condiviso",
      residualEnglish: "Compte account prêt",
      residualSpanish: "Compte cuenta prêt",
      placeholder: "Essai pour {{facility}}",
      structuralOnly: "{{facility}} · {{status}}",
      structuralPeer: "{{facility}} · {{status}}",
    };
    const findings = generatedSemanticFindings({
      locale: "fr",
      values,
      catalogs,
    });
    expect(
      findings.map(({ key, kind, evidence }) => ({ key, kind, evidence })),
    ).toEqual([
      { key: "english", kind: "exact-en", evidence: "en" },
      { key: "english", kind: "residual-en", evidence: "account" },
      { key: "spanish", kind: "exact-es", evidence: "es" },
      { key: "spanish", kind: "residual-es", evidence: "cuenta" },
      { key: "other", kind: "exact-other", evidence: "it" },
      { key: "residualEnglish", kind: "residual-en", evidence: "account" },
      { key: "residualSpanish", kind: "residual-es", evidence: "cuenta" },
    ]);
    const [approved] = findings;
    const exception: GeneratedSemanticException = {
      ...approved,
      reason: "Reviewed synthetic fixture",
    };
    expect(unapprovedSemanticFindings([approved], [exception])).toEqual([]);
    expect(
      unapprovedSemanticFindings(
        [approved],
        [{ ...exception, valueSha256: "stale-hash" }],
      ),
    ).toEqual([approved]);
  });

  it("limits reviewed residual terms to their documented locale", () => {
    const catalogs = {
      en: { reviewed: "Different", residual: "Different again" },
      es: { reviewed: "Distinto", residual: "Otro distinto" },
    };
    const values = {
      reviewed: "Gestisci l'account e la password",
      residual: "Delete l'account",
    };

    expect(
      generatedSemanticFindings({ locale: "it", values, catalogs }).map(
        ({ key, kind, evidence }) => ({ key, kind, evidence }),
      ),
    ).toEqual([{ key: "residual", kind: "residual-en", evidence: "delete" }]);
    expect(
      generatedSemanticFindings({ locale: "fr", values, catalogs }).map(
        ({ key, kind, evidence }) => ({ key, kind, evidence }),
      ),
    ).toEqual([
      { key: "reviewed", kind: "residual-en", evidence: "account" },
      { key: "reviewed", kind: "residual-en", evidence: "password" },
      { key: "residual", kind: "residual-en", evidence: "account" },
      { key: "residual", kind: "residual-en", evidence: "delete" },
    ]);

    expect(
      generatedSemanticFindings({
        locale: "ca",
        values: { reviewed: "Administrador i entrenador" },
        catalogs,
      }),
    ).toEqual([]);
    expect(
      generatedSemanticFindings({
        locale: "gl",
        values: { reviewed: "Administrador e entrenador" },
        catalogs,
      }).map(({ kind, evidence }) => ({ kind, evidence })),
    ).toEqual([{ kind: "residual-es", evidence: "entrenador" }]);
    expect(
      generatedSemanticFindings({
        locale: "gl",
        values: {
          reviewed: "Administrador: eliminar, facturación e iniciar sesión",
        },
        catalogs,
      }),
    ).toEqual([]);
  });

  it.skipIf(!process.env.LOCALIZATION_PILOT_PATH)(
    "audits a generated pilot evidence file before linguistic review",
    () => {
      const configuredPath = process.env.LOCALIZATION_PILOT_PATH;
      if (!configuredPath)
        throw new Error("LOCALIZATION_PILOT_PATH is required");
      const pilotPath = resolve(configuredPath);
      const pilot = JSON.parse(
        readFileSync(pilotPath, "utf8"),
      ) as LocalizationPilotEvidence;
      const expectedPilotKeys = localizationPolicy.sensitiveReviewKeys;
      const spanish = flatten(readLocale("es"));
      const values = Object.fromEntries(
        pilot.entries.map(({ key, target }) => [key, target]),
      );
      const sources = Object.fromEntries(
        pilot.entries.map(({ key, source }) => [key, source]),
      );

      expect(pilot).toMatchObject({
        locale: "fr",
        model: localizationPolicy.pilotModel.id,
        revision: localizationPolicy.pilotModel.revision,
        license: localizationPolicy.pilotModel.license,
        weightFile: localizationPolicy.pilotModel.weightFile,
        weightSha256: localizationPolicy.pilotModel.weightSha256,
        promptDate: localizationPolicy.pilotModel.promptDate,
        catalogKeyCount: Object.keys(english).length,
        sampleCount: expectedPilotKeys.length,
      });
      expect(pilot.translatedSegmentCount).toBeGreaterThan(0);
      expect(pilot.entries.map(({ key }) => key)).toEqual(expectedPilotKeys);
      expect(new Set(pilot.entries.map(({ key }) => key)).size).toBe(
        expectedPilotKeys.length,
      );
      for (const entry of pilot.entries) {
        expect(Object.keys(entry).sort(), entry.key).toEqual([
          "key",
          "source",
          "target",
        ]);
        expect(entry.source, entry.key).toBe(english[entry.key]);
        expect(isUsableTranslationValue(entry.target), entry.key).toBe(true);
      }
      expect(pilot.reviewGlossary).toEqual(
        localizationPolicy.pilotTargets.fr.reviewGlossary,
      );
      expect(pilot.language).toEqual(localizationPolicy.languageTables.fr);
      expect(pilot.policySha256).toBe(
        fileHash(resolve("scripts/localization-policy.json")),
      );
      expect(pilot.sourceCatalogSha256).toBe(
        fileHash(resolve("client/src/i18n/locales/en.json")),
      );
      expect(pilot.comparisonCatalogSha256).toBe(
        fileHash(resolve("client/src/i18n/locales/es.json")),
      );
      expect(pilot.generatorSha256).toBe(
        fileHash(resolve(".translation-generate-locales.py")),
      );
      expect(pilot.sourceSegmentsSha256).toBe(
        structureHash(
          pilot.entries.map(({ key, source }) => ({ key, source })),
        ),
      );

      const cacheRoot = resolve(dirname(pilotPath), "..", "..", "..");
      expect(isAbsolute(pilot.manifestRelativePath)).toBe(false);
      expect(pilot.manifestRelativePath).not.toContain("\\");
      expect(pilot.manifestRelativePath.split("/")).not.toContain("..");
      const manifestPath = resolve(cacheRoot, pilot.manifestRelativePath);
      const relativeManifestPath = relative(cacheRoot, manifestPath);
      expect(isAbsolute(relativeManifestPath)).toBe(false);
      expect(relativeManifestPath).not.toBe("..");
      expect(relativeManifestPath.startsWith(`..${sep}`)).toBe(false);
      expect(pilot.manifestFile).toBe(
        pilot.manifestRelativePath.split("/").at(-1),
      );
      expect(pilot.manifestSha256).toBe(fileHash(manifestPath));
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        model: string;
        license: string;
        weightFile: string;
        weightSha256: string;
        requestedRevision: string;
        effectiveSnapshot: string;
        snapshotPathKind: string;
        useSafetensors: boolean;
        generation: Record<string, unknown>;
        reviewGlossaries: Record<string, Record<string, string>>;
        runtime: {
          python: string;
          dtype: string;
          device: string;
          packages: Record<string, { version: string; recordSha256: string }>;
        };
        inputs: Record<string, string>;
        artifacts: Array<{ path: string; size: number; sha256: string }>;
      };
      expect(manifest).toMatchObject({
        model: pilot.model,
        license: pilot.license,
        weightFile: pilot.weightFile,
        weightSha256: pilot.weightSha256,
        requestedRevision: pilot.revision,
        effectiveSnapshot: pilot.revision,
        snapshotPathKind: "direct-local-copy",
        useSafetensors: true,
        generation: {
          doSample: false,
          numBeams: 1,
          batchSize: 1,
          attentionMask: "explicit tokenizer attention_mask",
        },
        reviewGlossaries: { fr: pilot.reviewGlossary },
        runtime: {
          python: expect.stringMatching(/^\d+\.\d+\.\d+$/),
          dtype: "bfloat16",
          device: "cpu",
        },
      });
      expect(manifest.inputs).toMatchObject({
        policySha256: pilot.policySha256,
        sourceCatalogSha256: pilot.sourceCatalogSha256,
        comparisonCatalogSha256: pilot.comparisonCatalogSha256,
        generatorSha256: pilot.generatorSha256,
      });
      expect(Object.keys(manifest.runtime.packages).sort()).toEqual(
        [
          "hf-xet",
          "huggingface-hub",
          "protobuf",
          "sentencepiece",
          "tokenizers",
          "torch",
          "transformers",
        ].sort(),
      );
      for (const runtimePackage of Object.values(manifest.runtime.packages)) {
        expect(runtimePackage).toMatchObject({
          version: expect.stringMatching(/^\d+(?:\.\d+)+(?:[^\s]*)?$/),
          recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
      }
      expect(
        manifest.artifacts.filter(({ path }) =>
          /\.(?:safetensors|bin|gguf|ot)$/i.test(path),
        ),
      ).toEqual([
        {
          path: pilot.weightFile,
          size: expect.any(Number),
          sha256: pilot.weightSha256,
        },
      ]);

      expect(invalidGeneratedCatalogKeys("fr", values, sources)).toEqual([]);
      expect(
        unapprovedSemanticFindings(
          generatedSemanticFindings({
            locale: "fr",
            values,
            catalogs: { en: english, es: spanish },
          }),
        ),
      ).toEqual([]);
    },
  );

  it("keeps semantic exceptions in one-to-one correspondence with current findings", () => {
    const catalogs = Object.fromEntries(
      ["en", "es", ...localizationPolicy.generatedFullCatalogLocales].map(
        (locale) => [locale, flatten(readLocale(locale))],
      ),
    );
    const findings = localizationPolicy.generatedFullCatalogLocales.flatMap(
      (locale) =>
        generatedSemanticFindings({
          locale,
          values: catalogs[locale],
          catalogs,
        }),
    );
    const signature = (value: GeneratedSemanticFinding) =>
      [
        value.locale,
        value.key,
        value.kind,
        value.evidence,
        value.valueSha256,
      ].join("\u0000");
    const exceptionSignatures =
      localizationPolicy.generatedSemanticExceptions.map((exception) =>
        signature(exception as GeneratedSemanticFinding),
      );

    expect(
      localizationPolicy.generatedSemanticExceptions.every(
        (exception) => exception.reason.trim() !== "",
      ),
    ).toBe(true);
    expect(new Set(exceptionSignatures).size).toBe(exceptionSignatures.length);
    expect(exceptionSignatures.sort()).toEqual(findings.map(signature).sort());
  });

  it.each(localizationPolicy.generatedFullCatalogLocales)(
    "%s generated catalogue passes semantic audit",
    (locale) => {
      const availableCatalogs = new Set(
        readdirSync(resolve("client/src/i18n/locales"))
          .filter((name) => name.endsWith(".json"))
          .map((name) => name.slice(0, -".json".length)),
      );
      const peerLocales = localizationPolicy.generatedFullCatalogLocales.filter(
        (candidate) => availableCatalogs.has(candidate),
      );
      const catalogs = Object.fromEntries(
        ["en", "es", ...peerLocales].map((candidate) => [
          candidate,
          flatten(readLocale(candidate)),
        ]),
      );
      const values = flatten(readLocale(locale));
      const findings = generatedSemanticFindings({ locale, values, catalogs });

      expect(unapprovedSemanticFindings(findings)).toEqual([]);
      expect(readLocale(locale).language).toEqual(
        localizationPolicy.languageTables[locale],
      );
    },
  );
});

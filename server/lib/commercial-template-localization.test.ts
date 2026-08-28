import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommercialFacilityType } from "../db/types.js";
import { commercialTemplates } from "./commercial-trial.js";
import {
  completeCommercialTemplateLocales,
  commercialTemplateActivityKeys,
  commercialTemplateActivityLabels,
  localizedCommercialTemplateClassTypes,
  type CommercialTemplateActivityKey,
} from "./commercial-template-localization.js";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./supported-locales.js";

const facilityTypes = Object.keys(
  commercialTemplateActivityKeys,
) as CommercialFacilityType[];

function catalogLocale(locale: SupportedLocale) {
  if (locale === "de-CH") return "de";
  if (locale === "ca-valencia") return "ca";
  return locale;
}

describe("commercial template activity localization", () => {
  it("matches the versioned client catalogues exactly", () => {
    for (const locale of completeCommercialTemplateLocales) {
      const catalogue = JSON.parse(
        readFileSync(
          path.resolve("client", "src", "i18n", "locales", `${locale}.json`),
          "utf8",
        ),
      ) as {
        commercial: {
          trial: {
            templateClassTypes: Record<CommercialTemplateActivityKey, string>;
          };
        };
      };

      expect(commercialTemplateActivityLabels[locale]).toEqual(
        catalogue.commercial.trial.templateClassTypes,
      );
    }
  });

  it("covers all fourteen types and eleven platform locales", () => {
    expect(facilityTypes).toHaveLength(14);
    expect(SUPPORTED_LOCALES).toHaveLength(11);
    expect(completeCommercialTemplateLocales).toHaveLength(9);

    let checkedPairs = 0;
    for (const locale of SUPPORTED_LOCALES) {
      const labels = commercialTemplateActivityLabels[catalogLocale(locale)];
      for (const facilityType of facilityTypes) {
        const expected = commercialTemplateActivityKeys[facilityType].map(
          (key) => labels[key],
        );
        expect(
          localizedCommercialTemplateClassTypes(facilityType, locale),
          `${locale}/${facilityType}`,
        ).toEqual(expected);
        checkedPairs += 1;
      }
    }
    expect(checkedPairs).toBe(14 * 11);
  });

  it("keeps the historic Spanish commercial projection unchanged", () => {
    for (const facilityType of facilityTypes) {
      expect(localizedCommercialTemplateClassTypes(facilityType, "es")).toEqual(
        commercialTemplates[facilityType].classTypes,
      );
    }
  });

  it("uses explicit regional fallbacks and returns defensive copies", () => {
    for (const facilityType of facilityTypes) {
      expect(
        localizedCommercialTemplateClassTypes(facilityType, "de-CH"),
      ).toEqual(localizedCommercialTemplateClassTypes(facilityType, "de"));
      expect(
        localizedCommercialTemplateClassTypes(facilityType, "ca-valencia"),
      ).toEqual(localizedCommercialTemplateClassTypes(facilityType, "ca"));
    }

    const first = localizedCommercialTemplateClassTypes(
      "traditional_gym",
      "fr",
    );
    first[0] = "mutated by consumer";
    expect(
      localizedCommercialTemplateClassTypes("traditional_gym", "fr"),
    ).toEqual(["Accès libre à la salle", "Cours encadré"]);
  });

  it("falls back safely to Spanish for an invalid internal value", () => {
    expect(
      localizedCommercialTemplateClassTypes("hyrox", "invalid-locale"),
    ).toEqual(["HYROX", "Técnica de estaciones"]);
  });
});

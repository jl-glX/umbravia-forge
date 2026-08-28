import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  institutionalPrincipleIds,
  institutionalPrinciples,
  institutionalPrinciplesResponse,
} from "./community-policy.js";

describe("community institutional principle contract", () => {
  it("keeps the legacy textual response unchanged", () => {
    expect(institutionalPrinciplesResponse(undefined)).toEqual({
      neutrality:
        "La plataforma no condiciona el acceso a adhesiones políticas, religiosas o ideológicas.",
      reciprocity:
        "La libertad, privacidad y dignidad de cada persona exigen el mismo respeto hacia usuarios, centros y plataforma.",
      conductBasedModeration:
        "Las decisiones se basan en conducta, contexto, pruebas, daño, reiteración, gravedad y proporcionalidad.",
    });
    expect(Object.keys(institutionalPrinciples)).toEqual([
      ...institutionalPrincipleIds,
    ]);
    expect(institutionalPrinciplesResponse("unknown-format")).toEqual(
      institutionalPrinciplesResponse(undefined),
    );

    const spanishCatalogue = JSON.parse(
      readFileSync(
        path.resolve("client", "src", "i18n", "locales", "es.json"),
        "utf8",
      ),
    ) as {
      community: { institutionalPrinciples: Record<string, string> };
    };
    expect(institutionalPrinciples).toEqual(
      spanishCatalogue.community.institutionalPrinciples,
    );
  });

  it("offers a versioned response containing ids and no Spanish prose", () => {
    const response = institutionalPrinciplesResponse("keys");

    expect(response).toEqual({
      version: 2,
      principleIds: institutionalPrincipleIds,
    });
    expect(JSON.stringify(response)).not.toContain(
      institutionalPrinciples.neutrality,
    );
  });
});

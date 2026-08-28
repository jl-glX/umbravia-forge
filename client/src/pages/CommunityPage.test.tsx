import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readCommunityPrincipleIds } from "../lib/community-principles";
import { CommunityPrinciplesCard } from "./CommunityPage";

const pageMocks = vi.hoisted(() => ({
  translatedPrinciples: {
    "community.principles": "Principis institucionals",
    "community.institutionalPrinciples.neutrality": "Neutralitat localitzada",
    "community.institutionalPrinciples.reciprocity": "Reciprocitat localitzada",
    "community.institutionalPrinciples.conductBasedModeration":
      "Moderació localitzada",
  } as Record<string, string>,
}));

vi.mock("../components/VerifiedForm", () => ({
  VerifiedForm: () => null,
}));
vi.mock("../components/FacilityLinksPanel", () => ({
  FacilityLinksPanel: () => null,
}));
vi.mock("../components/ui/button", () => ({ Button: () => null }));
vi.mock("../components/ui/card", async () => {
  const { createElement } = await import("react");
  return {
    Card: ({ children, ...props }: Record<string, unknown>) =>
      createElement("section", props, children as never),
  };
});
vi.mock("../components/ui/input", () => ({ Input: () => null }));
vi.mock("../components/ui/label", () => ({ Label: () => null }));
vi.mock("../components/ui/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("../context/auth-context", () => ({
  getAccessRole: () => "member",
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../lib/api", () => ({ authFetch: vi.fn() }));
vi.mock("../i18n/supported-locales", () => ({
  resolveIntlLocale: () => "ca-ES",
}));
vi.mock("react-router-dom", () => ({ Link: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => pageMocks.translatedPrinciples[key] ?? key,
    i18n: { language: "ca", resolvedLanguage: "ca" },
  }),
}));

function renderPolicy(response: unknown) {
  return renderToStaticMarkup(
    createElement(CommunityPrinciplesCard, {
      principles: readCommunityPrincipleIds(response),
    }),
  );
}

describe("CommunityPage institutional principles", () => {
  it.each([
    [
      "v2 ids",
      {
        version: 2,
        principleIds: ["neutrality", "reciprocity", "conductBasedModeration"],
      },
    ],
    [
      "legacy v1 prose",
      {
        neutrality: "SERVER LEGACY NEUTRALITY",
        reciprocity: "SERVER LEGACY RECIPROCITY",
        conductBasedModeration: "SERVER LEGACY MODERATION",
      },
    ],
  ])("renders local translations for %s", (_label, response) => {
    const markup = renderPolicy(response);

    expect(markup).toContain("Principis institucionals");
    expect(markup).toContain("Neutralitat localitzada");
    expect(markup).toContain("Reciprocitat localitzada");
    expect(markup).toContain("Moderació localitzada");
    expect(markup).not.toContain("SERVER LEGACY");
  });

  it.each([
    null,
    {},
    { version: 2, principleIds: ["unknown"] },
    {
      version: 3,
      neutrality: "future text",
      reciprocity: "future text",
      conductBasedModeration: "future text",
    },
  ])("does not render an empty or unsupported policy card %#", (response) => {
    expect(renderPolicy(response)).toBe("");
  });
});

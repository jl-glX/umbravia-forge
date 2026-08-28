// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import type {
  CommercialTrial,
  CommercialTrialOverview,
} from "../lib/commercial";
import {
  CommercialTrialDataReviewCard,
  CommercialTrialEnvironmentCard,
  CommercialTrialLanguageValue,
  CommercialTrialPage,
} from "./CommercialTrialPage";
import { sortedLanguageOptions } from "../i18n/language-options";
import {
  CommercialTrialRequestError,
  formatCommercialTrialRequestError,
  readCommercialTrialResponse,
} from "../lib/commercial-trial-errors";

const pageMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  translate: vi.fn((key: string) => {
    const labels: Record<string, string> = {
      "language.caValencia": "Valencià",
      "language.ocAranes": "Aranés",
    };
    return labels[key] ?? key;
  }),
}));

vi.mock("../lib/api", () => ({ authFetch: pageMocks.authFetch }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: pageMocks.translate,
    i18n: { language: "es", resolvedLanguage: "es" },
  }),
}));

vi.mock("../components/ui/button", async () => {
  const { createElement } = await import("react");
  return {
    Button: ({ children, ...props }: Record<string, unknown>) =>
      createElement("button", props, children as never),
  };
});
vi.mock("../components/ui/card", async () => {
  const { createElement } = await import("react");
  return {
    Card: ({ children, ...props }: Record<string, unknown>) =>
      createElement("section", props, children as never),
  };
});
vi.mock("../components/ui/input", async () => {
  const { createElement } = await import("react");
  return {
    Input: (props: Record<string, unknown>) => createElement("input", props),
  };
});
vi.mock("../components/ui/label", async () => {
  const { createElement } = await import("react");
  return {
    Label: ({ children, ...props }: Record<string, unknown>) =>
      createElement("label", props, children as never),
  };
});

const t = ((key: string) => key) as TFunction;

describe("commercial trial locale summary", () => {
  const languageNames: Record<string, string> = {
    "language.caValencia": "Valencià",
    "language.ocAranes": "Aranés",
  };
  const languageOptions = sortedLanguageOptions(
    (key) => languageNames[key] ?? key,
    "es",
  );

  it.each([
    ["ca-valencia", "Valencià"],
    ["oc-aranes", "Aranés"],
  ] as const)(
    "renders the localized %s label while preserving the canonical code",
    (locale, label) => {
      const markup = renderToStaticMarkup(
        createElement(CommercialTrialLanguageValue, {
          locale,
          languageOptions,
        }),
      );

      expect(markup).toContain(`data-locale-code="${locale}"`);
      expect(markup).toContain(`>${label}</dd>`);
      expect(markup).not.toContain(`>${locale}</dd>`);
      expect(
        languageOptions.find((option) => option.code === locale)?.code,
      ).toBe(locale);
    },
  );
});

const baseTrial = {
  id: "trial-1",
  facilityName: "Umbravia Test",
  facilityType: "traditional_gym",
  approximateMembers: 20,
  trainerCount: 2,
  spaceCount: 1,
  usualCapacity: 12,
  classTypes: ["Strength"],
  scheduleNotes: "",
  publicDescription: "",
  addressLine: "",
  city: "",
  postalCode: "",
  country: "ES",
  websiteUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  tiktokUrl: "",
  youtubeUrl: "",
  linkedinUrl: "",
  pricingDescription: "",
  bonusesDescription: "",
  publicPageEnabled: false,
  showPhonePublicly: false,
  locale: "es",
  currency: "EUR",
  usesBookings: true,
  usesWaitlist: true,
  status: "trial_active",
  subdomain: "umbravia-test",
  realDataDeclaration: "undeclared",
  autoCleanupEligible: false,
  dataReviewRequestedAt: null,
  cleanupEligibleAt: null,
  startedAt: 1,
  expiresAt: 86_400_000,
  notice: { elapsedDays: 0, remainingDays: 1, milestone: 0 },
} satisfies CommercialTrial;

function overview(
  dataReview: NonNullable<CommercialTrialOverview["dataReview"]>,
  trial: Partial<CommercialTrialOverview["trial"]> = {},
): CommercialTrialOverview {
  return {
    trial: {
      ...baseTrial,
      ...trial,
    },
    dataReview,
    branding: { logoDataUrl: "", accentColor: "#2563eb" },
    environment: {
      isolation: "shared_local_demo",
      routing: "not_provisioned",
      subdomainMeaning: "reserved_identifier",
      tenantOrigin: null,
      tenantBaseDomain: null,
      counts: { users: 2 },
      modules: [],
      restorationScope: "commercial_configuration_only",
    },
    events: [],
  } satisfies CommercialTrialOverview;
}

describe("commercial trial locale flow", () => {
  it.each([
    {
      existing: false,
      locale: "ca-valencia",
      label: "Valencià",
      method: "POST",
    },
    {
      existing: true,
      locale: "oc-aranes",
      label: "Aranés",
      method: "PATCH",
    },
  ] as const)(
    "keeps $locale canonical from the real selector through $method and the summary",
    async ({ existing, locale, label, method }) => {
      const dataReview: NonNullable<CommercialTrialOverview["dataReview"]> = {
        visible: false,
        canDeclare: false,
        opensAt: null,
        serverNow: 1,
        declarationBlockReason: "not-open",
      };
      const initial = existing ? overview(dataReview, { locale: "es" }) : null;
      const saved = overview(dataReview, { locale });
      pageMocks.authFetch.mockReset();
      pageMocks.authFetch.mockImplementation(
        async (path: string, init?: RequestInit) => {
          if (path === "/api/commercial/trial/setup") {
            return new Response(JSON.stringify({ tenantBaseDomain: null }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path === "/api/commercial/trial" && init?.method === method) {
            const body = JSON.parse(String(init.body)) as { locale: string };
            return new Response(
              JSON.stringify({
                ...saved,
                trial: { ...saved.trial, locale: body.locale },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          if (path === "/api/commercial/trial") {
            return new Response(JSON.stringify(initial), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw new Error(`Unexpected request: ${path}`);
        },
      );

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(createElement(CommercialTrialPage));
          await new Promise((resolve) => setTimeout(resolve, 0));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });

        if (!existing) {
          const name =
            container.querySelector<HTMLInputElement>("#facilityName")!;
          await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )?.set;
            setter?.call(name, "Centro de prueba");
            name.dispatchEvent(new Event("input", { bubbles: true }));
          });
        }

        const localeSelect =
          container.querySelector<HTMLSelectElement>("#locale")!;
        const targetOption = localeSelect.querySelector<HTMLOptionElement>(
          `option[value="${locale}"]`,
        )!;
        expect(targetOption.textContent).toBe(label);
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
          )?.set;
          setter?.call(localeSelect, locale);
          localeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(localeSelect.value).toBe(locale);

        for (let step = 1; step < 8; step += 1) {
          const next = Array.from(
            container.querySelectorAll<HTMLButtonElement>("button"),
          ).find(
            (button) =>
              button.textContent?.trim() === "commercial.trial.wizard.next",
          );
          expect(next).toBeDefined();
          await act(async () => next!.click());
        }

        const summary = container.querySelector<HTMLElement>(
          `[data-locale-code="${locale}"]`,
        );
        expect(summary?.textContent).toBe(label);
        expect(summary?.textContent).not.toBe(locale);

        await act(async () => {
          container
            .querySelector("form")!
            .dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            );
          await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const saveCall = pageMocks.authFetch.mock.calls.find(
          ([path, init]) =>
            path === "/api/commercial/trial" &&
            (init as RequestInit | undefined)?.method === method,
        );
        expect(saveCall).toBeDefined();
        expect(
          JSON.parse(String((saveCall![1] as RequestInit).body)),
        ).toMatchObject({
          locale,
        });
        expect(
          container.querySelector(`[data-locale-code="${locale}"]`)
            ?.textContent,
        ).toBe(label);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
});

describe("commercial trial data-review cards", () => {
  const closedReview: NonNullable<CommercialTrialOverview["dataReview"]> = {
    visible: false,
    canDeclare: false,
    opensAt: 1_000,
    serverNow: 999,
    declarationBlockReason: "not-open",
  };

  it("keeps the environment visible and removes the entire review before opening", () => {
    const current = overview(closedReview);
    const environment = renderToStaticMarkup(
      createElement(CommercialTrialEnvironmentCard, {
        overview: current,
        saving: false,
        t,
        onRestore: vi.fn(),
      }),
    );
    const review = renderToStaticMarkup(
      createElement(CommercialTrialDataReviewCard, {
        overview: current,
        saving: false,
        t,
        onDeclare: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(environment).toContain("commercial.trial.environment.title");
    expect(environment).toContain('data-testid="trial-environment-card"');
    expect(review).toBe("");
    expect(review).not.toContain("commercial.trial.dataReview.title");
  });

  it("fails closed for a legacy overview without dataReview", () => {
    const { dataReview: _dataReview, ...legacy } = overview(closedReview);
    const current: CommercialTrialOverview = legacy;
    const environment = renderToStaticMarkup(
      createElement(CommercialTrialEnvironmentCard, {
        overview: current,
        saving: false,
        t,
        onRestore: vi.fn(),
      }),
    );
    const review = renderToStaticMarkup(
      createElement(CommercialTrialDataReviewCard, {
        overview: current,
        saving: false,
        t,
        onDeclare: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(environment).toContain("commercial.trial.environment.title");
    expect(review).toBe("");
  });

  it("shows the review and its three decisions at the opening boundary", () => {
    const current = overview({
      ...closedReview,
      visible: true,
      canDeclare: true,
      serverNow: 1_000,
      declarationBlockReason: null,
    });
    const markup = renderToStaticMarkup(
      createElement(CommercialTrialDataReviewCard, {
        overview: current,
        saving: false,
        t,
        onDeclare: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('data-testid="trial-data-review-card"');
    expect(markup).toContain("commercial.trial.dataReview.title");
    for (const decision of ["yes", "no", "assistance"]) {
      expect(markup).toContain(`commercial.trial.dataReview.${decision}`);
    }
    expect(markup.match(/<button/g)).toHaveLength(3);
  });

  it("shows a recorded decision without declaration buttons", () => {
    const current = overview(
      {
        ...closedReview,
        visible: true,
        canDeclare: false,
        serverNow: 1_001,
        declarationBlockReason: "already-declared",
      },
      { status: "trial_conversion_review", realDataDeclaration: "yes" },
    );
    const markup = renderToStaticMarkup(
      createElement(CommercialTrialDataReviewCard, {
        overview: current,
        saving: false,
        t,
        onDeclare: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain("commercial.trial.dataReview.states.yes");
    expect(markup).not.toContain("<button");
  });

  it.each([
    ["yes", "trial_conversion_review"],
    ["no", "trial_closed"],
    ["assistance", "trial_paused_support"],
  ] as const)(
    "keeps a legacy %s decision hidden before opening and shows it at the boundary",
    (realDataDeclaration, status) => {
      const hidden = overview(
        {
          visible: false,
          canDeclare: false,
          opensAt: 1_000,
          serverNow: 999,
          declarationBlockReason: "already-declared",
        },
        { status, realDataDeclaration },
      );
      expect(
        renderToStaticMarkup(
          createElement(CommercialTrialDataReviewCard, {
            overview: hidden,
            saving: false,
            t,
            onDeclare: vi.fn(),
            onClose: vi.fn(),
          }),
        ),
      ).toBe("");

      const visible = overview(
        {
          ...hidden.dataReview!,
          visible: true,
          serverNow: 1_000,
        },
        { status, realDataDeclaration },
      );
      const markup = renderToStaticMarkup(
        createElement(CommercialTrialDataReviewCard, {
          overview: visible,
          saving: false,
          t,
          onDeclare: vi.fn(),
          onClose: vi.fn(),
        }),
      );
      expect(markup).toContain(
        `commercial.trial.dataReview.states.${realDataDeclaration}`,
      );
      expect(markup).not.toContain("<button");
    },
  );

  it("keeps the environment but removes the review once cleanup starts", () => {
    const current = overview({
      ...closedReview,
      opensAt: 900,
      serverNow: 1_100,
      declarationBlockReason: "cleanup-started",
    });
    const environment = renderToStaticMarkup(
      createElement(CommercialTrialEnvironmentCard, {
        overview: current,
        saving: false,
        t,
        onRestore: vi.fn(),
      }),
    );
    const review = renderToStaticMarkup(
      createElement(CommercialTrialDataReviewCard, {
        overview: current,
        saving: false,
        t,
        onDeclare: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(environment).toContain("commercial.trial.environment.title");
    expect(review).toBe("");
  });

  it("localizes failures without exposing server, parser or network details", async () => {
    expect(
      formatCommercialTrialRequestError(
        new CommercialTrialRequestError(
          "The real-data review is not available",
          "COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN",
        ),
        t,
      ),
    ).toBe("commercial.trial.requestFailed");
    expect(
      formatCommercialTrialRequestError(
        new CommercialTrialRequestError(
          "Internal persistence detail",
          "COMMERCIAL_TRIAL_FUTURE_FAILURE",
        ),
        t,
      ),
    ).toBe("commercial.trial.requestFailed");
    expect(
      formatCommercialTrialRequestError(new Error("Network parser detail"), t),
    ).toBe("commercial.trial.requestFailed");

    const internalDetail = "DATABASE_CONNECTION_PASSWORD_MISMATCH";
    const response = new Response(
      JSON.stringify({
        error: internalDetail,
        code: "COMMERCIAL_TRIAL_FUTURE_FAILURE",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    let renderedError = "";
    try {
      await readCommercialTrialResponse(response);
    } catch (cause) {
      renderedError = formatCommercialTrialRequestError(cause, t);
    }
    expect(renderedError).toBe("commercial.trial.requestFailed");
    expect(renderedError).not.toContain(internalDetail);

    const invalidJson = new Response("{not-json", { status: 502 });
    try {
      await readCommercialTrialResponse(invalidJson);
    } catch (cause) {
      renderedError = formatCommercialTrialRequestError(cause, t);
    }
    expect(renderedError).toBe("commercial.trial.requestFailed");
    expect(renderedError).not.toContain("not-json");
  });

  it.each([
    [
      "COMMERCIAL_TRIALS_DISABLED",
      "commercial.trial.errors.provisioningDisabled",
    ],
    ["COMMERCIAL_TRIAL_NOT_EDITABLE", "commercial.trial.errors.notEditable"],
    [
      "COMMERCIAL_TRIAL_SUBDOMAIN_INVALID",
      "commercial.trial.errors.subdomainInvalid",
    ],
    [
      "COMMERCIAL_TRIAL_SUBDOMAIN_UNAVAILABLE",
      "commercial.trial.errors.subdomainUnavailable",
    ],
    [
      "COMMERCIAL_TRIAL_SUBDOMAIN_LOCKED",
      "commercial.trial.errors.subdomainLocked",
    ],
    ["COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN", "commercial.trial.requestFailed"],
  ])("maps the known %s response to %s", (code, expectedKey) => {
    expect(
      formatCommercialTrialRequestError(
        new CommercialTrialRequestError("private detail", code),
        t,
      ),
    ).toBe(expectedKey);
  });

  it.each([
    [0, 1],
    [61, 2],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    ["private", 1],
    [null, 1],
  ])(
    "rounds an edit cooldown of %i seconds to %i minutes",
    (seconds, count) => {
      const localized = vi.fn((key: string) => key) as unknown as TFunction;
      expect(
        formatCommercialTrialRequestError(
          new CommercialTrialRequestError(
            "private detail",
            "COMMERCIAL_TRIAL_EDIT_COOLDOWN",
            seconds,
          ),
          localized,
        ),
      ).toBe("commercial.trial.errors.editCooldown");
      expect(localized).toHaveBeenCalledWith(
        "commercial.trial.errors.editCooldown",
        { count },
      );
    },
  );
});

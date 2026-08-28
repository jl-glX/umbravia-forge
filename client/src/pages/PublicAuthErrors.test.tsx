// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAuthErrorCode } from "../lib/public-auth-errors";
import { LoginPage } from "./LoginPage";
import { SignupPage } from "./SignupPage";

const authState = vi.hoisted(() => ({
  error: null as PublicAuthErrorCode | null,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    login: vi.fn(),
    loginWithPasskey: vi.fn(),
    verifyMfa: vi.fn(),
    signup: vi.fn(),
    isLoading: false,
    error: authState.error,
    clearError: vi.fn(),
  }),
}));
vi.mock("react-router-dom", async () => {
  const { createElement } = await import("react");
  return {
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Link: ({ children }: { children?: unknown }) =>
      createElement("a", null, children as never),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `translated:${key}`,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => false,
  platformAuthenticatorIsAvailable: vi.fn(),
}));
vi.mock("../components/AuthShell", async () => {
  const { createElement } = await import("react");
  return {
    AuthShell: ({ children }: { children?: unknown }) =>
      createElement("main", null, children as never),
  };
});
vi.mock("../components/AuthAccessMenu", () => ({
  AuthAccessMenu: () => null,
}));
vi.mock("../components/SavedAccountSelector", () => ({
  SavedAccountSelector: () => null,
}));
vi.mock("../components/CaptchaWidget", () => ({
  CaptchaWidget: () => createElement("div", { "data-testid": "captcha" }),
}));
vi.mock("../components/PasswordInput", () => ({
  PasswordInput: (props: Record<string, unknown>) =>
    createElement("input", props),
}));
vi.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: unknown }) =>
    createElement("button", props, children as never),
}));
vi.mock("../components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("../components/ui/label", () => ({
  Label: ({ children, ...props }: { children?: unknown }) =>
    createElement("label", props, children as never),
}));

describe("public auth page errors", () => {
  beforeEach(() => {
    authState.error = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("renders the known login error through the LoginPage translation", () => {
    authState.error = "INVALID_CREDENTIALS";
    const markup = renderToStaticMarkup(createElement(LoginPage));
    expect(markup).toContain("translated:auth.invalidCredentials");
    expect(markup).not.toContain("INVALID_CREDENTIALS");
  });

  it("renders unknown login failures only through the generic translation", () => {
    authState.error = "AUTH_REQUEST_FAILED";
    const markup = renderToStaticMarkup(createElement(LoginPage));
    expect(markup).toContain("translated:common.unknownError");
    expect(markup).not.toContain("AUTH_REQUEST_FAILED");
  });

  it("renders unknown signup failures only through the generic translation", () => {
    authState.error = "AUTH_REQUEST_FAILED";
    const markup = renderToStaticMarkup(createElement(SignupPage));
    expect(markup).toContain("translated:common.unknownError");
    expect(markup).not.toContain("AUTH_REQUEST_FAILED");
  });

  it("renders disabled administrator provisioning through its existing translation", () => {
    authState.error = "COMMERCIAL_TRIALS_DISABLED";
    const markup = renderToStaticMarkup(createElement(SignupPage));
    expect(markup).toContain("translated:auth.administratorSignupUnavailable");
    expect(markup).not.toContain("COMMERCIAL_TRIALS_DISABLED");
  });
});

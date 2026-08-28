// @vitest-environment jsdom

import { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../context/auth-context";
import { AuthProvider } from "./AuthProvider";

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock("../lib/api", () => ({ authFetch: mocks.authFetch }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: mocks.startAuthentication,
}));

let current: AuthContextValue | null = null;

function Probe() {
  current = useContext(AuthContext);
  return <output data-testid="auth-error">{current?.error ?? ""}</output>;
}

describe("AuthProvider public error boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    current = null;
    mocks.authFetch.mockReset();
    mocks.startAuthentication.mockReset();
    mocks.authFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(current).not.toBeNull();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function expectCanonicalFailure(run: () => Promise<unknown>) {
    let caught: unknown;
    await act(async () => {
      try {
        await run();
      } catch (cause) {
        caught = cause;
      }
    });
    expect(caught).toMatchObject({
      code: "AUTH_REQUEST_FAILED",
      message: "AUTH_REQUEST_FAILED",
    });
    expect(current?.error).toBe("AUTH_REQUEST_FAILED");
    expect(container.textContent).toBe("AUTH_REQUEST_FAILED");
    return caught;
  }

  it("normalizes a login 500 without retaining its private detail", async () => {
    const privateDetail = "LOGIN_DATABASE_PASSWORD_MISMATCH";
    mocks.authFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: privateDetail, code: "FUTURE_LOGIN_FAILURE" }),
        { status: 500 },
      ),
    );
    const caught = await expectCanonicalFailure(() =>
      current!.login(
        "person@example.com",
        "password",
        "member",
        false,
        "captcha",
      ),
    );
    expect(JSON.stringify(caught)).not.toContain(privateDetail);
    expect(container.textContent).not.toContain(privateDetail);
  });

  it("normalizes invalid JSON from signup", async () => {
    mocks.authFetch.mockResolvedValueOnce(
      new Response("{private-signup-detail", { status: 502 }),
    );
    await expectCanonicalFailure(() =>
      current!.signup({
        email: "person@example.com",
        name: "Person",
        lastName: "Test",
        password: "SafePassword123",
        countryCode: "ES",
        locale: "fr",
        acceptedTerms: true,
        acceptedPrivacy: true,
        captchaToken: "captcha",
        accountType: "member",
      }),
    );
    expect(container.textContent).not.toContain("private-signup-detail");
  });

  it("preserves the administrator provisioning code without exposing its detail", async () => {
    const privateDetail = "Commercial trial provisioning internals";
    mocks.authFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: privateDetail,
          code: "COMMERCIAL_TRIALS_DISABLED",
        }),
        { status: 503 },
      ),
    );
    let caught: unknown;
    await act(async () => {
      try {
        await current!.signup({
          email: "owner@example.com",
          name: "Owner",
          lastName: "Test",
          password: "SafePassword123",
          countryCode: "ES",
          locale: "fr",
          acceptedTerms: true,
          acceptedPrivacy: true,
          captchaToken: "captcha",
          accountType: "administrator",
          facilityName: "Test Facility",
          facilityType: "traditional_gym",
        });
      } catch (cause) {
        caught = cause;
      }
    });
    expect(caught).toMatchObject({
      code: "COMMERCIAL_TRIALS_DISABLED",
      message: "COMMERCIAL_TRIALS_DISABLED",
    });
    expect(current?.error).toBe("COMMERCIAL_TRIALS_DISABLED");
    expect(container.textContent).toBe("COMMERCIAL_TRIALS_DISABLED");
    expect(JSON.stringify(caught)).not.toContain(privateDetail);
  });

  it("normalizes a passkey network exception", async () => {
    const privateDetail = "PASSKEY_NETWORK_PROXY_DETAIL";
    mocks.authFetch.mockRejectedValueOnce(new Error(privateDetail));
    const caught = await expectCanonicalFailure(() =>
      current!.loginWithPasskey(
        "person@example.com",
        "member",
        false,
        "captcha",
      ),
    );
    expect((caught as Error).message).not.toContain(privateDetail);
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
  });

  it("normalizes an MFA success response without a user", async () => {
    mocks.authFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ internal: "MFA_USER_MISSING" }), {
        status: 200,
      }),
    );
    const caught = await expectCanonicalFailure(() =>
      current!.verifyMfa("123456"),
    );
    expect(JSON.stringify(caught)).not.toContain("MFA_USER_MISSING");
  });
});

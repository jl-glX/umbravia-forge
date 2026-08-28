import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_PUBLIC_ERROR_CODES,
  PASSKEY_PUBLIC_ERROR_CODES,
  SIGNUP_PUBLIC_ERROR_CODES,
  PublicAuthError,
  formatPublicAuthError,
  normalizePublicAuthError,
  readPublicAuthResponse,
  requirePublicAuthUser,
} from "./public-auth-errors";

const t = vi.fn((key: string) => `translated:${key}`) as unknown as TFunction;

describe("public auth errors", () => {
  it.each([
    ["INVALID_CREDENTIALS", LOGIN_PUBLIC_ERROR_CODES],
    ["PASSKEY_NOT_CONFIGURED", PASSKEY_PUBLIC_ERROR_CODES],
    ["PASSKEY_CHALLENGE_INVALID", PASSKEY_PUBLIC_ERROR_CODES],
    ["PASSKEY_VERIFICATION_FAILED", PASSKEY_PUBLIC_ERROR_CODES],
    ["COMMERCIAL_TRIALS_DISABLED", SIGNUP_PUBLIC_ERROR_CODES],
  ] as const)(
    "preserves allowlisted functional code %s",
    async (code, allowed) => {
      const response = new Response(
        JSON.stringify({ error: "private detail", code }),
        { status: 401 },
      );
      await expect(
        readPublicAuthResponse(response, allowed),
      ).rejects.toMatchObject({
        code,
        message: code,
      });
    },
  );

  it("fails closed for unknown codes, non-JSON, network errors and missing users", async () => {
    const privateDetail = "DATABASE_PASSWORD_MISMATCH";
    await expect(
      readPublicAuthResponse(
        new Response(
          JSON.stringify({ error: privateDetail, code: "FUTURE_AUTH_ERROR" }),
          { status: 500 },
        ),
        LOGIN_PUBLIC_ERROR_CODES,
      ),
    ).rejects.toMatchObject({ code: "AUTH_REQUEST_FAILED" });
    await expect(
      readPublicAuthResponse(new Response("{broken", { status: 502 })),
    ).rejects.toMatchObject({ code: "AUTH_REQUEST_FAILED" });
    expect(normalizePublicAuthError(new Error(privateDetail))).toMatchObject({
      code: "AUTH_REQUEST_FAILED",
      message: "AUTH_REQUEST_FAILED",
    });
    expect(() => requirePublicAuthUser(undefined)).toThrowError(
      new PublicAuthError("AUTH_REQUEST_FAILED"),
    );
  });

  it("localizes known codes and uses the existing generic fallback", () => {
    expect(formatPublicAuthError("INVALID_CREDENTIALS", t)).toBe(
      "translated:auth.invalidCredentials",
    );
    expect(
      formatPublicAuthError("PASSKEY_NOT_CONFIGURED", t, {
        identifier: " person@example.com ",
      }),
    ).toBe("translated:auth.passkeyNotConfigured");
    expect(formatPublicAuthError("AUTH_REQUEST_FAILED", t)).toBe(
      "translated:common.unknownError",
    );
    expect(formatPublicAuthError("COMMERCIAL_TRIALS_DISABLED", t)).toBe(
      "translated:auth.administratorSignupUnavailable",
    );
  });
});

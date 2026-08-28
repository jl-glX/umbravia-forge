import type { TFunction } from "i18next";

export const LOGIN_PUBLIC_ERROR_CODES = ["INVALID_CREDENTIALS"] as const;
export const PASSKEY_PUBLIC_ERROR_CODES = [
  "PASSKEY_NOT_CONFIGURED",
  "PASSKEY_CHALLENGE_INVALID",
  "PASSKEY_VERIFICATION_FAILED",
] as const;
export const SIGNUP_PUBLIC_ERROR_CODES = [
  "COMMERCIAL_TRIALS_DISABLED",
] as const;

type FunctionalPublicAuthErrorCode =
  | (typeof LOGIN_PUBLIC_ERROR_CODES)[number]
  | (typeof PASSKEY_PUBLIC_ERROR_CODES)[number]
  | (typeof SIGNUP_PUBLIC_ERROR_CODES)[number];

export type PublicAuthErrorCode =
  FunctionalPublicAuthErrorCode | "AUTH_REQUEST_FAILED";

export class PublicAuthError extends Error {
  constructor(readonly code: PublicAuthErrorCode) {
    super(code);
  }
}

export function normalizePublicAuthError(cause: unknown): PublicAuthError {
  return cause instanceof PublicAuthError
    ? cause
    : new PublicAuthError("AUTH_REQUEST_FAILED");
}

export function requirePublicAuthUser<T>(user: T | null | undefined): T {
  if (!user) throw new PublicAuthError("AUTH_REQUEST_FAILED");
  return user;
}

export async function readPublicAuthResponse<T>(
  response: Response,
  allowedCodes: readonly FunctionalPublicAuthErrorCode[] = [],
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PublicAuthError("AUTH_REQUEST_FAILED");
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "code" in body
        ? (body as { code?: unknown }).code
        : undefined;
    throw new PublicAuthError(
      typeof code === "string" &&
        allowedCodes.includes(code as FunctionalPublicAuthErrorCode)
        ? (code as FunctionalPublicAuthErrorCode)
        : "AUTH_REQUEST_FAILED",
    );
  }
  return body as T;
}

export function formatPublicAuthError(
  code: PublicAuthErrorCode,
  t: TFunction,
  input: { identifier?: string } = {},
): string {
  if (code === "INVALID_CREDENTIALS") return t("auth.invalidCredentials");
  if (code === "PASSKEY_NOT_CONFIGURED")
    return t("auth.passkeyNotConfigured", {
      identifier: input.identifier?.trim() ?? "",
    });
  if (code === "PASSKEY_CHALLENGE_INVALID")
    return t("auth.passkeyChallengeInvalid");
  if (code === "PASSKEY_VERIFICATION_FAILED")
    return t("auth.passkeyVerificationFailed");
  if (code === "COMMERCIAL_TRIALS_DISABLED")
    return t("auth.administratorSignupUnavailable");
  return t("common.unknownError");
}

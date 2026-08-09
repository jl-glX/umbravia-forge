import { randomUUID } from "node:crypto";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEVELOPMENT_SECRET = "1x0000000000000000000000000000000AA";
const TEST_SITE_KEY = "1x00000000000000000000AA";
const REQUEST_TIMEOUT_MS = 8_000;

interface TurnstileResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

export type CaptchaAction =
  "login" | "signup" | "recovery" | "form_access" | "feedback";
export type CaptchaVerificationReason =
  | "verified"
  | "test_environment"
  | "not_configured"
  | "missing_token"
  | "token_too_long"
  | "provider_unavailable"
  | "provider_rejected"
  | "action_mismatch"
  | "hostname_mismatch";

export interface CaptchaVerificationResult {
  success: boolean;
  reason: CaptchaVerificationReason;
}

function configuredSecret(): string | null {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (secret) {
    if (
      process.env.NODE_ENV === "production" &&
      secret === DEVELOPMENT_SECRET
    ) {
      return null;
    }
    return secret;
  }
  return process.env.NODE_ENV === "production" ? null : DEVELOPMENT_SECRET;
}

function allowedHostnames(): Set<string> {
  return new Set(
    (process.env.CLIENT_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .flatMap((origin) => {
        try {
          return [new URL(origin).hostname];
        } catch {
          return [];
        }
      }),
  );
}

export function captchaIsConfigured(): boolean {
  return configuredSecret() !== null;
}

export const DEVELOPMENT_CAPTCHA_SITE_KEY = TEST_SITE_KEY;

export async function verifyCaptcha(
  token: string,
  action: CaptchaAction,
  remoteIp?: string,
): Promise<boolean> {
  return (await verifyCaptchaDetailed(token, action, remoteIp)).success;
}

export async function verifyCaptchaDetailed(
  token: string,
  action: CaptchaAction,
  remoteIp?: string,
): Promise<CaptchaVerificationResult> {
  if (process.env.NODE_ENV === "test") {
    return { success: true, reason: "test_environment" };
  }
  const secret = configuredSecret();
  if (!secret) return { success: false, reason: "not_configured" };
  if (!token) return { success: false, reason: "missing_token" };
  if (token.length > 2_048) {
    return { success: false, reason: "token_too_long" };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: randomUUID(),
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { success: false, reason: "provider_unavailable" };
    }
    const result = (await response.json()) as TurnstileResponse;
    if (!result.success) {
      return { success: false, reason: "provider_rejected" };
    }

    // Official development keys do not represent a production hostname/action.
    if (secret === DEVELOPMENT_SECRET) {
      return { success: true, reason: "verified" };
    }
    if (result.action !== action) {
      return { success: false, reason: "action_mismatch" };
    }
    const hostnames = allowedHostnames();
    return result.hostname && hostnames.has(result.hostname)
      ? { success: true, reason: "verified" }
      : { success: false, reason: "hostname_mismatch" };
  } catch {
    return { success: false, reason: "provider_unavailable" };
  }
}

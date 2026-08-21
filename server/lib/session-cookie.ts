import { Request, Response } from "express";
import {
  MFA_CHALLENGE_DURATION,
  REMEMBERED_SESSION_DURATION,
} from "../services/auth.js";

const SESSION_COOKIE_NAME = "umbravia-forge_session";
const SUPPORT_SESSION_COOKIE_NAME = "umf-support_session";
const MFA_CHALLENGE_COOKIE_NAME = "umbravia-forge_mfa_challenge";
const SUPPORT_MFA_CHALLENGE_COOKIE_NAME = "umf-support_mfa_challenge";
const PASSKEY_CHALLENGE_COOKIE_NAME = "umbravia-forge_passkey_challenge";
const SUPPORT_PASSKEY_CHALLENGE_COOKIE_NAME = "umf-support_passkey_challenge";

function readCookie(req: Request, name: string): string | null {
  const cookies = req.get("Cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function readSessionToken(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE_NAME);
}

export function readSupportSessionToken(req: Request): string | null {
  return readCookie(req, SUPPORT_SESSION_COOKIE_NAME);
}

export function readMfaChallengeToken(req: Request): string | null {
  return readCookie(req, MFA_CHALLENGE_COOKIE_NAME);
}

export function readSupportMfaChallengeToken(req: Request): string | null {
  return readCookie(req, SUPPORT_MFA_CHALLENGE_COOKIE_NAME);
}

export function readPasskeyChallengeToken(req: Request): string | null {
  return readCookie(req, PASSKEY_CHALLENGE_COOKIE_NAME);
}

export function readSupportPasskeyChallengeToken(req: Request): string | null {
  return readCookie(req, SUPPORT_PASSKEY_CHALLENGE_COOKIE_NAME);
}

export function setSessionCookie(
  res: Response,
  token: string,
  rememberDevice = false,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    ...(rememberDevice ? { maxAge: REMEMBERED_SESSION_DURATION } : {}),
    path: "/",
  });
}

export function setSupportSessionCookie(
  res: Response,
  token: string,
  rememberDevice = false,
): void {
  res.cookie(SUPPORT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    ...(rememberDevice ? { maxAge: REMEMBERED_SESSION_DURATION } : {}),
    path: "/",
  });
}

export function setMfaChallengeCookie(res: Response, token: string): void {
  res.cookie(MFA_CHALLENGE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MFA_CHALLENGE_DURATION,
    path: "/api/auth/mfa",
  });
}

export function setSupportMfaChallengeCookie(
  res: Response,
  token: string,
): void {
  res.cookie(SUPPORT_MFA_CHALLENGE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MFA_CHALLENGE_DURATION,
    path: "/api/umf-support/mfa",
  });
}

export function setPasskeyChallengeCookie(res: Response, token: string): void {
  res.cookie(PASSKEY_CHALLENGE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MFA_CHALLENGE_DURATION,
    path: "/api",
  });
}

export function setSupportPasskeyChallengeCookie(
  res: Response,
  token: string,
): void {
  res.cookie(SUPPORT_PASSKEY_CHALLENGE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: MFA_CHALLENGE_DURATION,
    path: "/api/umf-support",
  });
}

export function clearPasskeyChallengeCookie(res: Response): void {
  res.clearCookie(PASSKEY_CHALLENGE_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
  });
}

export function clearSupportPasskeyChallengeCookie(res: Response): void {
  res.clearCookie(SUPPORT_PASSKEY_CHALLENGE_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/umf-support",
  });
}

export function clearMfaChallengeCookie(res: Response): void {
  res.clearCookie(MFA_CHALLENGE_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/mfa",
  });
}

export function clearSupportMfaChallengeCookie(res: Response): void {
  res.clearCookie(SUPPORT_MFA_CHALLENGE_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/umf-support/mfa",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export function clearSupportSessionCookie(res: Response): void {
  res.clearCookie(SUPPORT_SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

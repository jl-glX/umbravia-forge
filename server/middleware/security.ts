import "dotenv/config";
import { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { isTrustedOrigin } from "../lib/request-origin.js";

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const windowMs =
  parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000;

export const apiLimiter = rateLimit({
  windowMs,
  limit: parsePositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 200),
  message: {
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const authenticationLimiter = rateLimit({
  windowMs,
  limit: parsePositiveInteger(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10),
  message: {
    error: "Too many authentication attempts. Please try again later.",
    code: "AUTH_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const loginLimiter = rateLimit({
  windowMs,
  limit: parsePositiveInteger(
    process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS,
    parsePositiveInteger(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10),
  ),
  skipSuccessfulRequests: true,
  message: {
    error: "Too many login attempts. Please try again later.",
    code: "AUTH_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const signupLimiter = rateLimit({
  windowMs:
    parsePositiveInteger(process.env.SIGNUP_RATE_LIMIT_WINDOW_MINUTES, 60) *
    60 *
    1000,
  limit: parsePositiveInteger(process.env.SIGNUP_RATE_LIMIT_MAX_REQUESTS, 5),
  message: {
    error: "Too many signup attempts. Please try again later.",
    code: "SIGNUP_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const emailVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parsePositiveInteger(
    process.env.EMAIL_VERIFICATION_RATE_LIMIT_MAX_REQUESTS,
    3,
  ),
  message: {
    error: "Too many verification messages requested. Please try again later.",
    code: "EMAIL_VERIFICATION_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const accountRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parsePositiveInteger(
    process.env.ACCOUNT_RECOVERY_RATE_LIMIT_MAX_REQUESTS,
    5,
  ),
  message: {
    error: "Too many account recovery attempts. Please try again later.",
    code: "ACCOUNT_RECOVERY_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    error: "Too many feedback submissions. Please try again later.",
    code: "FEEDBACK_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export const supportMutationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parsePositiveInteger(
    process.env.SUPPORT_MUTATION_RATE_LIMIT_MAX_REQUESTS,
    30,
  ),
  message: {
    error: "Too many support changes. Please try again later.",
    code: "SUPPORT_RATE_LIMITED",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

export function apiSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function enforceTrustedMutationOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.get("Sec-Fetch-Site") === "cross-site") {
    res.status(403).json({
      error: "Cross-site request rejected",
      code: "UNTRUSTED_ORIGIN",
    });
    return;
  }

  const origin = req.get("Origin");
  if (origin && !isTrustedOrigin(origin.replace(/\/$/, ""))) {
    res.status(403).json({
      error: "Request origin is not allowed",
      code: "UNTRUSTED_ORIGIN",
    });
    return;
  }

  next();
}

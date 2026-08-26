import type { Request } from "express";
import { isTrustedTenantHostname } from "./tenant-host.js";

const DEFAULT_DEVELOPMENT_ORIGIN = "http://localhost:3000";

function parseOrigin(value: string): URL | null {
  try {
    const origin = new URL(value);
    return origin.origin === value.replace(/\/$/, "") ? origin : null;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: URL): boolean {
  return (
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    (origin.hostname === "localhost" || origin.hostname === "127.0.0.1")
  );
}

export function getAllowedClientOrigins(): string[] {
  const configured = process.env.CLIENT_ORIGIN?.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (configured?.length) {
    for (const value of configured) {
      const origin = parseOrigin(value);
      if (!origin) throw new Error(`Invalid CLIENT_ORIGIN: ${value}`);
      if (
        process.env.NODE_ENV === "production" &&
        origin.protocol !== "https:"
      ) {
        throw new Error("CLIENT_ORIGIN must use HTTPS in production");
      }
    }
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CLIENT_ORIGIN is required in production");
  }

  return [DEFAULT_DEVELOPMENT_ORIGIN];
}

export function isTrustedOrigin(value: string): boolean {
  const origin = parseOrigin(value);
  if (!origin) return false;
  if (getAllowedClientOrigins().includes(origin.origin)) return true;
  if (
    origin.protocol === "https:" &&
    isTrustedTenantHostname(origin.hostname)
  ) {
    return true;
  }
  return process.env.NODE_ENV !== "production" && isLoopbackOrigin(origin);
}

export function getWebauthnContext(req: Request): {
  origin: string;
  rpID: string;
} {
  const requestOrigin = req.get("Origin")?.replace(/\/$/, "");
  if (requestOrigin && !isTrustedOrigin(requestOrigin)) {
    throw new Error("Untrusted WebAuthn origin");
  }

  const origin =
    requestOrigin ??
    process.env.WEBAUTHN_ORIGIN?.replace(/\/$/, "") ??
    getAllowedClientOrigins()[0];
  if (!origin || !isTrustedOrigin(origin)) {
    throw new Error("A trusted WebAuthn origin must be configured");
  }

  const parsedOrigin = new URL(origin);
  if (
    process.env.NODE_ENV === "production" &&
    parsedOrigin.protocol !== "https:"
  ) {
    throw new Error("WebAuthn origin must use HTTPS in production");
  }
  const rpID = process.env.WEBAUTHN_RP_ID?.trim() || parsedOrigin.hostname;
  if (
    parsedOrigin.hostname !== rpID &&
    !parsedOrigin.hostname.endsWith(`.${rpID}`)
  ) {
    throw new Error("WebAuthn RP ID must match the trusted origin");
  }

  return { origin: parsedOrigin.origin, rpID };
}

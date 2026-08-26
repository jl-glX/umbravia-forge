import type { Request } from "express";
import { isAllowedFacilitySlug } from "./facility-slug.js";

export interface TenantSubdomainConfiguration {
  enabled: boolean;
  baseDomain: string | null;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isValidBaseDomain(value: string): boolean {
  return (
    value.length <= 253 &&
    value.includes(".") &&
    value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

export function resolveTenantSubdomainConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): TenantSubdomainConfiguration {
  const enabled = environment.TENANT_SUBDOMAINS_ENABLED === "true";
  const configured = environment.TENANT_BASE_DOMAIN?.trim();
  if (!configured) return { enabled, baseDomain: null };

  const baseDomain = normalizeHostname(configured);
  if (!isValidBaseDomain(baseDomain)) {
    throw new Error("TENANT_BASE_DOMAIN must be a valid registrable hostname");
  }
  return { enabled, baseDomain };
}

export function resolveTenantPreviewBaseDomain(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured =
    resolveTenantSubdomainConfiguration(environment).baseDomain;
  if (configured) return configured;

  for (const value of (environment.CLIENT_ORIGIN ?? "").split(",")) {
    try {
      const hostname = normalizeHostname(new URL(value.trim()).hostname);
      if (!hostname.startsWith("www.")) continue;
      const candidate = hostname.slice("www.".length);
      if (isValidBaseDomain(candidate)) return candidate;
    } catch {
      // Ignore malformed origins here. Production validation remains authoritative.
    }
  }
  return null;
}

export function tenantSlugFromHostname(
  hostname: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configuration = resolveTenantSubdomainConfiguration(environment);
  if (!configuration.enabled || !configuration.baseDomain) return null;

  const normalized = normalizeHostname(hostname);
  const suffix = `.${configuration.baseDomain}`;
  if (!normalized.endsWith(suffix)) return null;
  const label = normalized.slice(0, -suffix.length);
  if (label.includes(".") || !isAllowedFacilitySlug(label)) return null;
  return label;
}

export function isTenantHostnameCandidate(
  hostname: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuration = resolveTenantSubdomainConfiguration(environment);
  if (!configuration.enabled || !configuration.baseDomain) return false;
  const normalized = normalizeHostname(hostname);
  const suffix = `.${configuration.baseDomain}`;
  if (!normalized.endsWith(suffix)) return false;
  const label = normalized.slice(0, -suffix.length);
  return label.length > 0 && !label.includes(".");
}

export function isConfiguredClientHostname(
  hostname: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = normalizeHostname(hostname);
  return (environment.CLIENT_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => {
      try {
        return normalizeHostname(new URL(value).hostname) === normalized;
      } catch {
        return false;
      }
    });
}

export function tenantSlugFromRequest(req: Request): string | null {
  return tenantSlugFromHostname(req.hostname);
}

export function isTrustedTenantHostname(
  hostname: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return tenantSlugFromHostname(hostname, environment) !== null;
}

export function tenantOriginForSlug(
  slug: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configuration = resolveTenantSubdomainConfiguration(environment);
  if (!configuration.enabled || !configuration.baseDomain) return null;
  if (!isAllowedFacilitySlug(slug)) return null;
  return `https://${slug}.${configuration.baseDomain}`;
}

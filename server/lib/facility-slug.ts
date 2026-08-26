import { randomUUID } from "node:crypto";

export const RESERVED_FACILITY_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "cdn",
  "dev",
  "help",
  "imap",
  "mail",
  "smtp",
  "staging",
  "static",
  "status",
  "support",
  "test",
  "www",
]);

const FACILITY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeFacilitySlugBase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function isAllowedFacilitySlug(value: string): boolean {
  return (
    FACILITY_SLUG_PATTERN.test(value) && !RESERVED_FACILITY_SLUGS.has(value)
  );
}

export function assertAllowedFacilitySlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!isAllowedFacilitySlug(slug)) {
    throw new Error(
      "Facility slug must be a non-reserved DNS label of up to 63 characters",
    );
  }
  return slug;
}

export function createFacilitySlug(
  name: string,
  entropy = randomUUID().slice(0, 8),
): string {
  const base = normalizeFacilitySlugBase(name) || "centro";
  const safeBase = RESERVED_FACILITY_SLUGS.has(base) ? `${base}-centro` : base;
  return assertAllowedFacilitySlug(`${safeBase.slice(0, 48)}-${entropy}`);
}

export function createTrialSubdomain(name: string): string {
  const base = normalizeFacilitySlugBase(name) || "centro";
  const safeBase = RESERVED_FACILITY_SLUGS.has(base) ? `${base}-centro` : base;
  return assertAllowedFacilitySlug(`${safeBase.slice(0, 53)}-demo`);
}

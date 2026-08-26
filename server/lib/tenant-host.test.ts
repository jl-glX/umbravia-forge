import { describe, expect, it } from "vitest";
import {
  isConfiguredClientHostname,
  isTenantHostnameCandidate,
  isTrustedTenantHostname,
  resolveTenantSubdomainConfiguration,
  tenantOriginForSlug,
  tenantSlugFromHostname,
} from "./tenant-host.js";

const enabledEnvironment = {
  TENANT_SUBDOMAINS_ENABLED: "true",
  TENANT_BASE_DOMAIN: "umbraviaforge.example",
} as NodeJS.ProcessEnv;

describe("tenant hostname parsing", () => {
  it("extracts exactly one safe facility label", () => {
    expect(
      tenantSlugFromHostname(
        "centro-norte.umbraviaforge.example",
        enabledEnvironment,
      ),
    ).toBe("centro-norte");
    expect(
      tenantSlugFromHostname("a.b.umbraviaforge.example", enabledEnvironment),
    ).toBeNull();
    expect(
      tenantSlugFromHostname("admin.umbraviaforge.example", enabledEnvironment),
    ).toBeNull();
  });

  it("distinguishes configured application hosts from reserved tenant candidates", () => {
    const environment = {
      ...enabledEnvironment,
      CLIENT_ORIGIN: "https://www.umbraviaforge.example",
    };
    expect(
      isTenantHostnameCandidate("support.umbraviaforge.example", environment),
    ).toBe(true);
    expect(
      isConfiguredClientHostname("support.umbraviaforge.example", environment),
    ).toBe(false);
    expect(
      isConfiguredClientHostname("www.umbraviaforge.example", environment),
    ).toBe(true);
  });

  it("does not route subdomains while the operational switch is disabled", () => {
    expect(
      tenantSlugFromHostname("centro.umbraviaforge.example", {
        ...enabledEnvironment,
        TENANT_SUBDOMAINS_ENABLED: "false",
      }),
    ).toBeNull();
  });

  it("builds only trusted tenant origins", () => {
    expect(
      isTrustedTenantHostname(
        "centro.umbraviaforge.example",
        enabledEnvironment,
      ),
    ).toBe(true);
    expect(tenantOriginForSlug("centro", enabledEnvironment)).toBe(
      "https://centro.umbraviaforge.example",
    );
    expect(tenantOriginForSlug("support", enabledEnvironment)).toBeNull();
  });

  it("rejects invalid base-domain configuration", () => {
    expect(() =>
      resolveTenantSubdomainConfiguration({
        TENANT_SUBDOMAINS_ENABLED: "true",
        TENANT_BASE_DOMAIN: "localhost",
      }),
    ).toThrow(/TENANT_BASE_DOMAIN/);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  formatSupportDiagnosticProbeReport,
  resolveSupportDiagnosticProbeOrigin,
  runSupportDiagnosticProbe,
  type SupportDiagnosticProbeDependencies,
  type TlsProbeResult,
} from "./support-diagnostic-probe.js";

const healthyTls: TlsProbeResult = {
  ok: true,
  authorized: true,
  protocol: "TLSv1.3",
  cipher: "TLS_AES_256_GCM_SHA384",
  subject: "cf-test.umbraviaforge.com",
  issuer: "Test CA",
  validFrom: "Aug 16 00:00:00 2026 GMT",
  validTo: "Nov 14 00:00:00 2026 GMT",
  error: null,
};

function dependencies(
  response: (url: URL) => Response = () => new Response(null, { status: 200 }),
): SupportDiagnosticProbeDependencies {
  return {
    resolve4: vi.fn(async () => ["46.225.103.156"]),
    resolve6: vi.fn(async () => []),
    inspectTls: vi.fn(async () => healthyTls),
    fetch: vi.fn(async (input) =>
      response(new URL(String(input))),
    ) as unknown as typeof fetch,
  };
}

describe("support diagnostic probe", () => {
  it("checks the fixed DNS, TLS and health targets without reading bodies", async () => {
    const probeDependencies = dependencies();
    const report = await runSupportDiagnosticProbe("all", {
      dependencies: probeDependencies,
    });

    expect(report).toMatchObject({
      target: "https://cf-test.umbraviaforge.com",
      check: "all",
      healthy: true,
      dns: { ok: true, ipv4: ["46.225.103.156"] },
      tls: { ok: true, protocol: "TLSv1.3" },
      live: { ok: true, status: 200 },
      ready: { ok: true, status: 200 },
    });
    expect(probeDependencies.fetch).toHaveBeenCalledTimes(2);
    expect(probeDependencies.fetch).toHaveBeenNthCalledWith(
      1,
      new URL("https://cf-test.umbraviaforge.com/api/health/live"),
      expect.any(Object),
    );
    expect(probeDependencies.fetch).toHaveBeenNthCalledWith(
      2,
      new URL("https://cf-test.umbraviaforge.com/api/health"),
      expect.any(Object),
    );
    expect(formatSupportDiagnosticProbeReport(report)).toContain(
      "probe=healthy",
    );
  });

  it("reports redirects as degraded instead of following them", async () => {
    const probeDependencies = dependencies(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.umbraviaforge.com/" },
        }),
    );
    const report = await runSupportDiagnosticProbe("live", {
      dependencies: probeDependencies,
    });

    expect(report).toMatchObject({
      healthy: false,
      dns: null,
      tls: null,
      live: {
        ok: false,
        status: 302,
        location: "https://www.umbraviaforge.com/",
      },
      ready: null,
    });
    expect(formatSupportDiagnosticProbeReport(report)).toContain(
      "live-redirect=https://www.umbraviaforge.com/",
    );
  });

  it("rejects origins that could turn the command into an arbitrary request", () => {
    expect(() =>
      resolveSupportDiagnosticProbeOrigin(
        "https://user:secret@example.com/private?target=internal",
      ),
    ).toThrow("must be an HTTPS origin");
    expect(() =>
      resolveSupportDiagnosticProbeOrigin("http://cf-test.umbraviaforge.com"),
    ).toThrow("must be an HTTPS origin");
  });
});

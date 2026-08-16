import { resolve4, resolve6 } from "node:dns/promises";
import { connect as connectTls, type ConnectionOptions } from "node:tls";
import { authenticatedModernTlsOptions } from "../lib/transport-security.js";

const DEFAULT_PROBE_ORIGIN = "https://cf-test.umbraviaforge.com";
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_PATHS = {
  live: "/api/health/live",
  ready: "/api/health",
} as const;

export type SupportDiagnosticProbeCheck =
  "all" | "dns" | "tls" | "live" | "ready";

interface DnsProbeResult {
  ok: boolean;
  ipv4: string[];
  ipv6: string[];
  errors: string[];
}

export interface TlsProbeResult {
  ok: boolean;
  authorized: boolean;
  protocol: string | null;
  cipher: string | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  error: string | null;
}

interface HttpProbeResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  location: string | null;
  error: string | null;
}

export interface SupportDiagnosticProbeReport {
  target: string;
  check: SupportDiagnosticProbeCheck;
  checkedAt: string;
  healthy: boolean;
  dns: DnsProbeResult | null;
  tls: TlsProbeResult | null;
  live: HttpProbeResult | null;
  ready: HttpProbeResult | null;
}

export interface SupportDiagnosticProbeDependencies {
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
  inspectTls: (url: URL) => Promise<TlsProbeResult>;
  fetch: typeof fetch;
}

function sanitizeDiagnosticValue(value: unknown, fallback = "unavailable") {
  const normalized = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 240);
  return normalized || fallback;
}

function errorMessage(error: unknown) {
  return sanitizeDiagnosticValue(
    error instanceof Error ? error.message : error,
    "unknown error",
  );
}

export function resolveSupportDiagnosticProbeOrigin(value?: string) {
  const raw = value?.trim() || DEFAULT_PROBE_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The diagnostic probe origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "The diagnostic probe origin must be an HTTPS origin without credentials, path, query or non-standard port",
    );
  }
  return url;
}

export function resolveSupportDiagnosticTlsConnectionOptions(
  url: URL,
): ConnectionOptions {
  return {
    host: url.hostname,
    port: 443,
    servername: url.hostname,
    ...authenticatedModernTlsOptions(),
  };
}

async function inspectTls(url: URL): Promise<TlsProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TlsProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = connectTls(
      resolveSupportDiagnosticTlsConnectionOptions(url),
    );
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      finish({
        ok: socket.authorized,
        authorized: socket.authorized,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name ?? null,
        subject: certificate.subject?.CN ?? null,
        issuer: certificate.issuer?.CN ?? certificate.issuer?.O ?? null,
        validFrom: certificate.valid_from ?? null,
        validTo: certificate.valid_to ?? null,
        error: socket.authorized
          ? null
          : sanitizeDiagnosticValue(socket.authorizationError),
      });
    });
    socket.once("timeout", () => {
      finish({
        ok: false,
        authorized: false,
        protocol: null,
        cipher: null,
        subject: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        error: "connection timeout",
      });
    });
    socket.once("error", (error) => {
      finish({
        ok: false,
        authorized: false,
        protocol: null,
        cipher: null,
        subject: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        error: errorMessage(error),
      });
    });
  });
}

async function runDnsProbe(
  hostname: string,
  dependencies: SupportDiagnosticProbeDependencies,
): Promise<DnsProbeResult> {
  const [ipv4, ipv6] = await Promise.all([
    dependencies.resolve4(hostname).then(
      (addresses) => ({ addresses, error: null }),
      (error) => ({ addresses: [], error: errorMessage(error) }),
    ),
    dependencies.resolve6(hostname).then(
      (addresses) => ({ addresses, error: null }),
      (error) => ({ addresses: [], error: errorMessage(error) }),
    ),
  ]);
  const errors = [ipv4.error, ipv6.error].filter((error): error is string =>
    Boolean(error),
  );
  return {
    ok: ipv4.addresses.length > 0 || ipv6.addresses.length > 0,
    ipv4: ipv4.addresses,
    ipv6: ipv6.addresses,
    errors,
  };
}

async function runHttpProbe(
  origin: URL,
  path: (typeof PROBE_PATHS)[keyof typeof PROBE_PATHS],
  dependencies: SupportDiagnosticProbeDependencies,
): Promise<HttpProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await dependencies.fetch(new URL(path, origin), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "Umbravia-Forge-Support-Diagnostics/1.0",
      },
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: response.status === 200,
      status: response.status,
      durationMs: Date.now() - startedAt,
      location: response.headers.get("location"),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      location: null,
      error: errorMessage(error),
    };
  }
}

export async function runSupportDiagnosticProbe(
  check: SupportDiagnosticProbeCheck = "all",
  options: {
    origin?: string;
    dependencies?: Partial<SupportDiagnosticProbeDependencies>;
  } = {},
): Promise<SupportDiagnosticProbeReport> {
  const origin = resolveSupportDiagnosticProbeOrigin(
    options.origin ?? process.env.UMBRAVIA_DIAGNOSTIC_PROBE_ORIGIN,
  );
  const dependencies: SupportDiagnosticProbeDependencies = {
    resolve4,
    resolve6,
    inspectTls,
    fetch,
    ...options.dependencies,
  };
  const include = (candidate: Exclude<SupportDiagnosticProbeCheck, "all">) =>
    check === "all" || check === candidate;

  const [dns, tls, live, ready] = await Promise.all([
    include("dns")
      ? runDnsProbe(origin.hostname, dependencies)
      : Promise.resolve(null),
    include("tls") ? dependencies.inspectTls(origin) : Promise.resolve(null),
    include("live")
      ? runHttpProbe(origin, PROBE_PATHS.live, dependencies)
      : Promise.resolve(null),
    include("ready")
      ? runHttpProbe(origin, PROBE_PATHS.ready, dependencies)
      : Promise.resolve(null),
  ]);
  const requestedResults = [dns, tls, live, ready].filter(
    (result): result is NonNullable<typeof result> => result !== null,
  );
  return {
    target: origin.origin,
    check,
    checkedAt: new Date().toISOString(),
    healthy:
      requestedResults.length > 0 &&
      requestedResults.every((result) => result.ok),
    dns,
    tls,
    live,
    ready,
  };
}

export function formatSupportDiagnosticProbeReport(
  report: SupportDiagnosticProbeReport,
) {
  const lines = [
    `probe=${report.healthy ? "healthy" : "degraded"}`,
    `target=${sanitizeDiagnosticValue(report.target)}`,
    `check=${report.check}`,
    `checked-at=${report.checkedAt}`,
  ];
  if (report.dns) {
    lines.push(`dns=${report.dns.ok ? "ok" : "failed"}`);
    lines.push(`ipv4=${report.dns.ipv4.join(",") || "none"}`);
    lines.push(`ipv6=${report.dns.ipv6.join(",") || "none"}`);
    if (report.dns.errors.length) {
      lines.push(`dns-errors=${report.dns.errors.join(" | ")}`);
    }
  }
  if (report.tls) {
    lines.push(`tls=${report.tls.ok ? "ok" : "failed"}`);
    lines.push(`tls-protocol=${report.tls.protocol ?? "none"}`);
    lines.push(`tls-cipher=${report.tls.cipher ?? "none"}`);
    lines.push(
      `tls-subject=${sanitizeDiagnosticValue(report.tls.subject, "none")}`,
    );
    lines.push(
      `tls-issuer=${sanitizeDiagnosticValue(report.tls.issuer, "none")}`,
    );
    lines.push(`tls-valid-to=${report.tls.validTo ?? "none"}`);
    if (report.tls.error) lines.push(`tls-error=${report.tls.error}`);
  }
  for (const kind of ["live", "ready"] as const) {
    const result = report[kind];
    if (!result) continue;
    lines.push(`${kind}=${result.ok ? "ok" : "failed"}`);
    lines.push(`${kind}-status=${result.status ?? "none"}`);
    lines.push(`${kind}-duration-ms=${result.durationMs}`);
    if (result.location) {
      lines.push(
        `${kind}-redirect=${sanitizeDiagnosticValue(result.location)}`,
      );
    }
    if (result.error) lines.push(`${kind}-error=${result.error}`);
  }
  return lines;
}

export interface NpmAuditVulnerabilityTotals {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
}

export interface NpmAuditVulnerability {
  via: Array<string | Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ParsedNpmAuditReport {
  auditReportVersion: 2;
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: NpmAuditVulnerabilityTotals;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NpmAuditLockfile {
  packages?: Record<string, { version?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface TemporaryNpmAuditException {
  advisories: Set<string>;
  viaPackages: Set<string>;
  versions: Set<string>;
  reason: string;
}

export interface AllowedNpmAuditVulnerability {
  name: string;
  packageVersion: string | undefined;
  reason: string;
}

export interface BlockingNpmAuditVulnerability {
  name: string;
  packageVersion: string | undefined;
  vulnerability: unknown;
}

export function parseNpmAuditReport(input: {
  stdout: string;
  stderr?: string;
  status: number | null;
}): ParsedNpmAuditReport;

export function evaluateNpmAuditReport(input: {
  report: ParsedNpmAuditReport;
  lockfile: NpmAuditLockfile;
  temporaryExceptions?: Map<string, TemporaryNpmAuditException>;
}): {
  allowed: AllowedNpmAuditVulnerability[];
  blocking: BlockingNpmAuditVulnerability[];
};

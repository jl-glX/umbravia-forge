import { describe, expect, it } from "vitest";
import {
  evaluateNpmAuditReport,
  parseNpmAuditReport,
} from "../../scripts/lib/npm-audit-policy.mjs";

const validMetadata = {
  vulnerabilities: {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  },
};

describe("npm audit CI policy", () => {
  it("accepts and evaluates a complete advisory report", () => {
    const report = parseNpmAuditReport({
      status: 0,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: validMetadata,
      }),
    });
    expect(
      evaluateNpmAuditReport({ report, lockfile: { packages: {} } }),
    ).toEqual({ allowed: [], blocking: [] });
  });

  it.each([
    [
      "transport error encoded as JSON",
      1,
      JSON.stringify({ error: { code: "ENETUNREACH" } }),
    ],
    ["missing metadata", 0, JSON.stringify({ vulnerabilities: {} })],
    [
      "missing audit report version",
      0,
      JSON.stringify({ vulnerabilities: {}, metadata: validMetadata }),
    ],
    [
      "unsupported audit report version",
      0,
      JSON.stringify({
        auditReportVersion: 3,
        vulnerabilities: {},
        metadata: validMetadata,
      }),
    ],
    ["invalid JSON", 1, "{broken"],
    ["empty output", 1, ""],
    [
      "positive totals without vulnerability entries",
      1,
      JSON.stringify({
        vulnerabilities: {},
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 1,
          },
        },
      }),
    ],
    [
      "inconsistent totals",
      1,
      JSON.stringify({
        vulnerabilities: { example: { via: [] } },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 2,
          },
        },
      }),
    ],
    [
      "two reported totals with only one vulnerability entry",
      1,
      JSON.stringify({
        vulnerabilities: { example: { via: [] } },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 2,
            total: 2,
          },
        },
      }),
    ],
  ])("fails closed for %s", (_label, status, stdout) => {
    expect(() => parseNpmAuditReport({ status, stdout })).toThrow();
  });

  it.each([null, 2])("rejects anomalous process status %s", (status) => {
    expect(() =>
      parseNpmAuditReport({
        status,
        stdout: JSON.stringify({
          vulnerabilities: {},
          metadata: validMetadata,
        }),
      }),
    ).toThrow();
  });

  it("rejects a valid report containing an unapproved vulnerability", () => {
    const report = parseNpmAuditReport({
      status: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          example: {
            via: [
              {
                url: "https://github.com/advisories/GHSA-example",
              },
            ],
          },
        },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 1,
          },
        },
      }),
    });
    expect(
      evaluateNpmAuditReport({
        report,
        lockfile: {
          packages: { "node_modules/example": { version: "1.0.0" } },
        },
      }).blocking,
    ).toHaveLength(1);
  });

  it("allows only the exact advisory and installed version declared by policy", () => {
    const report = parseNpmAuditReport({
      status: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          example: {
            via: [{ url: "https://example.test/GHSA-approved" }],
          },
        },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 1,
          },
        },
      }),
    });
    const exception = {
      advisories: new Set(["https://example.test/GHSA-approved"]),
      viaPackages: new Set<string>(),
      versions: new Set(["1.0.0"]),
      reason: "test-only pinned exception",
    };
    const evaluate = (version: string, advisories = exception.advisories) =>
      evaluateNpmAuditReport({
        report,
        lockfile: {
          packages: { "node_modules/example": { version } },
        },
        temporaryExceptions: new Map([
          ["example", { ...exception, advisories }],
        ]),
      });
    expect(evaluate("1.0.0")).toMatchObject({
      allowed: [{ name: "example", packageVersion: "1.0.0" }],
      blocking: [],
    });
    expect(evaluate("2.0.0").blocking).toHaveLength(1);
    expect(
      evaluate("1.0.0", new Set(["https://example.test/GHSA-other"])).blocking,
    ).toHaveLength(1);
  });

  it("rejects a derived exception when its vulnerable parent is absent", () => {
    const report = parseNpmAuditReport({
      status: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          "react-router-dom": { via: ["react-router"] },
        },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 1,
          },
        },
      }),
    });
    const result = evaluateNpmAuditReport({
      report,
      lockfile: {
        packages: {
          "node_modules/react-router-dom": { version: "7.18.2" },
        },
      },
      temporaryExceptions: new Map([
        [
          "react-router-dom",
          {
            advisories: new Set<string>(),
            viaPackages: new Set(["react-router"]),
            versions: new Set(["7.18.2"]),
            reason: "derived test exception",
          },
        ],
      ]),
    });
    expect(result.allowed).toEqual([]);
    expect(result.blocking).toHaveLength(1);
  });

  it("rejects an advisory when any via object lacks a URL", () => {
    const report = parseNpmAuditReport({
      status: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          example: {
            via: [
              { url: "https://example.test/GHSA-approved" },
              { source: 999, title: "missing-url" },
            ],
          },
        },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 1,
            total: 1,
          },
        },
      }),
    });
    const result = evaluateNpmAuditReport({
      report,
      lockfile: {
        packages: { "node_modules/example": { version: "1.0.0" } },
      },
      temporaryExceptions: new Map([
        [
          "example",
          {
            advisories: new Set(["https://example.test/GHSA-approved"]),
            viaPackages: new Set<string>(),
            versions: new Set(["1.0.0"]),
            reason: "direct test exception",
          },
        ],
      ]),
    });
    expect(result.allowed).toEqual([]);
    expect(result.blocking).toHaveLength(1);
  });

  it("allows a derived exception only after its exact parent is allowed", () => {
    const report = parseNpmAuditReport({
      status: 1,
      stdout: JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          "react-router-dom": { via: ["react-router"] },
          "react-router": {
            via: [{ url: "https://example.test/GHSA-approved" }],
          },
        },
        metadata: {
          vulnerabilities: {
            ...validMetadata.vulnerabilities,
            high: 2,
            total: 2,
          },
        },
      }),
    });
    const commonVersion = new Set(["7.18.2"]);
    const result = evaluateNpmAuditReport({
      report,
      lockfile: {
        packages: {
          "node_modules/react-router": { version: "7.18.2" },
          "node_modules/react-router-dom": { version: "7.18.2" },
        },
      },
      temporaryExceptions: new Map([
        [
          "react-router",
          {
            advisories: new Set(["https://example.test/GHSA-approved"]),
            viaPackages: new Set<string>(),
            versions: commonVersion,
            reason: "direct test exception",
          },
        ],
        [
          "react-router-dom",
          {
            advisories: new Set<string>(),
            viaPackages: new Set(["react-router"]),
            versions: commonVersion,
            reason: "derived test exception",
          },
        ],
      ]),
    });
    expect(result.blocking).toEqual([]);
    expect(result.allowed.map(({ name }) => name).sort()).toEqual([
      "react-router",
      "react-router-dom",
    ]);
  });
});

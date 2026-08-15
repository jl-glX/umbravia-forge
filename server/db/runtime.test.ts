import { describe, expect, it } from "vitest";
import { postgresPoolSettings, resolveDatabaseProvider } from "./runtime.js";

describe("database runtime selection", () => {
  it("keeps SQLite for local development and tests", () => {
    expect(resolveDatabaseProvider({ NODE_ENV: "development" })).toBe("sqlite");
    expect(resolveDatabaseProvider({ NODE_ENV: "test" })).toBe("sqlite");
  });

  it("requires PostgreSQL in production", () => {
    expect(() => resolveDatabaseProvider({ NODE_ENV: "production" })).toThrow(
      /requires DATABASE_URL/i,
    );
    expect(
      resolveDatabaseProvider({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example.invalid/umbravia_forge",
      }),
    ).toBe("postgresql");
  });

  it("requires PostgreSQL in staging while keeping demo on SQLite", () => {
    expect(
      resolveDatabaseProvider({
        NODE_ENV: "development",
        APP_ENV: "demo",
        DATABASE_PROVIDER: "sqlite",
      }),
    ).toBe("sqlite");
    expect(() =>
      resolveDatabaseProvider({
        NODE_ENV: "production",
        APP_ENV: "staging",
        DATABASE_PROVIDER: "sqlite",
      }),
    ).toThrow(/not supported/i);
  });

  it("honours an explicit SQLite demo even if a stale URL is present", () => {
    expect(
      resolveDatabaseProvider({
        NODE_ENV: "development",
        APP_ENV: "demo",
        DATABASE_PROVIDER: "sqlite",
        DATABASE_URL: "postgresql://stale.invalid/old",
      }),
    ).toBe("sqlite");
  });

  it("does not allow an explicit SQLite production deployment", () => {
    expect(() =>
      resolveDatabaseProvider({
        NODE_ENV: "production",
        DATABASE_PROVIDER: "sqlite",
      }),
    ).toThrow(/not supported in production/i);
  });

  it("uses bounded connection-pool settings and verified TLS by default", () => {
    expect(
      postgresPoolSettings({
        DATABASE_URL: "postgresql://example.invalid/umbravia_forge",
        DATABASE_POOL_MAX: "500",
      }),
    ).toMatchObject({
      max: 50,
      ssl: {
        minVersion: "TLSv1.2",
        ciphers: expect.stringMatching(/AES256-GCM/),
        rejectUnauthorized: true,
      },
      application_name: "umbravia-forge",
    });
  });
});

import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("tenant hostname boundary", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let resolveTenantHost: typeof import("./tenant-host.js").resolveTenantHost;
  let tenantHostContextEndpoint: typeof import("./tenant-host.js").tenantHostContextEndpoint;
  let selectFacilityContext: typeof import("./authorization.js").selectFacilityContext;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-tenant-host-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TENANT_SUBDOMAINS_ENABLED", "true");
    vi.stubEnv("TENANT_BASE_DOMAIN", "umbraviaforge.example");
    vi.stubEnv("CLIENT_ORIGIN", "https://www.umbraviaforge.example");
    vi.resetModules();

    database = await import("../db/client.js");
    ({ resolveTenantHost, tenantHostContextEndpoint } =
      await import("./tenant-host.js"));
    ({ selectFacilityContext } = await import("./authorization.js"));
    await database.initializeDatabase();

    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "tenant-host-user",
        email: "tenant-host@example.com",
        phone: null,
        name: "Tenant Host",
        avatarDataUrl: "",
        password: "not-used",
        role: "member",
        sessionIdleTimeoutMinutes: 10,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values([
        {
          id: "facility-alpha-host",
          slug: "alpha",
          name: "Alpha",
          logoDataUrl: "",
          accentColor: "#123456",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-beta-host",
          slug: "beta",
          name: "Beta",
          logoDataUrl: "",
          accentColor: "#654321",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "facility-alpha-host:tenant-host-user",
        facilityId: "facility-alpha-host",
        userId: "tenant-host-user",
        role: "member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  function publicApp() {
    const app = express();
    app.use(resolveTenantHost);
    app.get("/api/tenant-context", tenantHostContextEndpoint);
    app.get("/page", (_req, res) => {
      res.json({ unresolved: res.locals.tenantHostNotFound === true });
    });
    return app;
  }

  function authorizedApp(tenantFacilityId: string) {
    const app = express();
    app.use((_req, res, next) => {
      res.locals.auth = {
        userId: "tenant-host-user",
        facility: null,
      };
      res.locals.tenantHost = {
        facilityId: tenantFacilityId,
        slug: tenantFacilityId.includes("alpha") ? "alpha" : "beta",
        name: "Tenant",
        logoDataUrl: "",
        accentColor: "#123456",
      };
      next();
    });
    app.get("/selected", selectFacilityContext, (_req, res) => {
      res.json({ facilityId: res.locals.auth.facility?.id });
    });
    return app;
  }

  it("exposes only the public branding of an active facility", async () => {
    const response = await request(publicApp())
      .get("/api/tenant-context")
      .set("Host", "alpha.umbraviaforge.example")
      .expect(200);
    expect(response.body).toEqual({
      facility: {
        slug: "alpha",
        name: "Alpha",
        logoDataUrl: "",
        accentColor: "#123456",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("facility-alpha-host");
  });

  it("fails closed for an unknown tenant without falling back", async () => {
    await request(publicApp())
      .get("/api/tenant-context")
      .set("Host", "missing.umbraviaforge.example")
      .expect(404, {
        error: "The requested facility hostname is not available",
        code: "FACILITY_HOST_NOT_FOUND",
      });
    await request(publicApp())
      .get("/page")
      .set("Host", "missing.umbraviaforge.example")
      .expect(200, { unresolved: true });
  });

  it("does not let a reserved wildcard hostname fall through to the main app", async () => {
    await request(publicApp())
      .get("/api/tenant-context")
      .set("Host", "support.umbraviaforge.example")
      .expect(404);
    await request(publicApp())
      .get("/api/tenant-context")
      .set("Host", "www.umbraviaforge.example")
      .expect(204);
  });

  it("selects the host tenant only after checking membership", async () => {
    await request(authorizedApp("facility-alpha-host"))
      .get("/selected")
      .expect(200, { facilityId: "facility-alpha-host" });
    await request(authorizedApp("facility-beta-host"))
      .get("/selected")
      .expect(403);
  });

  it("rejects a header that tries to override the hostname tenant", async () => {
    await request(authorizedApp("facility-alpha-host"))
      .get("/selected")
      .set("X-Facility-Id", "facility-beta-host")
      .expect(403);
  });
});

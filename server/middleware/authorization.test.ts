import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }));

vi.mock("../services/auth.js", () => ({ verifyToken }));

import {
  authenticate,
  getAuthenticatedUser,
  requireFacility,
  requireRole,
  requireSelfParamOrRole,
} from "./authorization.js";

const users = {
  member: {
    userId: "member-1",
    email: "member@example.com",
    name: "Member",
    role: "member" as const,
    accountStatus: "active" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    facility: {
      id: "primary",
      slug: "primary",
      name: "Primary",
      role: "member" as const,
    },
  },
  trainer: {
    userId: "trainer-1",
    email: "trainer@example.com",
    name: "Trainer",
    role: "trainer" as const,
    accountStatus: "active" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    facility: {
      id: "primary",
      slug: "primary",
      name: "Primary",
      role: "trainer" as const,
    },
  },
  admin: {
    userId: "admin-1",
    email: "admin@example.com",
    name: "Admin",
    role: "admin" as const,
    accountStatus: "active" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    facility: {
      id: "primary",
      slug: "primary",
      name: "Primary",
      role: "owner" as const,
    },
  },
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.get(
    "/profile/:userId",
    authenticate,
    requireSelfParamOrRole("userId", "admin"),
    (_req, res) => {
      res.json({ userId: getAuthenticatedUser(res).userId });
    },
  );
  app.get("/admin", authenticate, requireRole("admin"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get(
    "/facility-admin",
    authenticate,
    requireFacility("owner", "admin"),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  return app;
}

describe("server authorization", () => {
  beforeEach(() => {
    verifyToken.mockImplementation(
      (token: string) => users[token as keyof typeof users] ?? null,
    );
  });

  it("rejects missing and invalid cookie sessions", async () => {
    const app = createTestApp();
    await request(app).get("/admin").expect(401);
    await request(app)
      .get("/admin")
      .set("Cookie", "umbravia-forge_session=invalid")
      .expect(401);
  });

  it("prevents a member from escalating into an administrator route", async () => {
    const response = await request(createTestApp())
      .get("/admin")
      .set("Cookie", "umbravia-forge_session=member")
      .expect(403);

    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("allows administrators into administrator routes", async () => {
    await request(createTestApp())
      .get("/admin")
      .set("Cookie", "umbravia-forge_session=admin")
      .expect(200, { ok: true });
  });

  it("uses the facility membership role for facility administration", async () => {
    const app = createTestApp();
    await request(app)
      .get("/facility-admin")
      .set("Cookie", "umbravia-forge_session=member")
      .expect(403);
    await request(app)
      .get("/facility-admin")
      .set("Cookie", "umbravia-forge_session=admin")
      .expect(200, { ok: true });
  });

  it("prevents horizontal access while allowing self access and admin oversight", async () => {
    const app = createTestApp();
    await request(app)
      .get("/profile/member-2")
      .set("Cookie", "umbravia-forge_session=member")
      .expect(403);
    await request(app)
      .get("/profile/member-1")
      .set("Cookie", "umbravia-forge_session=member")
      .expect(200);
    await request(app)
      .get("/profile/member-1")
      .set("Cookie", "umbravia-forge_session=admin")
      .expect(200);
  });
});

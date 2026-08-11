import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("delegations API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let ownerCookie: string;
  let delegateCookie: string;
  let token = "";
  let grantId = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-delegations-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();

    for (const user of [
      {
        id: "delegation-owner",
        email: "owner@example.com",
        name: "Owner Member",
      },
      {
        id: "delegation-helper",
        email: "helper@example.com",
        name: "Helper Member",
      },
    ]) {
      await database.db
        .insertInto("users")
        .values({
          ...user,
          phone: null,
          avatarDataUrl: "",
          password: await auth.hashPassword("DelegationPassword123"),
          role: "member",
          sessionIdleTimeoutMinutes: 7 * 24 * 60,
          createdAt: Date.now(),
        })
        .execute();
    }

    await database.initializeDatabase();

    await database.db
      .insertInto("gymClasses")
      .values({
        id: "delegated-class",
        name: "Delegated booking class",
        description: "",
        trainerId: "trainer-demo",
        trainerName: "Trainer",
        maxCapacity: 5,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();

    app = (await import("../index.js")).app;
    const login = async (identifier: string) =>
      (
        await request(app).post("/api/auth/login").send({
          identifier,
          password: "DelegationPassword123",
          accessPortal: "member",
          rememberDevice: false,
        })
      ).headers["set-cookie"][0];
    ownerCookie = await login("owner@example.com");
    delegateCookie = await login("helper@example.com");
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a one-time token while only persisting its hash", async () => {
    const response = await request(app)
      .post("/api/account/delegations/tokens")
      .set("Cookie", ownerCookie)
      .send({ duration: "7d" })
      .expect(201);

    token = response.body.token;
    grantId = response.body.id;
    expect(token).toMatch(/^hfd_[A-Za-z0-9_-]{32}$/);
    const stored = await database.db
      .selectFrom("delegationGrants")
      .select(["tokenHash", "tokenPreview", "expiresAt"])
      .where("id", "=", grantId)
      .executeTakeFirstOrThrow();
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenPreview).toBe(token.slice(-6));
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
  });

  it("allows the recipient to redeem the token and book for the owner", async () => {
    await request(app)
      .post("/api/account/delegations/redeem")
      .set("Cookie", delegateCookie)
      .send({ token })
      .expect(200);
    const replay = await request(app)
      .post("/api/account/delegations/redeem")
      .set("Cookie", delegateCookie)
      .send({ token })
      .expect(400);
    expect(replay.body.code).toBe("DELEGATION_TOKEN_ALREADY_USED");

    await request(app)
      .post("/api/bookings")
      .set("Cookie", delegateCookie)
      .send({ classId: "delegated-class", userId: "delegation-owner" })
      .expect(201);

    const booking = await database.db
      .selectFrom("bookings")
      .select(["id", "userId", "status"])
      .where("classId", "=", "delegated-class")
      .executeTakeFirstOrThrow();
    expect(booking).toMatchObject({
      userId: "delegation-owner",
      status: "confirmed",
    });

    await request(app)
      .put(`/api/bookings/${booking.id}/intention`)
      .set("Cookie", delegateCookie)
      .send({ userId: "delegation-owner", intention: "yes" })
      .expect(403);
  });

  it("stops delegated actions immediately after the owner revokes access", async () => {
    await request(app)
      .delete(`/api/account/delegations/${grantId}`)
      .set("Cookie", ownerCookie)
      .expect(204);

    await request(app)
      .delete("/api/bookings/not-owned")
      .set("Cookie", delegateCookie)
      .send({ userId: "delegation-owner" })
      .expect(403);
  });

  it("clears inactive history manually without removing active permissions", async () => {
    const activeGrant = await request(app)
      .post("/api/account/delegations/tokens")
      .set("Cookie", ownerCookie)
      .send({ duration: "7d" })
      .expect(201);

    const response = await request(app)
      .delete("/api/account/delegations/history")
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(response.body.delegations).toHaveLength(1);
    expect(response.body.delegations[0]).toMatchObject({
      id: activeGrant.body.id,
      active: true,
    });
  });

  it("automatically hides inactive history after thirty days", async () => {
    await database.db
      .updateTable("delegationGrants")
      .set({ revokedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
      .where("id", "=", grantId)
      .execute();

    const response = await request(app)
      .get("/api/account/delegations")
      .set("Cookie", delegateCookie)
      .expect(200);

    expect(
      response.body.delegations.some(
        (delegation: { id: string }) => delegation.id === grantId,
      ),
    ).toBe(false);
  });

  it("does not expose delegation data without authentication", async () => {
    await request(app).get("/api/account/delegations").expect(401);
  });
});

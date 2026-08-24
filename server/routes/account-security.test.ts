import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

describe("account compromise response", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let currentCookie: string;
  let previousCookie: string;
  let originalSupportId: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-compromise-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "http://127.0.0.1:3000");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const account = await auth.signup(
      "compromise@example.com",
      "Compromise",
      "CompromisePassword123",
    );
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active", emailVerifiedAt: Date.now() })
      .where("id", "=", account.user.id)
      .execute();
    originalSupportId = (
      await database.db
        .selectFrom("accountSupportIdentifiers")
        .select("publicId")
        .where("userId", "=", account.user.id)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow()
    ).publicId;
    app = (await import("../index.js")).app;
    previousCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "compromise@example.com",
        password: "CompromisePassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    currentCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "compromise@example.com",
        password: "CompromisePassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await database.db
      .updateTable("users")
      .set({ accountStatus: "active" })
      .where("email", "=", "compromise@example.com")
      .execute();
  });

  it("revokes secondary sessions and rotates the public support ID", async () => {
    const response = await request(app)
      .post("/api/account/security/compromise")
      .set("Cookie", currentCookie)
      .send({ password: "CompromisePassword123" })
      .expect(200);

    expect(response.body).toMatchObject({ accountStatus: "security_review" });
    expect(response.body.supportIdentifier.publicId).not.toBe(
      originalSupportId,
    );
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", previousCookie)
      .expect(401);
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", currentCookie)
      .expect(200);
  });

  it("rejects a compromise report without valid confirmation", async () => {
    await request(app)
      .post("/api/account/security/compromise")
      .set("Cookie", currentCookie)
      .send({ password: "WrongPassword123" })
      .expect(401);
  });

  it("accepts for passkey registration the same password used to sign in", async () => {
    const response = await request(app)
      .post("/api/account/security/passkeys/options")
      .set("Cookie", currentCookie)
      .send({ password: "CompromisePassword123" })
      .expect(200);

    expect(response.body.challenge).toEqual(expect.any(String));
    const challengeCookies = response.headers["set-cookie"];
    expect(
      Array.isArray(challengeCookies)
        ? challengeCookies.join(";")
        : String(challengeCookies),
    ).toContain("umbravia-forge_passkey_challenge=");
  });

  it("returns a stable localized error code for a wrong passkey confirmation", async () => {
    const response = await request(app)
      .post("/api/account/security/passkeys/options")
      .set("Cookie", currentCookie)
      .send({ password: "WrongPassword123" })
      .expect(401);

    expect(response.body.code).toBe("INVALID_SECURITY_CONFIRMATION");
  });

  it("changes email only after password and new-inbox verification", async () => {
    const secondaryCookie = (
      await request(app).post("/api/auth/login").send({
        identifier: "compromise@example.com",
        password: "CompromisePassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
    ).headers["set-cookie"][0];
    await request(app)
      .post("/api/account/security/email-change/request")
      .set("Cookie", currentCookie)
      .send({ email: "verified-new@example.com", password: "WrongPassword123" })
      .expect(401);

    const requested = await request(app)
      .post("/api/account/security/email-change/request")
      .set("Cookie", currentCookie)
      .send({
        email: "verified-new@example.com",
        password: "CompromisePassword123",
      })
      .expect(202);
    expect(requested.body.demoVerificationCode).toMatch(/^\d{6}$/);

    await request(app)
      .post("/api/account/security/email-change/confirm")
      .set("Cookie", currentCookie)
      .send({
        code:
          requested.body.demoVerificationCode === "000000"
            ? "111111"
            : "000000",
      })
      .expect(400);

    await request(app)
      .post("/api/account/security/email-change/confirm")
      .set("Cookie", currentCookie)
      .send({ code: requested.body.demoVerificationCode })
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe("verified-new@example.com");
      });

    await request(app)
      .get("/api/auth/session")
      .set("Cookie", currentCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user.email).toBe("verified-new@example.com");
      });
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", secondaryCookie)
      .expect(401);

    await request(app)
      .post("/api/auth/login")
      .send({
        identifier: "compromise@example.com",
        password: "CompromisePassword123",
        accessPortal: "member",
        rememberDevice: false,
      })
      .expect(401);
  });
});

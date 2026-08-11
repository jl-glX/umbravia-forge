import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("member commerce API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-member-commerce-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values({
        id: "commerce-member",
        email: "commerce-member@example.com",
        phone: null,
        name: "Commerce Member",
        avatarDataUrl: "",
        password: await auth.hashPassword("CommercePassword123"),
        role: "member",
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt: Date.now(),
      })
      .execute();
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "secondary",
        slug: "secondary",
        name: "Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "secondary:commerce-member",
        facilityId: "secondary",
        userId: "commerce-member",
        role: "member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("billingRecords")
      .values([
        {
          id: "member-payment",
          facilityId: "primary",
          userId: "commerce-member",
          customerName: "Commerce Member",
          customerEmail: "commerce-member@example.com",
          concept: "Monthly membership",
          billingCycle: "monthly",
          customCycleLabel: "",
          amountCents: 4500,
          currency: "EUR",
          status: "paid",
          dueAt: null,
          paidAt: now,
          invoiceNumber: "HF-MEMBER-001",
          notes: "",
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary-payment",
          facilityId: "secondary",
          userId: "commerce-member",
          customerName: "Commerce Member",
          customerEmail: "commerce-member@example.com",
          concept: "Secondary membership",
          billingCycle: "monthly",
          customCycleLabel: "",
          amountCents: 5500,
          currency: "EUR",
          status: "paid",
          dueAt: null,
          paidAt: now,
          invoiceNumber: "HF-MEMBER-002",
          notes: "",
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();

    app = (await import("../index.js")).app;
    const login = await request(app).post("/api/auth/login").send({
      identifier: "commerce-member@example.com",
      password: "CommercePassword123",
      accessPortal: "member",
      rememberDevice: false,
    });
    memberCookie = login.headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("returns only the signed-in member's active payments and API capabilities", async () => {
    const response = await request(app)
      .get("/api/member-commerce/summary")
      .set("Cookie", memberCookie)
      .expect(200);

    expect(response.body.payments).toHaveLength(1);
    expect(response.body.payments[0]).toMatchObject({
      id: "member-payment",
      amountCents: 4500,
    });
    expect(response.body.payments[0]).not.toHaveProperty("userId");
    expect(response.body.payments[0]).not.toHaveProperty("customerEmail");
    expect(response.body.payments[0]).not.toHaveProperty("notes");
    expect(response.body.orders).toEqual([]);
    expect(response.body.capabilities).toEqual({
      payments: true,
      orders: false,
      bankPayments: false,
    });
  });

  it("isolates payments by the selected facility", async () => {
    const primary = await request(app)
      .get("/api/member-commerce/summary")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "primary")
      .expect(200);
    const secondary = await request(app)
      .get("/api/member-commerce/summary")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);

    expect(
      primary.body.payments.map((payment: { id: string }) => payment.id),
    ).toEqual(["member-payment"]);
    expect(
      secondary.body.payments.map((payment: { id: string }) => payment.id),
    ).toEqual(["secondary-payment"]);
  });

  it("rejects unauthenticated access", async () => {
    await request(app).get("/api/member-commerce/summary").expect(401);
  });
});

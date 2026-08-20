import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("billing API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-billing-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values({
        id: "billing-admin",
        email: "billing-admin@example.com",
        phone: null,
        name: "Billing Admin",
        avatarDataUrl: "",
        password: await auth.hashPassword("BillingPassword123"),
        role: "admin",
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt: Date.now(),
      })
      .execute();
    await database.db
      .insertInto("users")
      .values({
        id: "billing-member",
        email: "linked-member@example.com",
        phone: "+34900000000",
        name: "Linked Member",
        avatarDataUrl: "",
        password: await auth.hashPassword("MemberPassword123"),
        role: "member",
        sessionIdleTimeoutMinutes: 7 * 24 * 60,
        createdAt: Date.now(),
      })
      .execute();
    await database.initializeDatabase();
    const now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
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
      .values([
        {
          id: "facility-alpha:billing-admin",
          facilityId: "facility-alpha",
          userId: "billing-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:billing-member",
          facilityId: "facility-alpha",
          userId: "billing-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:billing-admin",
          facilityId: "secondary",
          userId: "billing-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "secondary:billing-member",
          facilityId: "secondary",
          userId: "billing-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    app = (await import("../index.js")).app;
    const login = await request(app).post("/api/auth/login").send({
      identifier: "billing-admin@example.com",
      password: "BillingPassword123",
      accessPortal: "staff",
      rememberDevice: false,
    });
    adminCookie = login.headers["set-cookie"][0];
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores a customised payment, preserves its details and archives it", async () => {
    const dueAt = Date.now() + 86_400_000;
    const created = await request(app)
      .post("/api/billing")
      .set("Cookie", adminCookie)
      .send({
        customerName: "Test Member",
        customerEmail: "member@example.com",
        concept: "Flexible membership",
        billingCycle: "custom",
        customCycleLabel: "Every five weeks",
        amountCents: 12000,
        currency: "MXN",
        status: "pending",
        dueAt,
        paidAt: null,
        invoiceNumber: "HF-TEST-001",
        notes: "Custom rate agreed with the member",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      customerName: "Test Member",
      amountCents: 12000,
      currency: "MXN",
      status: "pending",
      customCycleLabel: "Every five weeks",
      notes: "Custom rate agreed with the member",
      archivedAt: null,
      dueAt,
    });

    const updated = await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "paid" })
      .expect(200);
    expect(updated.body.status).toBe("paid");
    expect(updated.body.paidAt).toEqual(expect.any(Number));

    const archivedAt = Date.now();
    const archived = await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({ archivedAt })
      .expect(200);
    expect(archived.body.archivedAt).toBe(archivedAt);

    const restored = await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({ archivedAt: null })
      .expect(200);
    expect(restored.body.archivedAt).toBeNull();
  });

  it("rejects unauthenticated billing access", async () => {
    await request(app).get("/api/billing").expect(401);
  });

  it("requires a description for a custom billing cycle", async () => {
    await request(app)
      .post("/api/billing")
      .set("Cookie", adminCookie)
      .send({
        customerName: "Test Member",
        customerEmail: "member@example.com",
        concept: "Flexible membership",
        billingCycle: "custom",
        customCycleLabel: "",
        amountCents: 12000,
        currency: "EUR",
        status: "pending",
        dueAt: null,
        paidAt: null,
        invoiceNumber: "HF-TEST-002",
        notes: "",
      })
      .expect(400);
  });

  it("searches real members and creates immutable server-side snapshots", async () => {
    const search = await request(app)
      .get("/api/billing/members?query=linked")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(search.body).toEqual([
      expect.objectContaining({
        id: "billing-member",
        name: "Linked Member",
        email: "linked-member@example.com",
      }),
    ]);

    const created = await request(app)
      .post("/api/billing")
      .set("Cookie", adminCookie)
      .send({
        userId: "billing-member",
        customerName: "Spoofed name",
        customerEmail: "spoofed@example.com",
        concept: "Monthly membership",
        billingCycle: "monthly",
        customCycleLabel: "",
        amountCents: 6900,
        currency: "EUR",
        status: "pending",
        dueAt: null,
        paidAt: null,
        invoiceNumber: "UF-LINKED-001",
        notes: "",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      userId: "billing-member",
      customerName: "Linked Member",
      customerEmail: "linked-member@example.com",
    });

    await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({ customerName: "Altered snapshot" })
      .expect(400);
    const preserved = await database.db
      .selectFrom("billingRecords")
      .select(["customerName", "customerEmail"])
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(preserved).toEqual({
      customerName: "Linked Member",
      customerEmail: "linked-member@example.com",
    });
  });

  it("links an existing unassigned record using identity data from the server", async () => {
    const created = await request(app)
      .post("/api/billing")
      .set("Cookie", adminCookie)
      .send({
        customerName: "Temporary customer",
        customerEmail: "temporary@example.com",
        concept: "Trial",
        billingCycle: "trial_day",
        customCycleLabel: "",
        amountCents: 1500,
        currency: "EUR",
        status: "pending",
        dueAt: null,
        paidAt: null,
        invoiceNumber: null,
        notes: "",
      })
      .expect(201);

    const linked = await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({
        userId: "billing-member",
        customerName: "Spoofed while linking",
        customerEmail: "spoofed-link@example.com",
      })
      .expect(200);
    expect(linked.body).toMatchObject({
      userId: "billing-member",
      customerName: "Linked Member",
      customerEmail: "linked-member@example.com",
    });
  });

  it("treats SQL wildcard characters as literal member search text", async () => {
    const search = await request(app)
      .get("/api/billing/members?query=%25_")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(search.body).toEqual([]);
  });

  it("rejects malformed administrative filters instead of broadening queries", async () => {
    await request(app)
      .get("/api/billing?status=unknown")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app)
      .get("/api/billing?from=not-a-date")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app)
      .get("/api/billing?from=200&to=100")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app)
      .get("/api/billing?currency=EURO")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app)
      .get("/api/billing?concept=%25_")
      .set("Cookie", adminCookie)
      .expect(400);
  });

  it("isolates billing documents by the selected facility", async () => {
    const created = await request(app)
      .post("/api/billing")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .send({
        userId: "billing-member",
        customerName: "Ignored snapshot",
        customerEmail: "ignored@example.com",
        concept: "Secondary membership",
        billingCycle: "monthly",
        customCycleLabel: "",
        amountCents: 3000,
        currency: "EUR",
        status: "pending",
        dueAt: null,
        paidAt: null,
        invoiceNumber: "SECONDARY-001",
        notes: "",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      facilityId: "secondary",
      userId: "billing-member",
    });

    const facility_alpha = await request(app)
      .get("/api/billing")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(
      facility_alpha.body.some(
        (record: { id: string }) => record.id === created.body.id,
      ),
    ).toBe(false);

    const secondary = await request(app)
      .get("/api/billing")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "secondary")
      .expect(200);
    expect(secondary.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        facilityId: "secondary",
      }),
    ]);

    await request(app)
      .patch(`/api/billing/${created.body.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "paid" })
      .expect(404);
    await expect(
      database.db
        .selectFrom("billingRecords")
        .select("status")
        .where("id", "=", created.body.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "pending" });
  });

  it("summarises active billing documents without mixing currencies", async () => {
    const summary = await request(app)
      .get("/api/billing/summary")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(summary.body.documentCount).toBeGreaterThan(0);
    expect(summary.body.currencies).toEqual(
      expect.objectContaining({
        EUR: expect.objectContaining({ documents: expect.any(Number) }),
      }),
    );
  });
});

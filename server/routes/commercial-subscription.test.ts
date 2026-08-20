import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StripeBillingGateway } from "../services/stripe-billing-gateway.js";

describe("commercial subscription API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let subscriptionService: typeof import("../services/commercial-subscription.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  const gateway: StripeBillingGateway = {
    async createCustomer(input) {
      return { id: `cus_${input.facilityId}` };
    },
    async createCheckoutSession(input) {
      return {
        id: `cs_${input.facilityId}`,
        url: `https://checkout.stripe.test/${input.facilityId}`,
      };
    },
    async createPortalSession(input) {
      return { url: `https://billing.stripe.test/${input.customerId}` };
    },
    async retrieveSubscription() {
      throw new Error("not used by this route test");
    },
    constructWebhookEvent(body) {
      return JSON.parse(body.toString("utf8")) as Stripe.Event;
    },
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-stripe-routes-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "http://localhost:3000");
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_RESTRICTED_API_KEY", "rk_test_example");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
    vi.stubEnv("STRIPE_PRICE_FORGE_MONTHLY", "price_monthly");
    vi.stubEnv("STRIPE_PRICE_FORGE_ANNUAL", "price_annual");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "subscription-admin",
          email: "subscription-admin@example.com",
          phone: null,
          name: "Subscription Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("SubscriptionAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        },
        {
          id: "subscription-member",
          email: "subscription-member@example.com",
          phone: null,
          name: "Subscription Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("SubscriptionMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        },
      ])
      .execute();
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "subscription-secondary",
        slug: "subscription-secondary",
        name: "Subscription Secondary",
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
        id: "subscription-secondary:admin",
        facilityId: "subscription-secondary",
        userId: "subscription-admin",
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    subscriptionService =
      await import("../services/commercial-subscription.js");
    subscriptionService.setStripeBillingGatewayFactoryForTests(() => gateway);
    app = (await import("../index.js")).app;
    const login = async (
      identifier: string,
      accessPortal: "member" | "staff",
    ) =>
      (
        await request(app)
          .post("/api/auth/login")
          .send({
            identifier,
            password:
              accessPortal === "staff"
                ? "SubscriptionAdmin123"
                : "SubscriptionMember123",
            accessPortal,
            rememberDevice: false,
          })
      ).headers["set-cookie"][0];
    adminCookie = await login("subscription-admin@example.com", "staff");
    memberCookie = await login("subscription-member@example.com", "member");
  });

  afterAll(async () => {
    subscriptionService.setStripeBillingGatewayFactoryForTests(null);
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("requires an administrator of the selected centre", async () => {
    await request(app).get("/api/commercial-subscription").expect(401);
    await request(app)
      .get("/api/commercial-subscription")
      .set("Cookie", memberCookie)
      .expect(403);
  });

  it("uses the selected centre and a server-side plan", async () => {
    const response = await request(app)
      .post("/api/commercial-subscription/checkout")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "subscription-secondary")
      .send({ plan: "annual", priceId: "price_attacker" })
      .expect(201);
    expect(response.body).toEqual({
      url: "https://checkout.stripe.test/subscription-secondary",
    });
    expect(
      await database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["facilityId", "stripePriceId"])
        .where("facilityId", "=", "subscription-secondary")
        .executeTakeFirstOrThrow(),
    ).toEqual({
      facilityId: "subscription-secondary",
      stripePriceId: "price_annual",
    });
  });

  it("requires a signature header and accepts the exact raw webhook body", async () => {
    const event = {
      id: "evt_route_checkout",
      type: "checkout.session.completed",
      created: 1_900_000_000,
      livemode: false,
      data: {
        object: {
          id: "cs_subscription-secondary",
          object: "checkout.session",
          customer: "cus_subscription-secondary",
          subscription: "sub_subscription-secondary",
          client_reference_id: "subscription-secondary",
          metadata: {
            facility_id: "subscription-secondary",
            plan_key: "annual",
          },
        },
      },
    };
    await request(app)
      .post("/api/internal/stripe-billing")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(event))
      .expect(401);
    await request(app)
      .post("/api/internal/stripe-billing")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "test-signature")
      .send(JSON.stringify(event))
      .expect(200)
      .expect({ accepted: true, duplicate: false });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StripeBillingGateway } from "./stripe-billing-gateway.js";

describe("commercial subscriptions", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let service: typeof import("./commercial-subscription.js");
  const checkoutInputs: Array<Record<string, unknown>> = [];
  const portalInputs: Array<Record<string, unknown>> = [];
  let currentSubscription: Stripe.Subscription | null = null;

  const gateway: StripeBillingGateway = {
    async createCustomer(input) {
      expect(input.idempotencyKey).toMatch(
        new RegExp(`^forge-customer-(test|live)-${input.facilityId}$`),
      );
      return { id: `cus_${input.facilityId.replaceAll("-", "_")}` };
    },
    async createCheckoutSession(input) {
      checkoutInputs.push(input);
      return {
        id: `cs_test_${input.facilityId.replaceAll("-", "_")}`,
        url: "https://checkout.stripe.test/session",
      };
    },
    async createPortalSession(input) {
      portalInputs.push(input);
      return { url: "https://billing.stripe.test/portal" };
    },
    async retrieveSubscription(subscriptionId) {
      if (!currentSubscription || currentSubscription.id !== subscriptionId) {
        throw new Error("Missing current Stripe subscription test fixture");
      }
      return currentSubscription;
    },
    constructWebhookEvent() {
      throw new Error("not used by this service test");
    },
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-stripe-"));
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
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "facility-alpha",
        slug: "facility-alpha",
        name: "Facility Alpha",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    service = await import("./commercial-subscription.js");
    service.setStripeBillingGatewayFactoryForTests(() => gateway);
  });

  async function ingest(
    event: Stripe.Event,
    retrievedSubscription?: Stripe.Subscription,
  ) {
    if (event.type.startsWith("customer.subscription.")) {
      currentSubscription =
        retrievedSubscription ?? (event.data.object as Stripe.Subscription);
    }
    return service.ingestStripeWebhookEvent(event);
  }

  afterAll(async () => {
    service.setStripeBillingGatewayFactoryForTests(null);
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates Checkout on server-selected prices and activates only by webhook", async () => {
    const checkout = await service.createCommercialCheckout({
      facilityId: "facility-alpha",
      email: "owner@example.com",
      plan: "monthly",
    });
    expect(checkout.url).toBe("https://checkout.stripe.test/session");
    expect(checkoutInputs[0]).toMatchObject({
      customerId: "cus_facility_alpha",
      facilityId: "facility-alpha",
      plan: "monthly",
      priceId: "price_monthly",
      successUrl: "http://localhost:3000/admin/subscription?checkout=success",
      cancelUrl: "http://localhost:3000/admin/subscription?checkout=cancelled",
    });
    expect(
      await database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "stripePriceId", "stripeCheckoutSessionId"])
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: "checkout_pending",
      stripePriceId: "price_monthly",
      stripeCheckoutSessionId: "cs_test_facility_alpha",
    });

    const event = {
      id: "evt_subscription_active",
      type: "customer.subscription.updated",
      created: 1_800_000_000,
      livemode: false,
      data: {
        object: {
          id: "sub_facility_alpha",
          object: "subscription",
          customer: "cus_facility_alpha",
          metadata: { facility_id: "facility-alpha", plan_key: "monthly" },
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: "price_monthly" },
                current_period_end: 1_802_592_000,
              },
            ],
          },
        },
      },
    } as unknown as Stripe.Event;
    expect(await ingest(event)).toEqual({
      accepted: true,
      duplicate: false,
    });
    expect(await ingest(event)).toEqual({
      accepted: true,
      duplicate: true,
    });

    const overview =
      await service.getCommercialSubscriptionOverview("facility-alpha");
    expect(overview.subscription).toMatchObject({
      status: "active",
      plan: "monthly",
      canOpenPortal: true,
    });
    expect(overview.entitlements).toMatchObject({
      source: "stripe",
      capabilities: { analytics: true, crm: true },
    });

    await ingest({
      id: "evt_checkout_delivered_late",
      type: "checkout.session.completed",
      created: 1_900_000_000,
      livemode: false,
      data: {
        object: {
          id: "cs_test_facility_alpha",
          object: "checkout.session",
          customer: "cus_facility_alpha",
          subscription: "sub_facility_alpha",
          client_reference_id: "facility-alpha",
          metadata: { facility_id: "facility-alpha", plan_key: "monthly" },
        },
      },
    } as unknown as Stripe.Event);
    expect(
      await database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "currentPeriodEnd"])
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: "active",
      currentPeriodEnd: 1_802_592_000_000,
    });

    await ingest({
      id: "evt_subscription_price_change",
      type: "customer.subscription.updated",
      created: 1_900_000_001,
      livemode: false,
      data: {
        object: {
          id: "sub_facility_alpha",
          object: "subscription",
          customer: "cus_facility_alpha",
          metadata: { facility_id: "facility-alpha", plan_key: "monthly" },
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: "price_annual" },
                current_period_end: 1_834_128_000,
              },
            ],
          },
        },
      },
    } as unknown as Stripe.Event);
    await expect(
      database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["planKey", "stripePriceId"])
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      planKey: "annual",
      stripePriceId: "price_annual",
    });

    const latestSubscription = currentSubscription;
    if (!latestSubscription) throw new Error("Expected subscription fixture");
    await ingest(
      {
        id: "evt_subscription_same_second_stale",
        type: "customer.subscription.updated",
        created: 1_900_000_001,
        livemode: false,
        data: {
          object: {
            ...latestSubscription,
            status: "past_due",
            metadata: { facility_id: "facility-alpha", plan_key: "monthly" },
            items: {
              data: [
                {
                  price: { id: "price_monthly" },
                  current_period_end: 1_802_592_000,
                },
              ],
            },
          },
        },
      } as unknown as Stripe.Event,
      latestSubscription,
    );
    await expect(
      database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "planKey", "stripePriceId"])
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "active",
      planKey: "annual",
      stripePriceId: "price_annual",
    });
  });

  it("rejects webhook events from the other Stripe mode", async () => {
    await expect(
      ingest({
        id: "evt_live_in_test",
        type: "customer.subscription.updated",
        created: 1_900_000_002,
        livemode: true,
        data: { object: {} },
      } as unknown as Stripe.Event),
    ).rejects.toMatchObject({
      code: "STRIPE_EVENT_MODE_MISMATCH",
      statusCode: 400,
    });
  });

  it("creates a separate Customer binding when production moves to Live", async () => {
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "facility-live",
        slug: "facility-live",
        name: "Facility Live",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIENT_ORIGIN", "https://app.umbraviaforge.test");
    vi.stubEnv("STRIPE_BILLING_MODE", "live");
    vi.stubEnv("STRIPE_RESTRICTED_API_KEY", "rk_live_example");
    try {
      await service.createCommercialCheckout({
        facilityId: "facility-live",
        email: "live@example.com",
        plan: "annual",
      });
      await expect(
        database.db
          .selectFrom("facilityCommercialSubscriptions")
          .select(["stripeLivemode", "status", "stripeCustomerId"])
          .where("facilityId", "=", "facility-live")
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({
        stripeLivemode: 1,
        status: "checkout_pending",
        stripeCustomerId: "cus_facility_live",
      });
      await expect(
        service.getCommercialSubscriptionOverview("facility-live"),
      ).resolves.toMatchObject({ mode: "live", testMode: false });
    } finally {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("CLIENT_ORIGIN", "http://localhost:3000");
      vi.stubEnv("STRIPE_BILLING_MODE", "test");
      vi.stubEnv("STRIPE_RESTRICTED_API_KEY", "rk_test_example");
    }

    await expect(
      service.getCommercialSubscriptionOverview("facility-live"),
    ).resolves.toMatchObject({
      mode: "test",
      subscription: { status: "inactive", canOpenPortal: false },
    });
  });

  it("does not let an older event or a foreign customer change access", async () => {
    const event = (input: {
      id: string;
      created: number;
      customer: string;
      status: string;
    }) =>
      ({
        id: input.id,
        type: "customer.subscription.updated",
        created: input.created,
        livemode: false,
        data: {
          object: {
            id: "sub_facility_alpha",
            object: "subscription",
            customer: input.customer,
            metadata: { facility_id: "facility-alpha", plan_key: "monthly" },
            status: input.status,
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: { id: "price_monthly" },
                  current_period_end: 1_802_592_000,
                },
              ],
            },
          },
        },
      }) as unknown as Stripe.Event;

    await ingest(
      event({
        id: "evt_old",
        created: 1_700_000_000,
        customer: "cus_facility_alpha",
        status: "canceled",
      }),
    );
    await ingest(
      event({
        id: "evt_foreign",
        created: 1_900_000_000,
        customer: "cus_foreign",
        status: "canceled",
      }),
    );
    const stored = await database.db
      .selectFrom("facilityCommercialSubscriptions")
      .select("status")
      .where("facilityId", "=", "facility-alpha")
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe("active");
    expect(
      await database.db
        .selectFrom("stripeWebhookEvents")
        .select("facilityId")
        .where("eventId", "=", "evt_foreign")
        .executeTakeFirstOrThrow(),
    ).toEqual({ facilityId: null });
  });

  it("closes only the matching pending Checkout attempt when it expires", async () => {
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "facility-checkout-expiry",
        slug: "facility-checkout-expiry",
        name: "Checkout expiry",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await service.createCommercialCheckout({
      facilityId: "facility-checkout-expiry",
      email: "expiry@example.com",
      plan: "annual",
    });

    await ingest({
      id: "evt_checkout_expired",
      type: "checkout.session.expired",
      created: 1_900_000_100,
      livemode: false,
      data: {
        object: {
          id: "cs_test_facility_checkout_expiry",
          object: "checkout.session",
          customer: "cus_facility_checkout_expiry",
          subscription: null,
          client_reference_id: "facility-checkout-expiry",
          metadata: {
            facility_id: "facility-checkout-expiry",
            plan_key: "annual",
          },
        },
      },
    } as unknown as Stripe.Event);

    await expect(
      database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "stripeCheckoutSessionId"])
        .where("facilityId", "=", "facility-checkout-expiry")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      status: "inactive",
      stripeCheckoutSessionId: null,
    });
  });

  it("opens the Stripe customer portal without accepting a return URL", async () => {
    expect(await service.createCommercialPortal("facility-alpha")).toEqual({
      url: "https://billing.stripe.test/portal",
    });
    expect(portalInputs[0]).toEqual({
      customerId: "cus_facility_alpha",
      returnUrl: "http://localhost:3000/admin/subscription",
      portalConfigurationId: null,
    });
  });
});

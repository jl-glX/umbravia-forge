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

  const gateway: StripeBillingGateway = {
    async createCustomer(input) {
      expect(input.idempotencyKey).toBe("forge-customer-primary");
      return { id: "cus_primary" };
    },
    async createCheckoutSession(input) {
      checkoutInputs.push(input);
      return {
        id: "cs_test_primary",
        url: "https://checkout.stripe.test/session",
      };
    },
    async createPortalSession(input) {
      portalInputs.push(input);
      return { url: "https://billing.stripe.test/portal" };
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
    service = await import("./commercial-subscription.js");
    service.setStripeBillingGatewayFactoryForTests(() => gateway);
  });

  afterAll(async () => {
    service.setStripeBillingGatewayFactoryForTests(null);
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates Checkout on server-selected prices and activates only by webhook", async () => {
    const checkout = await service.createCommercialCheckout({
      facilityId: "primary",
      email: "owner@example.com",
      plan: "monthly",
    });
    expect(checkout.url).toBe("https://checkout.stripe.test/session");
    expect(checkoutInputs[0]).toMatchObject({
      customerId: "cus_primary",
      facilityId: "primary",
      plan: "monthly",
      priceId: "price_monthly",
      successUrl: "http://localhost:3000/admin/subscription?checkout=success",
      cancelUrl: "http://localhost:3000/admin/subscription?checkout=cancelled",
    });
    expect(
      await database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "stripePriceId"])
        .where("facilityId", "=", "primary")
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "checkout_pending", stripePriceId: "price_monthly" });

    const event = {
      id: "evt_subscription_active",
      type: "customer.subscription.updated",
      created: 1_800_000_000,
      livemode: false,
      data: {
        object: {
          id: "sub_primary",
          object: "subscription",
          customer: "cus_primary",
          metadata: { facility_id: "primary", plan_key: "monthly" },
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
    expect(await service.ingestStripeWebhookEvent(event)).toEqual({
      accepted: true,
      duplicate: false,
    });
    expect(await service.ingestStripeWebhookEvent(event)).toEqual({
      accepted: true,
      duplicate: true,
    });

    const overview = await service.getCommercialSubscriptionOverview("primary");
    expect(overview.subscription).toMatchObject({
      status: "active",
      plan: "monthly",
      canOpenPortal: true,
    });
    expect(overview.entitlements).toMatchObject({
      source: "stripe",
      capabilities: { analytics: true, crm: true },
    });

    await service.ingestStripeWebhookEvent({
      id: "evt_checkout_delivered_late",
      type: "checkout.session.completed",
      created: 1_900_000_000,
      livemode: false,
      data: {
        object: {
          id: "cs_test_primary",
          object: "checkout.session",
          customer: "cus_primary",
          subscription: "sub_primary",
          client_reference_id: "primary",
          metadata: { facility_id: "primary", plan_key: "monthly" },
        },
      },
    } as unknown as Stripe.Event);
    expect(
      await database.db
        .selectFrom("facilityCommercialSubscriptions")
        .select(["status", "currentPeriodEnd"])
        .where("facilityId", "=", "primary")
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: "active",
      currentPeriodEnd: 1_802_592_000_000,
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
            id: "sub_primary",
            object: "subscription",
            customer: input.customer,
            metadata: { facility_id: "primary", plan_key: "monthly" },
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

    await service.ingestStripeWebhookEvent(
      event({
        id: "evt_old",
        created: 1_700_000_000,
        customer: "cus_primary",
        status: "canceled",
      }),
    );
    await service.ingestStripeWebhookEvent(
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
      .where("facilityId", "=", "primary")
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

  it("opens the Stripe customer portal without accepting a return URL", async () => {
    expect(await service.createCommercialPortal("primary")).toEqual({
      url: "https://billing.stripe.test/portal",
    });
    expect(portalInputs[0]).toEqual({
      customerId: "cus_primary",
      returnUrl: "http://localhost:3000/admin/subscription",
      portalConfigurationId: null,
    });
  });
});

import type Stripe from "stripe";
import { db } from "../db/client.js";
import type { CommercialSubscriptionStatus } from "../db/types.js";
import {
  resolveStripeBillingConfiguration,
  type CommercialPlanKey,
  type StripeBillingConfiguration,
} from "../lib/stripe-billing-config.js";
import { getAllowedClientOrigins } from "../lib/request-origin.js";
import { getCommercialEntitlements } from "./commercial-entitlements.js";
import {
  OfficialStripeBillingGateway,
  type StripeBillingGateway,
} from "./stripe-billing-gateway.js";

type GatewayFactory = (
  configuration: StripeBillingConfiguration,
) => StripeBillingGateway;

let gatewayFactory: GatewayFactory = (configuration) =>
  new OfficialStripeBillingGateway(configuration);

export function setStripeBillingGatewayFactoryForTests(
  factory: GatewayFactory | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The Stripe billing gateway can only be replaced in tests");
  }
  gatewayFactory =
    factory ??
    ((configuration) => new OfficialStripeBillingGateway(configuration));
}

function requestError(message: string, code: string, statusCode: number) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireConfiguration(): StripeBillingConfiguration {
  const configuration = resolveStripeBillingConfiguration();
  if (!configuration) {
    throw requestError(
      "Stripe billing is not enabled",
      "STRIPE_BILLING_DISABLED",
      503,
    );
  }
  return configuration;
}

function subscriptionStatus(
  status: Stripe.Subscription.Status,
): CommercialSubscriptionStatus {
  const supported = new Set<CommercialSubscriptionStatus>([
    "trialing",
    "active",
    "past_due",
    "unpaid",
    "paused",
    "canceled",
    "incomplete",
    "incomplete_expired",
  ]);
  return supported.has(status as CommercialSubscriptionStatus)
    ? (status as CommercialSubscriptionStatus)
    : "incomplete";
}

function stripeObjectId(value: { id: string } | string | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function planFromMetadata(
  value: string | undefined,
  priceId: string | null,
  configuration: StripeBillingConfiguration,
): CommercialPlanKey | null {
  if (value === "monthly" || value === "annual") return value;
  if (priceId === configuration.prices.monthly) return "monthly";
  if (priceId === configuration.prices.annual) return "annual";
  return null;
}

export async function getCommercialSubscriptionOverview(facilityId: string) {
  const configuration = resolveStripeBillingConfiguration();
  const subscription = await db
    .selectFrom("facilityCommercialSubscriptions")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  const entitlements = await getCommercialEntitlements(facilityId);

  return {
    configured: configuration !== null,
    testMode: configuration?.liveMode === false,
    plans: {
      monthly: Boolean(configuration?.prices.monthly),
      annual: Boolean(configuration?.prices.annual),
    },
    subscription: subscription
      ? {
          plan: subscription.planKey,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === 1,
          canOpenPortal: Boolean(subscription.stripeCustomerId),
        }
      : {
          plan: null,
          status: "inactive" as const,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          canOpenPortal: false,
        },
    entitlements,
  };
}

async function ensureStripeCustomer(input: {
  facilityId: string;
  email: string;
  gateway: StripeBillingGateway;
}): Promise<string> {
  const existing = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select(["stripeCustomerId", "status"])
    .where("facilityId", "=", input.facilityId)
    .executeTakeFirst();
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const facility = await db
    .selectFrom("facilityProfiles")
    .select("name")
    .where("id", "=", input.facilityId)
    .executeTakeFirstOrThrow();
  const customer = await input.gateway.createCustomer({
    email: input.email,
    name: facility.name,
    facilityId: input.facilityId,
    idempotencyKey: `forge-customer-${input.facilityId}`,
  });
  const now = Date.now();
  await db
    .insertInto("facilityCommercialSubscriptions")
    .values({
      facilityId: input.facilityId,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      stripePriceId: null,
      planKey: null,
      status: existing?.status ?? "inactive",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: 0,
      lastStripeEventCreatedAt: null,
      lastStripeEventId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict.column("facilityId").doUpdateSet({
        stripeCustomerId: customer.id,
        updatedAt: now,
      }),
    )
    .execute();
  return customer.id;
}

export async function createCommercialCheckout(input: {
  facilityId: string;
  email: string;
  plan: CommercialPlanKey;
}) {
  const configuration = requireConfiguration();
  const gateway = gatewayFactory(configuration);
  const existing = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select("status")
    .where("facilityId", "=", input.facilityId)
    .executeTakeFirst();
  if (existing && ["active", "trialing"].includes(existing.status)) {
    throw requestError(
      "The centre already has an active subscription",
      "SUBSCRIPTION_ALREADY_ACTIVE",
      409,
    );
  }

  const customerId = await ensureStripeCustomer({
    facilityId: input.facilityId,
    email: input.email,
    gateway,
  });
  const origin = getAllowedClientOrigins()[0];
  if (!origin) throw new Error("A trusted client origin is required");
  const idempotencyWindow = Math.floor(Date.now() / (5 * 60 * 1000));
  const session = await gateway.createCheckoutSession({
    customerId,
    facilityId: input.facilityId,
    plan: input.plan,
    priceId: configuration.prices[input.plan],
    successUrl: `${origin}/admin/subscription?checkout=success`,
    cancelUrl: `${origin}/admin/subscription?checkout=cancelled`,
    idempotencyKey: `forge-checkout-${input.facilityId}-${input.plan}-${idempotencyWindow}`,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");

  await db
    .updateTable("facilityCommercialSubscriptions")
    .set({
      planKey: input.plan,
      stripeCheckoutSessionId: session.id,
      stripePriceId: configuration.prices[input.plan],
      status: "checkout_pending",
      updatedAt: Date.now(),
    })
    .where("facilityId", "=", input.facilityId)
    .where("stripeCustomerId", "=", customerId)
    .executeTakeFirstOrThrow();
  return { url: session.url };
}

export async function createCommercialPortal(facilityId: string) {
  const configuration = requireConfiguration();
  const subscription = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select("stripeCustomerId")
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!subscription?.stripeCustomerId) {
    throw requestError(
      "The centre does not have a Stripe customer yet",
      "STRIPE_CUSTOMER_NOT_FOUND",
      409,
    );
  }
  const origin = getAllowedClientOrigins()[0];
  if (!origin) throw new Error("A trusted client origin is required");
  const session = await gatewayFactory(configuration).createPortalSession({
    customerId: subscription.stripeCustomerId,
    returnUrl: `${origin}/admin/subscription`,
    portalConfigurationId: configuration.portalConfigurationId,
  });
  return { url: session.url };
}

export function constructStripeWebhookEvent(
  body: Buffer,
  signature: string,
): Stripe.Event {
  const configuration = requireConfiguration();
  return gatewayFactory(configuration).constructWebhookEvent(
    body,
    signature,
    configuration.webhookSecret,
  );
}

export async function ingestStripeWebhookEvent(event: Stripe.Event) {
  const configuration = requireConfiguration();
  if (event.livemode) {
    throw requestError(
      "Live Stripe events are not accepted by this test-mode integration",
      "STRIPE_LIVE_EVENT_REJECTED",
      400,
    );
  }

  const eventCreatedAt = event.created * 1000;
  let facilityId: string | null = null;
  let customerId: string | null = null;
  let subscriptionId: string | null = null;
  let checkoutSessionId: string | null = null;
  let priceId: string | null = null;
  let plan: CommercialPlanKey | null = null;
  let status: CommercialSubscriptionStatus | null = null;
  let currentPeriodEnd: number | null = null;
  let cancelAtPeriodEnd = 0;

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object;
    checkoutSessionId = session.id;
    facilityId = session.metadata?.facility_id ?? session.client_reference_id;
    customerId = stripeObjectId(session.customer);
    subscriptionId = stripeObjectId(session.subscription);
    plan = planFromMetadata(session.metadata?.plan_key, null, configuration);
    status =
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
        ? "inactive"
        : "checkout_pending";
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object;
    facilityId = subscription.metadata.facility_id ?? null;
    customerId = stripeObjectId(subscription.customer);
    subscriptionId = subscription.id;
    const item = subscription.items.data[0];
    priceId = item ? stripeObjectId(item.price) : null;
    plan = planFromMetadata(
      subscription.metadata.plan_key,
      priceId,
      configuration,
    );
    status =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : subscriptionStatus(subscription.status);
    currentPeriodEnd = item?.current_period_end
      ? item.current_period_end * 1000
      : null;
    cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;
  }

  const duplicate = await db.transaction().execute(async (transaction) => {
    const processed = await transaction
      .selectFrom("stripeWebhookEvents")
      .select("eventId")
      .where("eventId", "=", event.id)
      .executeTakeFirst();
    if (processed) return true;

    if (facilityId && customerId && status) {
      const local = await transaction
        .selectFrom("facilityCommercialSubscriptions")
        .select([
          "stripeCustomerId",
          "stripeCheckoutSessionId",
          "status",
          "lastStripeEventCreatedAt",
        ])
        .where("facilityId", "=", facilityId)
        .executeTakeFirst();
      const checkoutEvent = event.type.startsWith("checkout.session.");
      const checkoutFailed =
        event.type === "checkout.session.async_payment_failed" ||
        event.type === "checkout.session.expired";
      const currentCheckout =
        !checkoutEvent || local?.stripeCheckoutSessionId === checkoutSessionId;
      const trustedMapping =
        local?.stripeCustomerId === customerId &&
        currentCheckout &&
        (checkoutEvent ||
          local.lastStripeEventCreatedAt === null ||
          eventCreatedAt >= local.lastStripeEventCreatedAt);
      if (trustedMapping) {
        const checkoutCanChangeStatus =
          checkoutEvent &&
          (local.status === "inactive" || local.status === "checkout_pending");
        await transaction
          .updateTable("facilityCommercialSubscriptions")
          .set({
            ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
            ...(!checkoutEvent || checkoutFailed
              ? { stripeCheckoutSessionId: null }
              : {}),
            ...(priceId ? { stripePriceId: priceId } : {}),
            ...(plan ? { planKey: plan } : {}),
            ...(!checkoutEvent || checkoutCanChangeStatus ? { status } : {}),
            ...(!checkoutEvent
              ? {
                  currentPeriodEnd,
                  cancelAtPeriodEnd,
                  lastStripeEventCreatedAt: eventCreatedAt,
                  lastStripeEventId: event.id,
                }
              : {}),
            updatedAt: Date.now(),
          })
          .where("facilityId", "=", facilityId)
          .where("stripeCustomerId", "=", customerId)
          .execute();
      } else {
        facilityId = null;
      }
    } else {
      facilityId = null;
    }

    const now = Date.now();
    await transaction
      .insertInto("stripeWebhookEvents")
      .values({
        eventId: event.id,
        eventType: event.type,
        facilityId,
        stripeCreatedAt: eventCreatedAt,
        livemode: event.livemode ? 1 : 0,
        receivedAt: now,
        processedAt: now,
      })
      .execute();
    return false;
  });

  return { accepted: true, duplicate };
}

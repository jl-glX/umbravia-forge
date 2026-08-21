import type Stripe from "stripe";
import { db } from "../db/client.js";
import type {
  CommercialBillingAttention,
  CommercialSubscriptionStatus,
} from "../db/types.js";
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

type OperationalInvoiceEvent =
  | Stripe.InvoiceFinalizationFailedEvent
  | Stripe.InvoiceMarkedUncollectibleEvent
  | Stripe.InvoiceOverdueEvent
  | Stripe.InvoicePaidEvent
  | Stripe.InvoicePaymentActionRequiredEvent
  | Stripe.InvoicePaymentFailedEvent
  | Stripe.InvoicePaymentSucceededEvent;

function isOperationalInvoiceEvent(
  event: Stripe.Event,
): event is OperationalInvoiceEvent {
  return [
    "invoice.finalization_failed",
    "invoice.marked_uncollectible",
    "invoice.overdue",
    "invoice.paid",
    "invoice.payment_action_required",
    "invoice.payment_failed",
    "invoice.payment_succeeded",
  ].includes(event.type);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return stripeObjectId(
    invoice.parent?.subscription_details?.subscription ?? null,
  );
}

function billingAttentionFromInvoiceEvent(
  event: OperationalInvoiceEvent,
): CommercialBillingAttention {
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_succeeded"
  ) {
    return "none";
  }
  if (event.type === "invoice.payment_action_required") {
    return "payment_action_required";
  }
  if (event.type === "invoice.finalization_failed") {
    return "invoice_finalization_failed";
  }
  return "payment_failed";
}

function planFromMetadata(
  value: string | undefined,
  priceId: string | null,
  configuration: StripeBillingConfiguration,
): CommercialPlanKey | null {
  if (priceId === configuration.prices.monthly) return "monthly";
  if (priceId === configuration.prices.annual) return "annual";
  if (priceId !== null) return null;
  if (value === "monthly" || value === "annual") return value;
  return null;
}

function requireSubscriptionMode(
  subscription: Stripe.Subscription,
  configuration: StripeBillingConfiguration,
): void {
  if (subscription.livemode !== configuration.liveMode) {
    throw requestError(
      "The Stripe subscription mode does not match this billing environment",
      "STRIPE_SUBSCRIPTION_MODE_MISMATCH",
      400,
    );
  }
}

function trustedClientOrigin(
  configuration: StripeBillingConfiguration,
): string {
  const origin = getAllowedClientOrigins()[0];
  if (!origin) throw new Error("A trusted client origin is required");
  if (configuration.liveMode && new URL(origin).protocol !== "https:") {
    throw requestError(
      "Stripe Live billing requires an HTTPS client origin",
      "STRIPE_LIVE_ORIGIN_INSECURE",
      503,
    );
  }
  return origin;
}

export async function getCommercialSubscriptionOverview(facilityId: string) {
  const configuration = resolveStripeBillingConfiguration();
  const subscription = configuration
    ? await db
        .selectFrom("facilityCommercialSubscriptions")
        .selectAll()
        .where("facilityId", "=", facilityId)
        .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
        .executeTakeFirst()
    : null;
  const entitlements = await getCommercialEntitlements(facilityId);

  return {
    configured: configuration !== null,
    testMode: configuration?.liveMode === false,
    mode: configuration?.mode ?? "disabled",
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
          billingAttention: subscription.billingAttention,
          lastInvoiceEventAt: subscription.lastInvoiceEventAt,
          lastReconciledAt: subscription.lastReconciledAt,
          canOpenPortal: Boolean(subscription.stripeCustomerId),
          canReconcile: Boolean(subscription.stripeSubscriptionId),
        }
      : {
          plan: null,
          status: "inactive" as const,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          billingAttention: "none" as const,
          lastInvoiceEventAt: null,
          lastReconciledAt: null,
          canOpenPortal: false,
          canReconcile: false,
        },
    entitlements,
  };
}

async function ensureStripeCustomer(input: {
  facilityId: string;
  email: string;
  gateway: StripeBillingGateway;
  configuration: StripeBillingConfiguration;
}): Promise<string> {
  const existing = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select(["stripeCustomerId", "status", "stripeLivemode"])
    .where("facilityId", "=", input.facilityId)
    .executeTakeFirst();
  const stripeLivemode = input.configuration.liveMode ? 1 : 0;
  if (
    existing?.stripeCustomerId &&
    existing.stripeLivemode === stripeLivemode
  ) {
    return existing.stripeCustomerId;
  }

  const facility = await db
    .selectFrom("facilityProfiles")
    .select("name")
    .where("id", "=", input.facilityId)
    .executeTakeFirstOrThrow();
  const customer = await input.gateway.createCustomer({
    email: input.email,
    name: facility.name,
    facilityId: input.facilityId,
    idempotencyKey: `forge-customer-${input.configuration.mode}-${input.facilityId}`,
  });
  const now = Date.now();
  await db
    .insertInto("facilityCommercialSubscriptions")
    .values({
      facilityId: input.facilityId,
      stripeLivemode,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      stripePriceId: null,
      planKey: null,
      status: existing?.status ?? "inactive",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: 0,
      billingAttention: "none",
      lastInvoiceEventAt: null,
      lastReconciledAt: null,
      lastStripeEventCreatedAt: null,
      lastStripeEventId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict.column("facilityId").doUpdateSet({
        stripeLivemode,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
        stripePriceId: null,
        planKey: null,
        status: "inactive",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: 0,
        billingAttention: "none",
        lastInvoiceEventAt: null,
        lastReconciledAt: null,
        lastStripeEventCreatedAt: null,
        lastStripeEventId: null,
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
  const origin = trustedClientOrigin(configuration);
  const gateway = gatewayFactory(configuration);
  const existing = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select(["status", "stripeSubscriptionId", "stripeCheckoutSessionId"])
    .where("facilityId", "=", input.facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (existing && ["active", "trialing"].includes(existing.status)) {
    throw requestError(
      "The centre already has an active subscription",
      "SUBSCRIPTION_ALREADY_ACTIVE",
      409,
    );
  }
  if (
    existing?.stripeSubscriptionId &&
    !["canceled", "incomplete_expired"].includes(existing.status)
  ) {
    throw requestError(
      "The existing Stripe subscription must be recovered or managed in the customer portal",
      "SUBSCRIPTION_REQUIRES_PORTAL",
      409,
    );
  }
  if (
    existing?.status === "checkout_pending" &&
    existing.stripeCheckoutSessionId
  ) {
    throw requestError(
      "The centre already has a pending Stripe Checkout session",
      "CHECKOUT_ALREADY_PENDING",
      409,
    );
  }

  const customerId = await ensureStripeCustomer({
    facilityId: input.facilityId,
    email: input.email,
    gateway,
    configuration,
  });
  const idempotencyWindow = Math.floor(Date.now() / (5 * 60 * 1000));
  const session = await gateway.createCheckoutSession({
    customerId,
    facilityId: input.facilityId,
    plan: input.plan,
    priceId: configuration.prices[input.plan],
    successUrl: `${origin}/admin/subscription?checkout=success`,
    cancelUrl: `${origin}/admin/subscription?checkout=cancelled`,
    idempotencyKey: `forge-checkout-${configuration.mode}-${input.facilityId}-${input.plan}-${idempotencyWindow}`,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");

  await db
    .updateTable("facilityCommercialSubscriptions")
    .set({
      planKey: input.plan,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: session.id,
      stripePriceId: configuration.prices[input.plan],
      status: "checkout_pending",
      updatedAt: Date.now(),
    })
    .where("facilityId", "=", input.facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
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
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (!subscription?.stripeCustomerId) {
    throw requestError(
      "The centre does not have a Stripe customer yet",
      "STRIPE_CUSTOMER_NOT_FOUND",
      409,
    );
  }
  const origin = trustedClientOrigin(configuration);
  const session = await gatewayFactory(configuration).createPortalSession({
    customerId: subscription.stripeCustomerId,
    returnUrl: `${origin}/admin/subscription`,
    portalConfigurationId: configuration.portalConfigurationId,
  });
  return { url: session.url };
}

export async function reconcileCommercialSubscription(facilityId: string) {
  const configuration = requireConfiguration();
  const local = await db
    .selectFrom("facilityCommercialSubscriptions")
    .select(["stripeCustomerId", "stripeSubscriptionId", "stripeLivemode"])
    .where("facilityId", "=", facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (!local?.stripeCustomerId || !local.stripeSubscriptionId) {
    throw requestError(
      "The centre does not have a Stripe subscription to reconcile",
      "STRIPE_SUBSCRIPTION_NOT_FOUND",
      409,
    );
  }

  const subscription = await gatewayFactory(configuration).retrieveSubscription(
    local.stripeSubscriptionId,
  );
  requireSubscriptionMode(subscription, configuration);
  const customerId = stripeObjectId(subscription.customer);
  if (
    subscription.metadata.facility_id !== facilityId ||
    customerId !== local.stripeCustomerId ||
    subscription.id !== local.stripeSubscriptionId
  ) {
    throw requestError(
      "Stripe returned a subscription outside the centre billing boundary",
      "STRIPE_SUBSCRIPTION_BOUNDARY_MISMATCH",
      409,
    );
  }

  const item = subscription.items.data[0];
  const priceId = item ? stripeObjectId(item.price) : null;
  const plan = planFromMetadata(
    subscription.metadata.plan_key,
    priceId,
    configuration,
  );
  const status =
    plan === null ? "incomplete" : subscriptionStatus(subscription.status);
  await db
    .updateTable("facilityCommercialSubscriptions")
    .set({
      stripePriceId: priceId,
      planKey: plan,
      status,
      currentPeriodEnd: item?.current_period_end
        ? item.current_period_end * 1000
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
      lastReconciledAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where("facilityId", "=", facilityId)
    .where("stripeCustomerId", "=", customerId)
    .where("stripeSubscriptionId", "=", subscription.id)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .execute();

  return getCommercialSubscriptionOverview(facilityId);
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
  if (event.livemode !== configuration.liveMode) {
    throw requestError(
      "The Stripe event mode does not match this billing environment",
      "STRIPE_EVENT_MODE_MISMATCH",
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
  let billingAttention: CommercialBillingAttention | null = null;
  let lastInvoiceEventAt: number | null = null;

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
    const eventSubscription = event.data.object;
    const subscription = await gatewayFactory(
      configuration,
    ).retrieveSubscription(eventSubscription.id);
    requireSubscriptionMode(subscription, configuration);
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
        : plan === null
          ? "incomplete"
          : subscriptionStatus(subscription.status);
    currentPeriodEnd = item?.current_period_end
      ? item.current_period_end * 1000
      : null;
    cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;
  } else if (isOperationalInvoiceEvent(event)) {
    const invoice = event.data.object;
    subscriptionId = invoiceSubscriptionId(invoice);
    if (subscriptionId) {
      const subscription =
        await gatewayFactory(configuration).retrieveSubscription(
          subscriptionId,
        );
      requireSubscriptionMode(subscription, configuration);
      facilityId = subscription.metadata.facility_id ?? null;
      customerId = stripeObjectId(subscription.customer);
      const item = subscription.items.data[0];
      priceId = item ? stripeObjectId(item.price) : null;
      plan = planFromMetadata(
        subscription.metadata.plan_key,
        priceId,
        configuration,
      );
      status =
        plan === null ? "incomplete" : subscriptionStatus(subscription.status);
      currentPeriodEnd = item?.current_period_end
        ? item.current_period_end * 1000
        : null;
      cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;
      billingAttention = billingAttentionFromInvoiceEvent(event);
      lastInvoiceEventAt = eventCreatedAt;
    }
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
          "stripeLivemode",
          "stripeSubscriptionId",
          "stripeCheckoutSessionId",
          "status",
          "lastInvoiceEventAt",
          "lastStripeEventCreatedAt",
        ])
        .where("facilityId", "=", facilityId)
        .executeTakeFirst();
      const checkoutEvent = event.type.startsWith("checkout.session.");
      const subscriptionEvent = event.type.startsWith("customer.subscription.");
      const invoiceEvent = isOperationalInvoiceEvent(event);
      const checkoutFailed =
        event.type === "checkout.session.async_payment_failed" ||
        event.type === "checkout.session.expired";
      const currentCheckout =
        !checkoutEvent || local?.stripeCheckoutSessionId === checkoutSessionId;
      const currentSubscription =
        checkoutEvent ||
        local?.stripeSubscriptionId === subscriptionId ||
        (local?.stripeSubscriptionId === null && plan !== null);
      const trustedMapping =
        local?.stripeCustomerId === customerId &&
        local.stripeLivemode === (configuration.liveMode ? 1 : 0) &&
        currentCheckout &&
        currentSubscription &&
        (checkoutEvent ||
          (invoiceEvent
            ? local.lastInvoiceEventAt === null ||
              eventCreatedAt >= local.lastInvoiceEventAt
            : local.lastStripeEventCreatedAt === null ||
              eventCreatedAt >= local.lastStripeEventCreatedAt));
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
            ...(!checkoutEvent
              ? { planKey: plan }
              : plan
                ? { planKey: plan }
                : {}),
            ...(!checkoutEvent || checkoutCanChangeStatus ? { status } : {}),
            ...(billingAttention !== null
              ? { billingAttention, lastInvoiceEventAt }
              : {}),
            ...(subscriptionEvent
              ? {
                  currentPeriodEnd,
                  cancelAtPeriodEnd,
                  lastStripeEventCreatedAt: eventCreatedAt,
                  lastStripeEventId: event.id,
                }
              : invoiceEvent
                ? { currentPeriodEnd, cancelAtPeriodEnd }
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

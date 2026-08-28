import type Stripe from "stripe";
import { db } from "../db/client.js";
import type { FacilityStripeAccountStatus } from "../db/types.js";
import {
  resolveStripeConnectConfiguration,
  type StripeConnectConfiguration,
} from "../lib/stripe-connect-config.js";
import { getAllowedClientOrigins } from "../lib/request-origin.js";
import {
  OfficialStripeConnectGateway,
  resolveStripeAccountLocale,
  type ConnectedAccountSnapshot,
  type StripeConnectGateway,
} from "./stripe-connect-gateway.js";

type GatewayFactory = (
  configuration: StripeConnectConfiguration,
) => StripeConnectGateway;

let gatewayFactory: GatewayFactory = (configuration) =>
  new OfficialStripeConnectGateway(configuration);

export function setStripeConnectGatewayFactoryForTests(
  factory: GatewayFactory | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The Stripe Connect gateway can only be replaced in tests");
  }
  gatewayFactory =
    factory ??
    ((configuration) => new OfficialStripeConnectGateway(configuration));
}

function requestError(message: string, code: string, statusCode: number) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireConfiguration(): StripeConnectConfiguration {
  const configuration = resolveStripeConnectConfiguration();
  if (!configuration) {
    throw requestError(
      "Stripe Connect is not enabled",
      "STRIPE_CONNECT_DISABLED",
      503,
    );
  }
  return configuration;
}

function trustedClientOrigin(
  configuration: StripeConnectConfiguration,
): string {
  const origin = getAllowedClientOrigins()[0];
  if (!origin) throw new Error("A trusted client origin is required");
  if (configuration.liveMode && new URL(origin).protocol !== "https:") {
    throw requestError(
      "Stripe Connect Live requires an HTTPS client origin",
      "STRIPE_CONNECT_LIVE_ORIGIN_INSECURE",
      503,
    );
  }
  return origin;
}

function accountStatus(
  account: ConnectedAccountSnapshot,
): FacilityStripeAccountStatus {
  if (
    account.cardPaymentsStatus === "active" &&
    account.payoutsStatus === "active"
  ) {
    return "ready";
  }
  if (
    account.cardPaymentsStatus === "restricted" ||
    account.payoutsStatus === "restricted" ||
    account.requirementsStatus === "currently_due"
  ) {
    return "restricted";
  }
  return "onboarding_required";
}

async function persistAccount(
  facilityId: string,
  account: ConnectedAccountSnapshot,
) {
  const now = Date.now();
  const values = {
    facilityId,
    stripeAccountId: account.id,
    stripeLivemode: account.livemode ? (1 as const) : (0 as const),
    dashboard: account.dashboard ?? "full",
    status: accountStatus(account),
    cardPaymentsStatus: account.cardPaymentsStatus,
    sepaDebitPaymentsStatus: account.sepaDebitPaymentsStatus,
    payoutsStatus: account.payoutsStatus,
    requirementsStatus: account.requirementsStatus,
    lastReconciledAt: now,
    updatedAt: now,
  };
  await db
    .insertInto("facilityStripeAccounts")
    .values({ ...values, createdAt: now })
    .onConflict((conflict) =>
      conflict.columns(["facilityId", "stripeLivemode"]).doUpdateSet(values),
    )
    .execute();
  return db
    .selectFrom("facilityStripeAccounts")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .where("stripeLivemode", "=", account.livemode ? 1 : 0)
    .executeTakeFirstOrThrow();
}

export async function getStripeConnectOverview(facilityId: string) {
  const configuration = resolveStripeConnectConfiguration();
  const account = configuration
    ? await db
        .selectFrom("facilityStripeAccounts")
        .selectAll()
        .where("facilityId", "=", facilityId)
        .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
        .executeTakeFirst()
    : null;
  return {
    configured: configuration !== null,
    mode: configuration?.mode ?? "disabled",
    testMode: configuration?.liveMode === false,
    responsibilities: {
      merchantOfRecord: "facility",
      processingFees: "facility",
      refundsAndDisputes: "facility",
      platformTransactionFee: false,
    },
    account: account
      ? {
          status: account.status,
          dashboard: account.dashboard,
          cardPaymentsStatus: account.cardPaymentsStatus,
          sepaDebitPaymentsStatus: account.sepaDebitPaymentsStatus,
          payoutsStatus: account.payoutsStatus,
          requirementsStatus: account.requirementsStatus,
          lastReconciledAt: account.lastReconciledAt,
        }
      : null,
  };
}

export async function createStripeConnectedAccount(input: {
  facilityId: string;
  ownerUserId: string;
}) {
  const configuration = requireConfiguration();
  const existing = await db
    .selectFrom("facilityStripeAccounts")
    .selectAll()
    .where("facilityId", "=", input.facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (existing) return getStripeConnectOverview(input.facilityId);

  const [facility, owner] = await Promise.all([
    db
      .selectFrom("facilityProfiles")
      .select(["name", "status"])
      .where("id", "=", input.facilityId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("users")
      .select(["email", "locale", "countryCode"])
      .where("id", "=", input.ownerUserId)
      .where("accountStatus", "=", "active")
      .executeTakeFirstOrThrow(),
  ]);
  if (facility.status !== "active") {
    throw requestError(
      "The facility must be active before connecting Stripe",
      "FACILITY_NOT_ACTIVE",
      409,
    );
  }
  const locale = resolveStripeAccountLocale(owner.locale);
  const country = /^[A-Z]{2}$/.test(owner.countryCode)
    ? owner.countryCode
    : "ES";
  const account = await gatewayFactory(configuration).createConnectedAccount({
    facilityId: input.facilityId,
    displayName: facility.name,
    contactEmail: owner.email,
    country,
    locale,
    idempotencyKey: `facility-connect:${input.facilityId}:${configuration.mode}`,
  });
  if (account.livemode !== configuration.liveMode) {
    throw requestError(
      "The connected account mode does not match this environment",
      "STRIPE_CONNECT_MODE_MISMATCH",
      409,
    );
  }
  await persistAccount(input.facilityId, account);
  return getStripeConnectOverview(input.facilityId);
}

export async function reconcileStripeConnectedAccount(facilityId: string) {
  const configuration = requireConfiguration();
  const stored = await db
    .selectFrom("facilityStripeAccounts")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (!stored) {
    throw requestError(
      "The facility has no connected Stripe account",
      "STRIPE_CONNECTED_ACCOUNT_NOT_FOUND",
      404,
    );
  }
  const account = await gatewayFactory(configuration).retrieveConnectedAccount(
    stored.stripeAccountId,
  );
  if (
    account.id !== stored.stripeAccountId ||
    account.livemode !== configuration.liveMode
  ) {
    throw requestError(
      "The connected account does not match this facility environment",
      "STRIPE_CONNECT_MODE_MISMATCH",
      409,
    );
  }
  await persistAccount(facilityId, account);
  return getStripeConnectOverview(facilityId);
}

export async function createStripeOnboardingLink(facilityId: string) {
  const configuration = requireConfiguration();
  const account = await db
    .selectFrom("facilityStripeAccounts")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (!account) {
    throw requestError(
      "Create the connected Stripe account first",
      "STRIPE_CONNECTED_ACCOUNT_NOT_FOUND",
      404,
    );
  }
  const origin = trustedClientOrigin(configuration);
  return gatewayFactory(configuration).createOnboardingLink({
    accountId: account.stripeAccountId,
    refreshUrl: `${origin}/billing?stripe-connect=refresh`,
    returnUrl: `${origin}/billing?stripe-connect=return`,
  });
}

export async function createMemberBillingCheckout(input: {
  facilityId: string;
  memberUserId: string;
  memberEmail: string;
  billingRecordId: string;
}) {
  const configuration = requireConfiguration();
  const [account, membership, record] = await Promise.all([
    db
      .selectFrom("facilityStripeAccounts")
      .selectAll()
      .where("facilityId", "=", input.facilityId)
      .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
      .executeTakeFirst(),
    db
      .selectFrom("facilityMemberships")
      .select(["role", "memberAffiliation", "status"])
      .where("facilityId", "=", input.facilityId)
      .where("userId", "=", input.memberUserId)
      .executeTakeFirst(),
    db
      .selectFrom("billingRecords")
      .selectAll()
      .where("id", "=", input.billingRecordId)
      .where("facilityId", "=", input.facilityId)
      .where("archivedAt", "is", null)
      .executeTakeFirst(),
  ]);
  if (!account || account.status !== "ready") {
    throw requestError(
      "The facility is not ready to collect payments through Stripe",
      "STRIPE_CONNECTED_ACCOUNT_NOT_READY",
      409,
    );
  }
  if (
    !membership ||
    membership.status !== "active" ||
    (membership.role !== "member" && membership.memberAffiliation !== 1)
  ) {
    throw requestError(
      "An active member affiliation is required",
      "MEMBER_AFFILIATION_REQUIRED",
      403,
    );
  }
  if (
    !record ||
    (record.userId !== input.memberUserId &&
      record.customerEmail.toLowerCase() !== input.memberEmail.toLowerCase())
  ) {
    throw requestError(
      "Billing record not found",
      "BILLING_RECORD_NOT_FOUND",
      404,
    );
  }
  if (record.status === "paid") {
    throw requestError(
      "This billing record is already paid",
      "BILLING_RECORD_PAID",
      409,
    );
  }
  if (record.amountCents <= 0) {
    throw requestError(
      "The billing amount must be positive",
      "BILLING_AMOUNT_INVALID",
      409,
    );
  }

  const terminalAttempts = await db
    .selectFrom("stripeConnectCheckoutSessions")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("facilityId", "=", input.facilityId)
    .where("billingRecordId", "=", record.id)
    .where("status", "in", ["expired", "payment_failed"])
    .executeTakeFirstOrThrow();
  const attempt = Number(terminalAttempts.count) + 1;
  const origin = trustedClientOrigin(configuration);
  const session = await gatewayFactory(configuration).createDirectCheckout({
    accountId: account.stripeAccountId,
    billingRecordId: record.id,
    facilityId: input.facilityId,
    memberUserId: input.memberUserId,
    customerEmail: input.memberEmail,
    concept: record.concept,
    amountCents: record.amountCents,
    currency: record.currency,
    successUrl: `${origin}/account/payments?stripe-payment=success`,
    cancelUrl: `${origin}/account/payments?stripe-payment=cancelled`,
    idempotencyKey: `facility-payment:${record.id}:${record.updatedAt}:${attempt}`,
  });
  if (!session.url) {
    throw requestError(
      "Stripe did not return a Checkout URL",
      "STRIPE_CHECKOUT_URL_MISSING",
      502,
    );
  }
  const now = Date.now();
  await db
    .insertInto("stripeConnectCheckoutSessions")
    .values({
      sessionId: session.id,
      facilityId: input.facilityId,
      billingRecordId: record.id,
      memberUserId: input.memberUserId,
      stripeAccountId: account.stripeAccountId,
      paymentIntentId: session.paymentIntentId,
      status: "open",
      livemode: configuration.liveMode ? 1 : 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    })
    .onConflict((conflict) => conflict.column("sessionId").doNothing())
    .execute();
  return { url: session.url };
}

export function constructStripeConnectWebhookEvent(
  body: Buffer,
  signature: string,
) {
  const configuration = requireConfiguration();
  return gatewayFactory(configuration).constructWebhookEvent(
    body,
    signature,
    configuration.webhookSecret,
  );
}

function checkoutSessionFromEvent(
  event: Stripe.Event,
): Stripe.Checkout.Session | null {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    return event.data.object;
  }
  return null;
}

export async function ingestStripeConnectWebhookEvent(event: Stripe.Event) {
  const configuration = requireConfiguration();
  if (event.livemode !== configuration.liveMode) {
    throw requestError(
      "The Stripe event mode does not match this environment",
      "STRIPE_CONNECT_EVENT_MODE_MISMATCH",
      400,
    );
  }
  const stripeAccountId = event.account ?? null;
  if (!stripeAccountId) {
    throw requestError(
      "A connected account event is required",
      "STRIPE_CONNECT_EVENT_ACCOUNT_MISSING",
      400,
    );
  }
  const facilityAccount = await db
    .selectFrom("facilityStripeAccounts")
    .selectAll()
    .where("stripeAccountId", "=", stripeAccountId)
    .where("stripeLivemode", "=", configuration.liveMode ? 1 : 0)
    .executeTakeFirst();
  if (!facilityAccount) {
    throw requestError(
      "The connected account is not registered",
      "STRIPE_CONNECT_EVENT_ACCOUNT_UNKNOWN",
      400,
    );
  }
  const session = checkoutSessionFromEvent(event);
  const now = Date.now();
  let duplicate = false;
  await db.transaction().execute(async (transaction) => {
    const eventInsert = await transaction
      .insertInto("stripeConnectWebhookEvents")
      .values({
        eventId: event.id,
        eventType: event.type,
        stripeAccountId,
        facilityId: facilityAccount.facilityId,
        livemode: event.livemode ? 1 : 0,
        receivedAt: now,
        processedAt: now,
      })
      .onConflict((conflict) => conflict.column("eventId").doNothing())
      .returning("eventId")
      .executeTakeFirst();
    if (!eventInsert) {
      duplicate = true;
      return;
    }
    if (session) {
      const storedSession = await transaction
        .selectFrom("stripeConnectCheckoutSessions")
        .selectAll()
        .where("sessionId", "=", session.id)
        .where("facilityId", "=", facilityAccount.facilityId)
        .where("stripeAccountId", "=", stripeAccountId)
        .executeTakeFirst();
      const metadata = session.metadata ?? {};
      if (
        !storedSession ||
        metadata.facility_id !== facilityAccount.facilityId ||
        metadata.billing_record_id !== storedSession.billingRecordId ||
        metadata.member_user_id !== storedSession.memberUserId
      ) {
        throw requestError(
          "Stripe Checkout metadata does not match the stored tenant",
          "STRIPE_CONNECT_EVENT_TENANT_MISMATCH",
          400,
        );
      }
      const completed =
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded";
      const failed = event.type === "checkout.session.async_payment_failed";
      await transaction
        .updateTable("stripeConnectCheckoutSessions")
        .set({
          status: completed
            ? "complete"
            : failed
              ? "payment_failed"
              : "expired",
          paymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? storedSession.paymentIntentId),
          updatedAt: now,
          completedAt: completed ? now : null,
        })
        .where("sessionId", "=", session.id)
        .execute();
      if (
        event.type === "checkout.session.async_payment_succeeded" ||
        (completed && session.payment_status === "paid")
      ) {
        await transaction
          .updateTable("billingRecords")
          .set({ status: "paid", paidAt: now, updatedAt: now })
          .where("id", "=", storedSession.billingRecordId)
          .where("facilityId", "=", facilityAccount.facilityId)
          .where("status", "!=", "paid")
          .execute();
      }
    }
  });
  return { received: true, duplicate };
}

import Stripe from "stripe";
import type { StripeConnectConfiguration } from "../lib/stripe-connect-config.js";
import {
  isSupportedLocale,
  type PlatformLocale,
} from "../lib/supported-locales.js";

export type StripeAccountLocale = "es" | "en" | "de" | "fr" | "it";

const STRIPE_ACCOUNT_LOCALE_BY_PLATFORM_LOCALE: Record<
  PlatformLocale,
  StripeAccountLocale | undefined
> = {
  es: "es",
  en: "en",
  de: "de",
  "de-CH": "de",
  fr: "fr",
  it: "it",
  gl: undefined,
  ca: undefined,
  "ca-valencia": undefined,
  eu: undefined,
  "oc-aranes": undefined,
};

export function resolveStripeAccountLocale(
  locale: unknown,
): StripeAccountLocale | undefined {
  return isSupportedLocale(locale)
    ? STRIPE_ACCOUNT_LOCALE_BY_PLATFORM_LOCALE[locale]
    : undefined;
}

export interface ConnectedAccountSnapshot {
  id: string;
  livemode: boolean;
  dashboard: string | null;
  cardPaymentsStatus: string;
  sepaDebitPaymentsStatus: string;
  payoutsStatus: string;
  requirementsStatus: string;
}

export interface StripeConnectGateway {
  createConnectedAccount(input: {
    facilityId: string;
    displayName: string;
    contactEmail: string;
    country: string;
    locale?: StripeAccountLocale;
    idempotencyKey: string;
  }): Promise<ConnectedAccountSnapshot>;
  retrieveConnectedAccount(
    accountId: string,
  ): Promise<ConnectedAccountSnapshot>;
  createOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  createDirectCheckout(input: {
    accountId: string;
    billingRecordId: string;
    facilityId: string;
    memberUserId: string;
    customerEmail: string;
    concept: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{
    id: string;
    url: string | null;
    paymentIntentId: string | null;
  }>;
  constructWebhookEvent(
    body: Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event;
}

function snapshot(account: Stripe.V2.Core.Account): ConnectedAccountSnapshot {
  const merchant = account.configuration?.merchant;
  return {
    id: account.id,
    livemode: account.livemode,
    dashboard: account.dashboard ?? null,
    cardPaymentsStatus:
      merchant?.capabilities?.card_payments?.status ?? "unrequested",
    sepaDebitPaymentsStatus:
      merchant?.capabilities?.sepa_debit_payments?.status ?? "unrequested",
    payoutsStatus:
      merchant?.capabilities?.stripe_balance?.payouts?.status ?? "unrequested",
    requirementsStatus:
      account.requirements?.summary?.minimum_deadline?.status ?? "unknown",
  };
}

export class OfficialStripeConnectGateway implements StripeConnectGateway {
  private readonly stripe: Stripe;

  constructor(configuration: StripeConnectConfiguration) {
    this.stripe = new Stripe(configuration.restrictedApiKey, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true,
    });
  }

  async createConnectedAccount(input: {
    facilityId: string;
    displayName: string;
    contactEmail: string;
    country: string;
    locale?: StripeAccountLocale;
    idempotencyKey: string;
  }) {
    const account = await this.stripe.v2.core.accounts.create(
      {
        display_name: input.displayName,
        contact_email: input.contactEmail,
        dashboard: "full",
        identity: { country: input.country },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
              sepa_debit_payments: { requested: true },
            },
          },
        },
        defaults: {
          currency: "eur",
          ...(input.locale ? { locales: [input.locale] } : {}),
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
          profile: {
            doing_business_as: input.displayName,
            product_description:
              "Cuotas y servicios prestados directamente por el centro deportivo",
          },
        },
        metadata: { facility_id: input.facilityId },
        include: [
          "configuration.merchant",
          "defaults",
          "requirements",
          "future_requirements",
        ],
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return snapshot(account);
  }

  async retrieveConnectedAccount(accountId: string) {
    return snapshot(
      await this.stripe.v2.core.accounts.retrieve(accountId, {
        include: [
          "configuration.merchant",
          "defaults",
          "requirements",
          "future_requirements",
        ],
      }),
    );
  }

  async createOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }) {
    return this.stripe.v2.core.accountLinks.create({
      account: input.accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: input.refreshUrl,
          return_url: input.returnUrl,
          collection_options: {
            fields: "eventually_due",
            future_requirements: "include",
          },
        },
      },
    });
  }

  async createDirectCheckout(input: {
    accountId: string;
    billingRecordId: string;
    facilityId: string;
    memberUserId: string;
    customerEmail: string;
    concept: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }) {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: input.customerEmail,
        client_reference_id: input.billingRecordId,
        customer_creation: "always",
        billing_address_collection: "auto",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: { name: input.concept },
            },
          },
        ],
        metadata: {
          facility_id: input.facilityId,
          billing_record_id: input.billingRecordId,
          member_user_id: input.memberUserId,
        },
        payment_intent_data: {
          metadata: {
            facility_id: input.facilityId,
            billing_record_id: input.billingRecordId,
            member_user_id: input.memberUserId,
          },
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: input.idempotencyKey, stripeAccount: input.accountId },
    );
    return {
      id: session.id,
      url: session.url,
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
    };
  }

  constructWebhookEvent(body: Buffer, signature: string, secret: string) {
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }
}

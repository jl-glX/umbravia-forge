import Stripe from "stripe";
import type {
  CommercialPlanKey,
  StripeBillingConfiguration,
} from "../lib/stripe-billing-config.js";

export interface StripeBillingGateway {
  createCustomer(input: {
    email: string;
    name: string;
    facilityId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: {
    customerId: string;
    facilityId: string;
    plan: CommercialPlanKey;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    portalConfigurationId: string | null;
  }): Promise<{ url: string }>;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  constructWebhookEvent(
    body: Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event;
}

export class OfficialStripeBillingGateway implements StripeBillingGateway {
  private readonly stripe: Stripe;

  constructor(configuration: StripeBillingConfiguration) {
    this.stripe = new Stripe(configuration.restrictedApiKey, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true,
    });
  }

  async createCustomer(input: {
    email: string;
    name: string;
    facilityId: string;
    idempotencyKey: string;
  }) {
    return this.stripe.customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: { facility_id: input.facilityId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createCheckoutSession(input: {
    customerId: string;
    facilityId: string;
    plan: CommercialPlanKey;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }) {
    return this.stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.facilityId,
        billing_address_collection: "required",
        customer_update: { address: "auto", name: "auto" },
        integration_identifier: "umbravia_forge_hkqmnvds",
        line_items: [{ price: input.priceId, quantity: 1 }],
        metadata: {
          facility_id: input.facilityId,
          plan_key: input.plan,
        },
        subscription_data: {
          metadata: {
            facility_id: input.facilityId,
            plan_key: input.plan,
          },
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    portalConfigurationId: string | null;
  }) {
    return this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      ...(input.portalConfigurationId
        ? { configuration: input.portalConfigurationId }
        : {}),
    });
  }

  async retrieveSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  constructWebhookEvent(body: Buffer, signature: string, secret: string) {
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }
}

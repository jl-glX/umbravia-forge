import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ConnectedAccountSnapshot,
  StripeConnectGateway,
} from "./stripe-connect-gateway.js";

describe("Stripe Connect", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let service: typeof import("./stripe-connect.js");
  const accountInputs: Array<Record<string, unknown>> = [];
  const checkoutInputs: Array<Record<string, unknown>> = [];
  let accountSnapshot: ConnectedAccountSnapshot = {
    id: "acct_facility_alpha",
    livemode: false,
    dashboard: "full",
    cardPaymentsStatus: "pending",
    sepaDebitPaymentsStatus: "pending",
    payoutsStatus: "pending",
    requirementsStatus: "currently_due",
  };

  const gateway: StripeConnectGateway = {
    async createConnectedAccount(input) {
      accountInputs.push(input);
      return accountSnapshot;
    },
    async retrieveConnectedAccount() {
      return accountSnapshot;
    },
    async createOnboardingLink(input) {
      expect(input).toMatchObject({ accountId: "acct_facility_alpha" });
      return { url: "https://connect.stripe.test/onboarding" };
    },
    async createDirectCheckout(input) {
      checkoutInputs.push(input);
      return {
        id: "cs_checkout_member",
        url: "https://checkout.stripe.test/member",
        paymentIntentId: null,
      };
    },
    constructWebhookEvent() {
      throw new Error("not used by this service test");
    },
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-connect-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_ORIGIN", "http://localhost:3000");
    vi.stubEnv("STRIPE_CONNECT_ENABLED", "true");
    vi.stubEnv("STRIPE_CONNECT_MODE", "sandbox");
    vi.stubEnv("STRIPE_CONNECT_RESTRICTED_API_KEY", "rk_test_example");
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_example");
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "connect-owner",
          email: "owner@example.com",
          phone: null,
          name: "Owner",
          avatarDataUrl: "",
          password: "test-hash",
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
        {
          id: "staff-member",
          email: "staff-member@example.com",
          phone: null,
          name: "Staff Member",
          avatarDataUrl: "",
          password: "test-hash",
          role: "admin",
          sessionIdleTimeoutMinutes: 60,
          createdAt: now,
        },
      ])
      .execute();
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
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:connect-owner",
          facilityId: "facility-alpha",
          userId: "connect-owner",
          role: "owner",
          workforceRoles: "[]",
          memberAffiliation: 0,
          staffMemberAffiliationAllowed: 0,
          status: "active",
          classPermissions: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:staff-member",
          facilityId: "facility-alpha",
          userId: "staff-member",
          role: "admin",
          workforceRoles: '["admin","trainer"]',
          memberAffiliation: 1,
          staffMemberAffiliationAllowed: 0,
          status: "active",
          classPermissions: "{}",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("billingRecords")
      .values({
        id: "billing-staff-member",
        facilityId: "facility-alpha",
        userId: "staff-member",
        customerName: "Staff Member",
        customerEmail: "staff-member@example.com",
        concept: "Monthly membership",
        billingCycle: "monthly",
        customCycleLabel: "",
        amountCents: 4900,
        currency: "EUR",
        status: "pending",
        dueAt: null,
        paidAt: null,
        invoiceNumber: null,
        notes: "",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    service = await import("./stripe-connect.js");
    service.setStripeConnectGatewayFactoryForTests(() => gateway);
  });

  afterAll(async () => {
    service?.setStripeConnectGatewayFactoryForTests(null);
    await database?.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates an Accounts v2 tenant boundary and keeps it restricted until capabilities activate", async () => {
    const overview = await service.createStripeConnectedAccount({
      facilityId: "facility-alpha",
      ownerUserId: "connect-owner",
    });
    expect(accountInputs[0]).toMatchObject({
      facilityId: "facility-alpha",
      displayName: "Facility Alpha",
      contactEmail: "owner@example.com",
      country: "ES",
      locale: "es",
    });
    expect(overview.account?.status).toBe("restricted");

    const now = Date.now();
    await database.db
      .insertInto("facilityStripeAccounts")
      .values({
        facilityId: "facility-alpha",
        stripeAccountId: "acct_facility_alpha_live",
        stripeLivemode: 1,
        dashboard: "full",
        status: "ready",
        cardPaymentsStatus: "active",
        sepaDebitPaymentsStatus: "active",
        payoutsStatus: "active",
        requirementsStatus: "none",
        lastReconciledAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    expect(
      Number(
        (
          await database.db
            .selectFrom("facilityStripeAccounts")
            .select(({ fn }) => fn.countAll<number>().as("count"))
            .where("facilityId", "=", "facility-alpha")
            .executeTakeFirstOrThrow()
        ).count,
      ),
    ).toBe(2);
    expect(
      (await service.getStripeConnectOverview("facility-alpha")).account,
    ).toMatchObject({
      status: "restricted",
      sepaDebitPaymentsStatus: "pending",
    });

    accountSnapshot = {
      ...accountSnapshot,
      cardPaymentsStatus: "active",
      sepaDebitPaymentsStatus: "active",
      payoutsStatus: "active",
      requirementsStatus: "none",
    };
    expect(
      (await service.reconcileStripeConnectedAccount("facility-alpha")).account
        ?.status,
    ).toBe("ready");
  });

  it("allows a verified worker with member affiliation to pay a server-owned record", async () => {
    const checkout = await service.createMemberBillingCheckout({
      facilityId: "facility-alpha",
      memberUserId: "staff-member",
      memberEmail: "staff-member@example.com",
      billingRecordId: "billing-staff-member",
    });
    expect(checkout).toEqual({ url: "https://checkout.stripe.test/member" });
    expect(checkoutInputs[0]).toMatchObject({
      accountId: "acct_facility_alpha",
      billingRecordId: "billing-staff-member",
      facilityId: "facility-alpha",
      memberUserId: "staff-member",
      amountCents: 4900,
      currency: "EUR",
    });
    expect(checkoutInputs[0]).not.toHaveProperty("applicationFeeAmount");
  });

  it("accepts signed-state checkout completion once and marks the local record paid", async () => {
    const event = {
      id: "evt_connect_checkout_complete",
      type: "checkout.session.completed",
      livemode: false,
      account: "acct_facility_alpha",
      data: {
        object: {
          id: "cs_checkout_member",
          object: "checkout.session",
          payment_status: "paid",
          payment_intent: "pi_member",
          metadata: {
            facility_id: "facility-alpha",
            billing_record_id: "billing-staff-member",
            member_user_id: "staff-member",
          },
        },
      },
    } as unknown as Stripe.Event;
    expect(await service.ingestStripeConnectWebhookEvent(event)).toEqual({
      received: true,
      duplicate: false,
    });
    expect(await service.ingestStripeConnectWebhookEvent(event)).toEqual({
      received: true,
      duplicate: true,
    });
    expect(
      await database.db
        .selectFrom("billingRecords")
        .select(["status", "paidAt"])
        .where("id", "=", "billing-staff-member")
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status: "paid", paidAt: expect.any(Number) });
  });
});

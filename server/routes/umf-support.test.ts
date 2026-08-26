import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signSupportEmailWebhook } from "../lib/support-email-inbound.js";
import {
  buildUmfSupportReplyAddress,
  resolveUmfSupportEmailConfiguration,
} from "../lib/umf-support-email.js";

describe("UMF Support corporate API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let directorCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umf-corporate-support-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UMF_SUPPORT_OPERATIONAL_WORKSPACE_ENABLED", "true");
    vi.stubEnv("PRIVATE_CONTENT_ENCRYPTION_ENABLED", "true");
    vi.stubEnv(
      "PRIVATE_CONTENT_ENCRYPTION_KEY",
      Buffer.alloc(32, 31).toString("base64url"),
    );
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_ENABLED", "true");
    vi.stubEnv("EMAIL_PUBLIC_INBOUND_PROVIDER", "cloudflare");
    vi.stubEnv("UMF_SUPPORT_EMAIL_INBOUND_ENABLED", "true");
    vi.stubEnv("UMF_SUPPORT_EMAIL_ADDRESS", "privacy@example.com");
    vi.stubEnv(
      "UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY",
      Buffer.alloc(32, 17).toString("base64"),
    );
    vi.stubEnv(
      "UMF_SUPPORT_EMAIL_WEBHOOK_SECRET",
      Buffer.alloc(32, 29).toString("base64"),
    );
    vi.stubEnv(
      "UMF_SUPPORT_WINDOWS_ZIP_URL",
      "https://downloads.example.com/umf-support-test.zip",
    );
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "umf-director",
          email: "director@example.com",
          identityRealm: "corporate_support",
          phone: null,
          name: "Director",
          avatarDataUrl: "",
          password: await auth.hashPassword("DirectorPassword123"),
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
        {
          id: "tenant-admin-only",
          email: "tenant-admin@example.com",
          identityRealm: "commercial",
          phone: null,
          name: "Tenant Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("TenantAdminPassword123"),
          role: "admin",
          accountStatus: "active",
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10080,
          createdAt: now,
        },
      ])
      .execute();
    await database.db
      .insertInto("umfSupportStaff")
      .values({
        userId: "umf-director",
        role: "director",
        status: "active",
        approvedByUserId: "umf-director",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    await database.db
      .insertInto("companyStaffProfiles")
      .values({
        userId: "umf-director",
        position: "platform_head",
        reportsToUserId: null,
        status: "active",
        appointedByUserId: "umf-director",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      })
      .execute();
    app = (await import("../index.js")).app;
    const login = await request(app).post("/api/umf-support/login").send({
      email: "director@example.com",
      password: "DirectorPassword123",
      rememberDevice: false,
    });
    directorCookie = login.headers["set-cookie"][0];
  }, 30_000);

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps tenant administrators outside the corporate support program", async () => {
    const distribution = await request(app)
      .get("/api/umf-support/distribution")
      .expect(200);
    expect(distribution.body.distribution).toMatchObject({
      stage: "production",
      channel: "web",
      available: true,
      installer: null,
    });

    const login = await request(app).post("/api/umf-support/login").send({
      email: "tenant-admin@example.com",
      password: "TenantAdminPassword123",
      rememberDevice: false,
    });
    expect(login.status).toBe(401);
    expect(login.headers["set-cookie"]).toBeUndefined();

    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.capabilities).toMatchObject({
          canManageCommercialTrials: true,
          isPlatformHead: true,
          workspaceName: null,
        });
      });
    await request(app)
      .patch("/api/umf-support/workspace")
      .set("Cookie", directorCookie)
      .send({ workspaceName: "Panel de trabajo de Javi" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.workspaceName).toBe("Panel de trabajo de Javi");
      });
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.capabilities.workspaceName).toBe(
          "Panel de trabajo de Javi",
        );
      });
    await request(app)
      .get("/api/umf-support/commercial-trial-administrators")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.accounts).toContainEqual(
          expect.objectContaining({
            userId: "tenant-admin-only",
            email: "tenant-admin@example.com",
            emailAssessment: "fictitious",
            pendingProvisioning: null,
            trial: null,
          }),
        );
        expect(body.accounts).not.toContainEqual(
          expect.objectContaining({ userId: "umf-director" }),
        );
      });
  });

  it("reports live commercial account metrics and retained deletion counters without personal data", async () => {
    await database.db
      .insertInto("commercialLifecycleFacts")
      .values([
        {
          id: "metric-deleted-account",
          kind: "commercial_account_deleted",
          subjectId: "deleted-subject",
          occurredAt: 100,
        },
        {
          id: "metric-abandoned-trial",
          kind: "commercial_trial_abandoned",
          subjectId: "abandoned-subject",
          occurredAt: 200,
        },
      ])
      .execute();

    await request(app)
      .get("/api/umf-support/commercial-account-metrics")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          activeAdministratorAccounts: 0,
          pendingVerificationAccounts: 0,
          activeTrials: 0,
          abandonedTrials: 1,
          deletedAdministratorAccounts: 1,
          historicalCoverage: "from_schema_v52",
          firstRetainedFactAt: 100,
        });
        expect(JSON.stringify(body)).not.toContain("tenant-admin@example.com");
      });
  });

  it("lets the platform head contact and operate a commercial trial without deleting its account", async () => {
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "support-trial-owner",
        email: "support-trial-owner@example.com",
        identityRealm: "commercial",
        phone: null,
        name: "Support Trial Owner",
        avatarDataUrl: "",
        password: "test-only",
        role: "admin",
        accountStatus: "active",
        emailVerifiedAt: now,
        sessionIdleTimeoutMinutes: 10_080,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "support-trial-facility",
        slug: "support-trial-facility",
        name: "Support Trial Centre",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "support-trial-membership",
        facilityId: "support-trial-facility",
        userId: "support-trial-owner",
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("commercialTrials")
      .values({
        id: "support-trial",
        facilityId: "support-trial-facility",
        ownerUserId: "support-trial-owner",
        facilityName: "Support Trial Centre",
        facilityType: "traditional_gym",
        approximateMembers: null,
        trainerCount: null,
        spaceCount: null,
        usualCapacity: 20,
        classTypes: "[]",
        scheduleNotes: "",
        locale: "es",
        currency: "EUR",
        usesBookings: 1,
        usesWaitlist: 1,
        templateKey: "traditional_gym",
        status: "trial_paused_support",
        subdomain: "support-trial-centre",
        realDataDeclaration: "undeclared",
        autoCleanupEligible: 1,
        dataReviewRequestedAt: null,
        cleanupEligibleAt: null,
        conversionDraft: "[]",
        startedAt: now - 10_000,
        expiresAt: now + 86_400_000,
        pausedAt: now - 5_000,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await request(app)
      .get("/api/umf-support/commercial-trial-administrators")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.accounts).toContainEqual(
          expect.objectContaining({
            userId: "support-trial-owner",
            email: "support-trial-owner@example.com",
            trial: expect.objectContaining({
              id: "support-trial",
              status: "trial_paused_support",
            }),
          }),
        );
      });

    await request(app)
      .post("/api/umf-support/commercial-trials/support-trial/action")
      .set("Cookie", directorCookie)
      .send({ action: "resume" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.status).toBe("trial_active");
        expect(body.trial.pausedAt).toBeNull();
      });
    await request(app)
      .post("/api/umf-support/commercial-trials/support-trial/action")
      .set("Cookie", directorCookie)
      .send({ action: "cancel" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.status).toBe("trial_closed");
        expect(body.trial.publicPageEnabled).toBe(false);
      });
    await request(app)
      .delete("/api/umf-support/commercial-trials/support-trial")
      .set("Cookie", directorCookie)
      .send({ confirmation: "wrong centre" })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("COMMERCIAL_TRIAL_DELETE_CONFIRMATION_MISMATCH");
      });
    await request(app)
      .delete("/api/umf-support/commercial-trials/support-trial")
      .set("Cookie", directorCookie)
      .send({ confirmation: "Support Trial Centre" })
      .expect(200)
      .expect({
        deleted: true,
        accountDeleted: false,
        ownerUserId: "support-trial-owner",
        actorUserId: "umf-director",
      });
    await expect(
      database.db
        .selectFrom("users")
        .select("id")
        .where("id", "=", "support-trial-owner")
        .executeTakeFirst(),
    ).resolves.toEqual({ id: "support-trial-owner" });
    await expect(
      database.db
        .selectFrom("commercialTrials")
        .select("id")
        .where("id", "=", "support-trial")
        .executeTakeFirst(),
    ).resolves.toBeUndefined();
  });

  it("does not count a commercial account queued for deletion as active", async () => {
    const now = Date.now();
    await database.db
      .insertInto("users")
      .values({
        id: "queued-commercial-owner",
        email: "queued-commercial-owner@example.com",
        identityRealm: "commercial",
        phone: null,
        name: "Queued Owner",
        avatarDataUrl: "",
        password: "test-only",
        role: "admin",
        accountStatus: "active",
        emailVerifiedAt: now,
        sessionIdleTimeoutMinutes: 10_080,
        createdAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "queued-commercial-facility",
        slug: "queued-commercial-facility",
        name: "Queued Commercial Centre",
        logoDataUrl: "",
        accentColor: "#2563eb",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values({
        id: "queued-commercial-membership",
        facilityId: "queued-commercial-facility",
        userId: "queued-commercial-owner",
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("accountDeletionRequests")
      .values({
        id: "queued-commercial-deletion",
        userId: "queued-commercial-owner",
        trigger: "manual",
        status: "scheduled",
        requestedAt: now,
        graceEndsAt: now + 30 * 24 * 60 * 60 * 1000,
        cancelledAt: null,
        completedAt: null,
      })
      .execute();

    await request(app)
      .get("/api/umf-support/commercial-trial-administrators")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.accounts).toContainEqual(
          expect.objectContaining({
            userId: "queued-commercial-owner",
            deletionRequest: expect.objectContaining({ status: "scheduled" }),
          }),
        );
      });
    await request(app)
      .get("/api/umf-support/commercial-account-metrics")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.activeAdministratorAccounts).toBe(0);
      });
  });

  it("creates an agent account after mailbox verification without preauthorization", async () => {
    const browser = request.agent(app);
    const registered = await browser
      .post("/api/umf-support/register")
      .send({
        email: "new-agent@example.com",
        name: "New",
        lastName: "Agent",
        password: "DifferentPassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(201);
    expect(registered.body.user).toMatchObject({
      email: "new-agent@example.com",
      name: "New",
      identityRealm: "corporate_support",
      accountStatus: "pending_verification",
    });
    await expect(
      database.db
        .selectFrom("users")
        .select(["name", "lastName"])
        .where("id", "=", registered.body.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ name: "New", lastName: "Agent" });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["platformScope", "kind"])
        .where("recipient", "=", "new-agent@example.com")
        .orderBy("createdAt", "desc")
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({
      platformScope: "support",
      kind: "email_verification",
    });

    await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "new-agent@example.com",
        password: "DifferentPassword123",
        rememberDevice: false,
      })
      .expect(401);

    await browser
      .post("/api/umf-support/verify-email")
      .send({ code: registered.body.demoVerificationCode })
      .expect(200);
    await expect(
      database.db
        .selectFrom("facilityMemberships")
        .select("userId")
        .where("userId", "=", registered.body.user.id)
        .executeTakeFirst(),
    ).resolves.toBeUndefined();

    await request(app)
      .post("/api/umf-support/register")
      .send({
        email: "new-agent@example.com",
        name: "New",
        lastName: "Agent",
        password: "AnotherPassword123",
        countryCode: "ES",
        locale: "es",
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
      .expect(400);

    const loginBeforeApproval = await request(app)
      .post("/api/umf-support/login")
      .send({
        email: "new-agent@example.com",
        password: "DifferentPassword123",
        rememberDevice: false,
      });
    expect(loginBeforeApproval.status).toBe(200);
    const accountOnlyCookie = loginBeforeApproval.headers["set-cookie"][0];
    await request(app)
      .get("/api/umf-support/session")
      .set("Cookie", accountOnlyCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          id: registered.body.user.id,
          identityRealm: "corporate_support",
          accessApproved: false,
        });
      });
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", accountOnlyCookie)
      .expect(403);

    const pendingAccounts = await request(app)
      .get("/api/umf-support/administrator-accounts")
      .set("Cookie", directorCookie)
      .expect(200);
    expect(pendingAccounts.body.accounts).toContainEqual(
      expect.objectContaining({
        userId: registered.body.user.id,
        email: "new-agent@example.com",
        emailVerifiedAt: expect.any(Number),
        staffStatus: null,
      }),
    );
    await request(app)
      .post(
        `/api/umf-support/administrator-accounts/${registered.body.user.id}/approve`,
      )
      .set("Cookie", directorCookie)
      .send({})
      .expect(204);

    const login = await request(app).post("/api/umf-support/login").send({
      email: "new-agent@example.com",
      password: "DifferentPassword123",
      rememberDevice: false,
    });
    expect(login.status).toBe(200);
    const agentCookie = login.headers["set-cookie"][0];
    await request(app)
      .get("/api/umf-support/session")
      .set("Cookie", agentCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user.accessApproved).toBe(true);
      });
    const capabilities = await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", agentCookie)
      .expect(200);
    expect(capabilities.body.capabilities.role).toBe("agent");
    expect(capabilities.body.capabilities.canManageAdministrators).toBe(false);

    const initialAlerts = await request(app)
      .get("/api/umf-support/notification-settings")
      .set("Cookie", agentCookie)
      .expect(200);
    expect(initialAlerts.body.settings).toMatchObject({
      enabled: false,
      preferences: {
        ticket_created: { email: false, push: false },
      },
    });
    await request(app)
      .put("/api/umf-support/notification-settings")
      .set("Cookie", agentCookie)
      .send({
        enabled: true,
        preferences: {
          ticket_created: { email: true, push: false },
          conversation_received: { email: false, push: false },
          inbound_email: { email: false, push: false },
          feedback_received: { email: false, push: false },
          problem_reported: { email: false, push: false },
        },
      })
      .expect(200, { updated: true });
    await expect(
      database.db
        .selectFrom("umfSupportNotificationPreferences")
        .select("enabled")
        .where("userId", "=", registered.body.user.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ enabled: 1 });

    const events = await database.db
      .selectFrom("securityEvents")
      .select("type")
      .where("type", "in", [
        "umf_support_access_requested",
        "umf_support_account_activated",
      ])
      .execute();
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set([
        "umf_support_access_requested",
        "umf_support_account_activated",
      ]),
    );

    const lateDraft = await request(app)
      .post("/api/umf-support/mail/drafts")
      .set("Cookie", directorCookie)
      .send({
        to: ["late@example.net"],
        cc: [],
        bcc: [],
        subject: "Envío iniciado",
        body: "Este envío ya ha alcanzado su hora de entrega.",
      })
      .expect(201);
    const lateScheduledAt = Date.now() + 60 * 60 * 1000;
    await request(app)
      .post(`/api/umf-support/mail/drafts/${lateDraft.body.draft.id}/send`)
      .set("Cookie", directorCookie)
      .send({ scheduledAt: lateScheduledAt })
      .expect(202);
    const lateDelivery = await database.db
      .selectFrom("emailDeliveries")
      .select("id")
      .where("recipient", "=", "late@example.net")
      .executeTakeFirstOrThrow();
    await database.db
      .updateTable("emailDeliveries")
      .set({ status: "processing" })
      .where("id", "=", lateDelivery.id)
      .execute();
    await request(app)
      .post(`/api/umf-support/mail/drafts/${lateDraft.body.draft.id}/cancel`)
      .set("Cookie", directorCookie)
      .send({})
      .expect(400);
    await expect(
      database.db
        .selectFrom("umfSupportMailDrafts")
        .select("status")
        .where("id", "=", lateDraft.body.draft.id)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "scheduled" });
  });

  it("keeps the former public request and activation endpoints closed", async () => {
    await request(app)
      .post("/api/umf-support/access-requests/invite")
      .set("Cookie", directorCookie)
      .send({ email: "public-request@example.com" })
      .expect(404);
    await request(app)
      .post("/api/umf-support/access-requests")
      .send({ email: "public-request@example.com" })
      .expect(401);
    await request(app)
      .post("/api/umf-support/activate")
      .send({ email: "public-request@example.com", code: "123456" })
      .expect(401);
  });

  it("keeps tickets and mailboxes inside the corporate application", async () => {
    const created = await request(app)
      .post("/api/umf-support/tickets")
      .set("Cookie", directorCookie)
      .send({
        requesterEmail: "centre@example.com",
        requesterName: "Centre Owner",
        organizationName: "Centre One",
        subject: "Production access question",
        message: "We need help with the platform configuration.",
        category: "technical",
        priority: "high",
      })
      .expect(201);
    expect(created.body.ticket.publicId).toMatch(/^UMF-/);

    await request(app)
      .post(`/api/umf-support/tickets/${created.body.ticket.id}/messages`)
      .set("Cookie", directorCookie)
      .send({ body: "We are reviewing the configuration.", sendEmail: false })
      .expect(201);

    const outgoing = await request(app)
      .get("/api/umf-support/mailbox/outbound")
      .set("Cookie", directorCookie)
      .expect(200);
    expect(outgoing.body.messages).toHaveLength(1);
    expect(outgoing.body.messages[0].recipient).toBe("centre@example.com");

    const facilitySupportRows = await database.db
      .selectFrom("supportTickets")
      .select("id")
      .execute();
    expect(facilitySupportRows).toHaveLength(0);
  });

  it("stores mail drafts encrypted and schedules or cancels support-scoped delivery", async () => {
    const created = await request(app)
      .post("/api/umf-support/mail/drafts")
      .set("Cookie", directorCookie)
      .send({
        to: ["customer@example.net"],
        cc: ["accounting@example.net"],
        bcc: ["audit@example.net"],
        subject: "Seguimiento de la incidencia",
        body: "Consulta [el ticket](https://www.umbraviaforge.com/umf-support).",
      })
      .expect(201);
    const draftId = created.body.draft.id as string;
    const storedDraft = await database.db
      .selectFrom("umfSupportMailDrafts")
      .select(["content", "status", "deliveryIds"])
      .where("id", "=", draftId)
      .executeTakeFirstOrThrow();
    expect(storedDraft.status).toBe("draft");
    expect(storedDraft.deliveryIds).toBe("[]");
    expect(storedDraft.content).not.toContain("Seguimiento de la incidencia");
    expect(storedDraft.content).not.toContain("audit@example.net");

    const drafts = await request(app)
      .get("/api/umf-support/mail/drafts")
      .set("Cookie", directorCookie)
      .expect(200);
    expect(drafts.body.drafts).toContainEqual(
      expect.objectContaining({
        id: draftId,
        to: ["customer@example.net"],
        cc: ["accounting@example.net"],
        bcc: ["audit@example.net"],
        status: "draft",
      }),
    );

    const scheduledAt = Date.now() + 60 * 60 * 1000;
    await request(app)
      .post(`/api/umf-support/mail/drafts/${draftId}/send`)
      .set("Cookie", directorCookie)
      .send({ scheduledAt })
      .expect(202, { queued: true, scheduledAt });
    const deliveries = await database.db
      .selectFrom("emailDeliveries")
      .select(["id", "recipient", "platformScope", "kind", "nextAttemptAt"])
      .where("platformScope", "=", "support")
      .where("kind", "=", "support_update")
      .where("nextAttemptAt", "=", scheduledAt)
      .execute();
    expect(deliveries).toHaveLength(3);
    expect(new Set(deliveries.map((delivery) => delivery.recipient))).toEqual(
      new Set([
        "customer@example.net",
        "accounting@example.net",
        "audit@example.net",
      ]),
    );

    await request(app)
      .post(`/api/umf-support/mail/drafts/${draftId}/cancel`)
      .set("Cookie", directorCookie)
      .send({})
      .expect(200, { cancelled: true });
    await expect(
      database.db
        .selectFrom("emailDeliveries")
        .select(["status", "recipient", "payloadEncrypted"])
        .where(
          "id",
          "in",
          deliveries.map((delivery) => delivery.id),
        )
        .execute(),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "superseded",
          recipient: "",
          payloadEncrypted: "",
        }),
      ]),
    );
  });

  it("keeps corporate mail attachments encrypted, authenticated and GIF-free", async () => {
    const created = await request(app)
      .post("/api/umf-support/mail/drafts")
      .set("Cookie", directorCookie)
      .send({
        to: ["attachment@example.net"],
        cc: [],
        bcc: [],
        subject: "Documentación solicitada",
        body: "Adjuntamos el documento solicitado.",
      })
      .expect(201);
    const draftId = created.body.draft.id as string;
    const body = Buffer.from("%PDF-1.7\nUMF Support test document");
    const uploaded = await request(app)
      .post(`/api/umf-support/mail/drafts/${draftId}/attachments`)
      .set("Cookie", directorCookie)
      .set("Content-Type", "application/pdf")
      .set("X-File-Name", "informe.pdf")
      .send(body)
      .expect(201);
    expect(uploaded.body.attachment).toMatchObject({
      draftId,
      fileName: "informe.pdf",
      mimeType: "application/pdf",
      sizeBytes: body.length,
    });
    expect(uploaded.body.attachment.storageKey).toBeUndefined();

    const stored = await database.db
      .selectFrom("umfSupportMailAttachments")
      .select(["id", "storageKey", "checksumSha256"])
      .where("id", "=", uploaded.body.attachment.id)
      .executeTakeFirstOrThrow();
    expect(stored.storageKey).not.toContain("informe.pdf");
    expect(stored.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    await request(app)
      .get(
        `/api/umf-support/mail/drafts/${draftId}/attachments/${uploaded.body.attachment.id}`,
      )
      .expect(401);
    const downloaded = await request(app)
      .get(
        `/api/umf-support/mail/drafts/${draftId}/attachments/${uploaded.body.attachment.id}`,
      )
      .set("Cookie", directorCookie)
      .expect("Content-Type", /application\/pdf/)
      .expect("X-Content-Type-Options", "nosniff")
      .expect(200);
    expect(downloaded.headers["content-disposition"]).toContain("attachment;");
    expect(Buffer.from(downloaded.body)).toEqual(body);

    await request(app)
      .post(`/api/umf-support/mail/drafts/${draftId}/attachments`)
      .set("Cookie", directorCookie)
      .set("Content-Type", "image/gif")
      .set("X-File-Name", "animacion.gif")
      .send(Buffer.from("GIF89a"))
      .expect(400);
  });

  it("authenticates, classifies and deduplicates privacy email", async () => {
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.capabilities.email).toMatchObject({
          inbound: true,
          inboundState: "configured",
          inboundOperationallyVerified: false,
        });
      });

    const payload = {
      version: 1,
      envelopeTo: "privacy@example.com",
      from: "person@example.net",
      messageId: "<privacy-right-1@example.net>",
      subject: "Ejercicio del derecho de acceso a mis datos",
      text: "Quiero conocer los datos personales que trata la plataforma.",
      attachmentCount: 0,
    };
    const send = (input: typeof payload) => {
      const body = JSON.stringify(input);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signSupportEmailWebhook(
        Buffer.from(body),
        timestamp,
        Buffer.alloc(32, 29),
      );
      return request(app)
        .post("/api/internal/umf-support-email")
        .set("Content-Type", "application/json")
        .set("X-Umbravia-Timestamp", timestamp)
        .set("X-Umbravia-Signature", signature)
        .send(body);
    };

    await request(app)
      .post("/api/internal/umf-support-email")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(401);

    const created = await send(payload);
    expect(created.status).toBe(202);
    expect(created.body.ticketPublicId).toMatch(/^UMF-[A-F0-9]{10}$/);
    const duplicate = await send(payload);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      duplicate: true,
      ticketPublicId: created.body.ticketPublicId,
    });
    await request(app)
      .get("/api/umf-support/capabilities")
      .set("Cookie", directorCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.capabilities.email).toMatchObject({
          inbound: true,
          inboundState: "configured",
          inboundOperationallyVerified: true,
        });
      });

    const ticket = await database.db
      .selectFrom("umfSupportTickets")
      .select(["id", "category", "requesterEmail"])
      .where("publicId", "=", created.body.ticketPublicId)
      .executeTakeFirstOrThrow();
    expect(ticket).toMatchObject({
      category: "privacy",
      requesterEmail: "person@example.net",
    });

    const configuration = resolveUmfSupportEmailConfiguration();
    const replyAddress = buildUmfSupportReplyAddress(
      created.body.ticketPublicId,
      payload.from,
      configuration!,
    );
    const reply = await send({
      ...payload,
      envelopeTo: replyAddress,
      messageId: "<privacy-right-reply-1@example.net>",
      subject: `Re: ${payload.subject}`,
      text: "Añado una precisión a mi solicitud.",
    });
    expect(reply.status).toBe(202);

    const attackerReply = await send({
      ...payload,
      envelopeTo: replyAddress,
      from: "attacker@example.net",
      messageId: "<privacy-right-attacker@example.net>",
      subject: `Re: ${payload.subject}`,
      text: "Intento de incorporar contenido al ticket ajeno.",
    });
    expect(attackerReply.status).toBe(403);

    const messages = await database.db
      .selectFrom("umfSupportMessages")
      .select("id")
      .where("ticketId", "=", ticket.id)
      .execute();
    expect(messages).toHaveLength(2);
  });

  it("freezes support operations without blocking commercial account management", async () => {
    vi.stubEnv("UMF_SUPPORT_OPERATIONAL_WORKSPACE_ENABLED", "false");
    try {
      await request(app)
        .get("/api/umf-support/capabilities")
        .set("Cookie", directorCookie)
        .expect(200)
        .expect(({ body }) => {
          expect(body.capabilities.operationalWorkspaceEnabled).toBe(false);
          expect(body.capabilities.canManageCommercialTrials).toBe(true);
        });
      await request(app)
        .get("/api/umf-support/tickets")
        .set("Cookie", directorCookie)
        .expect(503)
        .expect(({ body }) => {
          expect(body.code).toBe("UMF_SUPPORT_OPERATIONS_FROZEN");
        });
      await request(app)
        .get("/api/umf-support/commercial-account-metrics")
        .set("Cookie", directorCookie)
        .expect(200);
    } finally {
      vi.stubEnv("UMF_SUPPORT_OPERATIONAL_WORKSPACE_ENABLED", "true");
    }
  });
});

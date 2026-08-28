import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS } from "../lib/commercial-trial.js";
import { createActiveTestFacility } from "../testing/facility-fixtures.js";

describe("commercial foundation API", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let app: typeof import("../index.js").app;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-commercial-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TENANT_BASE_DOMAIN", "umbraviaforge.test");
    vi.resetModules();
    database = await import("../db/client.js");
    const auth = await import("../services/auth.js");
    await database.initializeDatabase();
    await database.db
      .insertInto("users")
      .values([
        {
          id: "commercial-admin",
          email: "commercial-admin@example.com",
          phone: null,
          name: "Commercial Admin",
          avatarDataUrl: "",
          password: await auth.hashPassword("CommercialAdmin123"),
          role: "admin",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        },
        {
          id: "commercial-member",
          email: "commercial-member@example.com",
          phone: null,
          name: "Commercial Member",
          avatarDataUrl: "",
          password: await auth.hashPassword("CommercialMember123"),
          role: "member",
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        },
      ])
      .execute();
    const now = Date.now();
    await createActiveTestFacility(database.db, "facility-alpha", {
      createdAt: now,
    });
    await database.db
      .insertInto("facilityMemberships")
      .values([
        {
          id: "facility-alpha:commercial-admin",
          facilityId: "facility-alpha",
          userId: "commercial-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "facility-alpha:commercial-member",
          facilityId: "facility-alpha",
          userId: "commercial-member",
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .execute();
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
                ? "CommercialAdmin123"
                : "CommercialMember123",
            accessPortal,
            rememberDevice: false,
          })
      ).headers["set-cookie"][0];
    adminCookie = await login("commercial-admin@example.com", "staff");
    memberCookie = await login("commercial-member@example.com", "member");
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("publishes the modular vision and the product-first commercial policy", async () => {
    const response = await request(app).get("/api/commercial").expect(200);

    expect(response.body).toMatchObject({
      productName: "Umbravia Forge",
      principle: "Producto primero, conversación después.",
      trialDays: 31,
      trialProvisioningEnabled: true,
      contactPolicy: {
        automaticContact: false,
        unsolicitedCalls: false,
        userInitiatedOnly: true,
      },
    });
    expect(response.body.facilityTypes).toHaveLength(14);
    expect(response.body.modules).toContain("attendance_uncertainty");
    expect(response.body.commitments).toContain("self_service_exploration");
    expect(response.body.developmentOrder[0]).toMatchObject({
      priority: 1,
      area: "bookings",
    });
    expect(response.body.currentCommercialScope).toEqual({
      implementedThroughPoint: 7,
      point8FoundationAvailable: true,
      conversionExecutionAvailable: false,
      isolatedTenantProvisioningAvailable: false,
    });
    expect(response.body.trialPolicy).toEqual({
      durationDays: 31,
      finalDataReviewGraceHours: 6,
      reminderDays: [1, 14, 24, 28, 31],
      automaticRenewal: false,
      automaticSalesContact: false,
      artificialDiscounts: false,
      lastDayFeatureLock: false,
    });
  });

  it("restricts trial configuration to administrators", async () => {
    await request(app).get("/api/commercial/trial").expect(401);
    await request(app)
      .get("/api/commercial/trial")
      .set("Cookie", memberCookie)
      .expect(403);
  });

  it("exposes the configured parent domain to authorised setup forms", async () => {
    await request(app)
      .get("/api/commercial/trial/setup")
      .set("Cookie", adminCookie)
      .expect(200)
      .expect({ tenantBaseDomain: "umbraviaforge.test" });
  });

  it("keeps trial provisioning opt-in in production", async () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("COMMERCIAL_TRIALS_ENABLED", "false");
      await request(app)
        .get("/api/commercial")
        .expect(200)
        .expect(({ body }) => {
          expect(body.trialProvisioningEnabled).toBe(false);
        });
      await request(app)
        .post("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({ facilityName: "Blocked Centre", facilityType: "yoga" })
        .expect(503)
        .expect(({ body }) => {
          expect(body.code).toBe("COMMERCIAL_TRIALS_DISABLED");
        });
    } finally {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("COMMERCIAL_TRIALS_ENABLED", "true");
    }
  });

  it("materializes localized defaults without rewriting explicit activities", async () => {
    const now = Date.now();
    for (const facilityId of ["localized-commercial", "empty-commercial"]) {
      await createActiveTestFacility(database.db, facilityId, {
        createdAt: now,
      });
      await database.db
        .insertInto("facilityMemberships")
        .values({
          id: `${facilityId}:commercial-admin`,
          facilityId,
          userId: "commercial-admin",
          role: "owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }

    const created = await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "localized-commercial")
      .send({
        facilityName: "Centre localisé",
        facilityType: "traditional_gym",
        locale: "fr-FR",
      })
      .expect(201);
    expect(created.body.trial).toMatchObject({
      locale: "fr",
      classTypes: ["Accès libre à la salle", "Cours encadré"],
    });

    const explicitActivities = ["  Circuit Ω — 50 %  ", " Mobilité/équilibre "];
    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "localized-commercial")
      .send({ classTypes: explicitActivities })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.classTypes).toEqual(explicitActivities);
      });

    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "localized-commercial")
      .send({ locale: "it_IT", facilityType: "hyrox" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial).toMatchObject({
          locale: "it",
          facilityType: "hyrox",
          classTypes: explicitActivities,
        });
      });

    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "localized-commercial")
      .send({ classTypes: [] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.classTypes).toEqual([]);
      });

    await request(app)
      .post("/api/commercial/trial/restore-configuration")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "localized-commercial")
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.trial.classTypes).toEqual([
          "HYROX",
          "Tecnica delle stazioni",
        ]);
      });

    await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "empty-commercial")
      .send({
        facilityName: "Empty activities",
        facilityType: "bodybuilding",
        locale: "de-CH",
        classTypes: [],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.trial).toMatchObject({
          locale: "de-CH",
          classTypes: [],
        });
      });

    await request(app)
      .get("/api/commercial")
      .expect(200)
      .expect(({ body }) => {
        expect(body.templates.traditional_gym.classTypes).toEqual([
          "Sala libre",
          "Clase dirigida",
        ]);
        expect(body.templates.hyrox.classTypes).toEqual([
          "HYROX",
          "Técnica de estaciones",
        ]);
      });
  });

  it("creates an editable centre from a template and preserves configuration", async () => {
    for (const locale of [
      "xx",
      "oc",
      "oc-ES",
      "oc-FR",
      "oc-Latn-ES",
      "ca-FR-valencia",
      "ca-US-valencia",
      "oc-FR-aranes",
    ]) {
      await request(app)
        .post("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({
          facilityName: "Invalid Locale Centre",
          facilityType: "crossfit",
          locale,
        })
        .expect(400);
    }

    const created = await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({
        facilityName: "Fitness Boreal",
        facilityType: "crossfit",
        subdomain: "fitness-boreal-preview",
        classTypes: ["WOD", "Movilidad"],
        locale: "CA_es_VALENCIA",
        currency: "eur",
        usesBookings: true,
        publicDescription: "Entrenamiento de fuerza y acondicionamiento.",
        city: "Jaén",
        country: "España",
        websiteUrl: "https://fitness-boreal.example",
        pricingDescription: "Cuota mensual: 45 €.",
        publicPageEnabled: true,
      })
      .expect(201);

    expect(created.body.trial).toMatchObject({
      facilityName: "Fitness Boreal",
      facilityType: "crossfit",
      usualCapacity: 14,
      classTypes: ["WOD", "Movilidad"],
      currency: "EUR",
      usesBookings: true,
      locale: "ca-valencia",
      status: "trial_active",
    });
    expect(created.body.trial).toMatchObject({
      subdomain: "fitness-boreal-preview",
      publicDescription: "Entrenamiento de fuerza y acondicionamiento.",
      publicPageEnabled: true,
    });
    expect(created.body.trial.expiresAt - created.body.trial.startedAt).toBe(
      31 * 24 * 60 * 60 * 1000,
    );
    expect(created.body.trial.notice).toMatchObject({
      milestone: 1,
      remainingDays: 31,
    });
    expect(created.body.dataReview).toMatchObject({
      visible: false,
      canDeclare: false,
      declarationBlockReason: "not-open",
    });
    expect(created.body.dataReview.opensAt).toBeGreaterThan(
      created.body.dataReview.serverNow,
    );
    expect(created.body.trial).not.toHaveProperty("conversionDraft");

    for (const [locale, canonical] of [
      ["FR-fr", "fr"],
      ["it_IT", "it"],
      ["oc-ES-aranes", "oc-aranes"],
      ["ca-ES-valencia", "ca-valencia"],
    ] as const) {
      await request(app)
        .patch("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({ locale })
        .expect(200)
        .expect(({ body }) => {
          expect(body.trial.locale).toBe(canonical);
        });
    }
    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ locale: "xx" })
      .expect(400);

    await request(app)
      .get("/api/commercial/public-centres")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          slug: "fitness-boreal-preview",
          name: "Fitness Boreal",
          city: "Jaén",
        });
      });
    await request(app)
      .get("/api/commercial/public-centres/fitness-boreal-preview")
      .expect(200)
      .expect(({ body }) => {
        expect(body.pricingDescription).toBe("Cuota mensual: 45 €.");
      });

    const updated = await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({
        scheduleNotes: "Horario provisional",
        subdomain: "Fitness-Boreal",
      })
      .expect(200);
    expect(updated.body.trial).toMatchObject({
      scheduleNotes: "Horario provisional",
      subdomain: "fitness-boreal",
      locale: "ca-valencia",
    });

    expect(updated.body.environment).toMatchObject({
      isolation: "shared_local_demo",
      restorationScope: "commercial_configuration_only",
    });
    expect(updated.body.environment.modules).toContain("bookings");

    const restored = await request(app)
      .post("/api/commercial/trial/restore-configuration")
      .set("Cookie", adminCookie)
      .send({})
      .expect(200);
    expect(restored.body.trial).toMatchObject({
      usualCapacity: 14,
      classTypes: ["WOD", "Box obert"],
      scheduleNotes: "",
    });
    expect(restored.body.events[0]).toMatchObject({
      type: "commercial_configuration_restored",
      metadata: { scope: "commercial_configuration_only" },
    });

    const facility = await database.db
      .selectFrom("facilityProfiles")
      .selectAll()
      .where("id", "=", "facility-alpha")
      .executeTakeFirstOrThrow();
    expect(facility.name).toBe("Fitness Boreal");
    expect(facility.slug).toBe("fitness-boreal");
  });

  it("rejects unknown fields and duplicate trial creation", async () => {
    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ secretSalesFlag: true })
      .expect(400);

    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ trainerCount: 4 })
      .expect(400);

    await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ facilityName: "Otro centro", facilityType: "yoga" })
      .expect(409);
  });

  it("isolates commercial trials and active-user counts by facility", async () => {
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "commercial-secondary",
        slug: "commercial-secondary",
        name: "Secondary Centre",
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
        id: "commercial-secondary:commercial-admin",
        facilityId: "commercial-secondary",
        userId: "commercial-admin",
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const secondary = await request(app)
      .post("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "commercial-secondary")
      .send({
        facilityName: "Secondary Centre",
        facilityType: "yoga",
      })
      .expect(201);
    expect(secondary.body.trial).toMatchObject({
      facilityId: "commercial-secondary",
      facilityName: "Secondary Centre",
    });
    expect(secondary.body.environment.counts.users).toBe(1);
    expect(secondary.body.environment).toMatchObject({
      isolation: "shared_local_demo",
      routing: "not_provisioned",
      subdomainMeaning: "reserved_identifier",
    });

    const facility_alpha = await request(app)
      .get("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(facility_alpha.body.trial).toMatchObject({
      facilityId: "facility-alpha",
      facilityName: "Fitness Boreal",
    });
    const selectedSecondary = await request(app)
      .get("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .set("X-Facility-Id", "commercial-secondary")
      .expect(200);
    expect(selectedSecondary.body.trial.facilityName).toBe("Secondary Centre");
  });

  it("rejects reserved and already assigned subdomains without partial updates", async () => {
    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ subdomain: "support" })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("COMMERCIAL_TRIAL_SUBDOMAIN_INVALID");
      });

    await request(app)
      .patch("/api/commercial/trial")
      .set("Cookie", adminCookie)
      .send({ subdomain: "commercial-secondary" })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("COMMERCIAL_TRIAL_SUBDOMAIN_UNAVAILABLE");
      });

    const [trial, facility] = await Promise.all([
      database.db
        .selectFrom("commercialTrials")
        .select("subdomain")
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
      database.db
        .selectFrom("facilityProfiles")
        .select("slug")
        .where("id", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ]);
    expect(trial.subdomain).toBe("fitness-boreal");
    expect(facility.slug).toBe("fitness-boreal");
  });

  it("keeps repeated configuration edits unrestricted during the active trial", async () => {
    for (let index = 0; index < 21; index += 1) {
      const response = await request(app)
        .patch("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({ scheduleNotes: `Edición de prueba ${index + 1}` })
        .expect(200);

      expect(response.body.trial.scheduleNotes).toBe(
        `Edición de prueba ${index + 1}`,
      );
    }
  });

  it("limits post-trial edit bursts per tenant without affecting another centre", async () => {
    const facility_alpha = await database.db
      .selectFrom("commercialTrials")
      .selectAll()
      .where("facilityId", "=", "facility-alpha")
      .executeTakeFirstOrThrow();
    const secondary = await database.db
      .selectFrom("commercialTrials")
      .selectAll()
      .where("facilityId", "=", "commercial-secondary")
      .executeTakeFirstOrThrow();
    const eventIds = Array.from(
      { length: 20 },
      (_, index) => `post-trial-limit-facility_alpha-${index}`,
    );

    try {
      await database.db
        .updateTable("commercialTrials")
        .set({ status: "trial_expired" })
        .where("id", "in", [facility_alpha.id, secondary.id])
        .execute();

      await request(app)
        .patch("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({ subdomain: "locked-after-trial" })
        .expect(409)
        .expect(({ body }) => {
          expect(body.code).toBe("COMMERCIAL_TRIAL_SUBDOMAIN_LOCKED");
        });

      await database.db
        .insertInto("commercialTrialEvents")
        .values(
          eventIds.map((id, index) => ({
            id,
            trialId: facility_alpha.id,
            actorUserId: "commercial-admin",
            type: "trial_configuration_updated",
            metadata: JSON.stringify({ editPolicy: "post_trial_limited" }),
            createdAt: Date.now() - index,
          })),
        )
        .execute();

      await request(app)
        .patch("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .send({ scheduleNotes: "Debe quedar temporalmente limitada" })
        .expect(429)
        .expect("Retry-After", /\d+/)
        .expect(({ body }) => {
          expect(body.code).toBe("COMMERCIAL_TRIAL_EDIT_COOLDOWN");
          expect(body.retryAfterSeconds).toBeGreaterThan(0);
        });

      const secondaryUpdate = await request(app)
        .patch("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .set("X-Facility-Id", "commercial-secondary")
        .send({ scheduleNotes: "El segundo tenant sigue editable" })
        .expect(200);
      expect(secondaryUpdate.body.trial).toMatchObject({
        facilityId: "commercial-secondary",
        scheduleNotes: "El segundo tenant sigue editable",
      });

      const unchangedPrimary = await request(app)
        .get("/api/commercial/trial")
        .set("Cookie", adminCookie)
        .expect(200);
      expect(unchangedPrimary.body.trial.scheduleNotes).not.toBe(
        "El segundo tenant sigue editable",
      );
    } finally {
      await database.db
        .deleteFrom("commercialTrialEvents")
        .where("id", "in", eventIds)
        .execute();
      await database.db
        .updateTable("commercialTrials")
        .set({ status: "trial_active" })
        .where("id", "in", [facility_alpha.id, secondary.id])
        .execute();
    }
  });

  it("creates voluntary commercial contact without sharing environment data by default", async () => {
    const response = await request(app)
      .post("/api/commercial/trial/contact")
      .set("Cookie", adminCookie)
      .send({
        name: "Javier López",
        facilityName: "Fitness Boreal",
        email: "javier@example.com",
        message: "Quiero conocer las opciones comerciales disponibles.",
        preferredChannel: "email",
        contactConsent: true,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      kind: "commercial_contact",
      status: "open",
    });
    const stored = await database.db
      .selectFrom("commercialRequests")
      .selectAll()
      .where("id", "=", response.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.environmentSummary).toBeNull();
    expect(stored.includeEnvironmentSummary).toBe(0);

    await request(app)
      .post("/api/commercial/trial/contact")
      .set("Cookie", adminCookie)
      .send({
        name: "Javier López",
        facilityName: "Fitness Boreal",
        email: "javier@example.com",
        message: "Intento sin consentimiento válido.",
        preferredChannel: "email",
        contactConsent: false,
      })
      .expect(400);
  });

  it("enforces the real-data review boundary in the service and protected route", async () => {
    const service = await import("../services/commercial-trial.js");
    const expiresAt = Date.parse("2026-10-31T18:00:00.000Z");
    const opensAt = expiresAt - COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
    const resetPendingTrial = async (nextExpiresAt: number) => {
      await database.db
        .updateTable("commercialTrials")
        .set({
          status: "trial_active",
          realDataDeclaration: "undeclared",
          conversionDraft: "[]",
          expiresAt: nextExpiresAt,
          pausedAt: null,
          closedAt: null,
          dataReviewRequestedAt: null,
          cleanupEligibleAt: null,
        })
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow();
    };

    await resetPendingTrial(expiresAt);
    await expect(
      service.declareCommercialTrialData(
        "commercial-admin",
        "facility-alpha",
        "yes",
        opensAt - 1,
      ),
    ).rejects.toMatchObject({
      code: "COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN",
      statusCode: 409,
    });
    expect(
      await database.db
        .selectFrom("commercialTrials")
        .select("realDataDeclaration")
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).toEqual({ realDataDeclaration: "undeclared" });

    const acceptedAtBoundary = await service.declareCommercialTrialData(
      "commercial-admin",
      "facility-alpha",
      "yes",
      opensAt,
    );
    expect(acceptedAtBoundary).toMatchObject({
      trial: {
        status: "trial_conversion_review",
        realDataDeclaration: "yes",
      },
      dataReview: { visible: true, canDeclare: false, opensAt },
    });

    const cleanupBoundary = expiresAt + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS;
    await resetPendingTrial(expiresAt);
    await database.db
      .updateTable("commercialTrials")
      .set({
        status: "trial_expired",
        cleanupEligibleAt: cleanupBoundary,
      })
      .where("facilityId", "=", "facility-alpha")
      .executeTakeFirstOrThrow();
    await expect(
      service.declareCommercialTrialData(
        "commercial-admin",
        "facility-alpha",
        "yes",
        cleanupBoundary,
      ),
    ).rejects.toMatchObject({
      code: "COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN",
      statusCode: 409,
    });
    expect(
      await database.db
        .selectFrom("commercialTrials")
        .select(["status", "realDataDeclaration", "cleanupEligibleAt"])
        .where("facilityId", "=", "facility-alpha")
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: "trial_expired",
      realDataDeclaration: "undeclared",
      cleanupEligibleAt: cleanupBoundary,
    });

    const routeNow = Date.now();
    await resetPendingTrial(
      routeNow + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS + 60_000,
    );
    await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .send({ decision: "yes" })
      .expect(401);
    await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", memberCookie)
      .send({ decision: "yes" })
      .expect(403);
    await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", memberCookie)
      .set("X-Facility-Id", "commercial-secondary")
      .send({ decision: "yes" })
      .expect(403);
    await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "yes" })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("COMMERCIAL_TRIAL_DATA_REVIEW_NOT_OPEN");
      });

    await resetPendingTrial(Date.now() + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS);
    const acceptedRoute = await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "assistance" })
      .expect(200);
    expect(acceptedRoute.body).toMatchObject({
      trial: {
        status: "trial_paused_support",
        realDataDeclaration: "assistance",
      },
      dataReview: { visible: true, canDeclare: false },
    });
    expect(
      await database.db
        .selectFrom("commercialTrials")
        .select("realDataDeclaration")
        .where("facilityId", "=", "commercial-secondary")
        .executeTakeFirstOrThrow(),
    ).toEqual({ realDataDeclaration: "undeclared" });

    await resetPendingTrial(Date.now() + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS);
  });

  it("supports the three exact data decisions and only closes after no", async () => {
    await request(app)
      .post("/api/commercial/trial/close")
      .set("Cookie", adminCookie)
      .send({})
      .expect(409);

    await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "uncertain" })
      .expect(400);

    await request(app)
      .get("/api/commercial/trial/conversion-draft")
      .set("Cookie", adminCookie)
      .expect(409);

    const withRealData = await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "yes" })
      .expect(200);
    expect(withRealData.body.trial).toMatchObject({
      status: "trial_conversion_review",
      realDataDeclaration: "yes",
    });

    const draft = await request(app)
      .get("/api/commercial/trial/conversion-draft")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(draft.body).toMatchObject({
      mode: "classification_only",
      conversionExecuted: false,
    });
    expect(draft.body.items).toHaveLength(10);

    const classified = await request(app)
      .patch("/api/commercial/trial/conversion-draft")
      .set("Cookie", adminCookie)
      .send({
        category: "classes",
        origin: "user_created",
        decision: "keep",
      })
      .expect(200);
    expect(classified.body.items).toContainEqual({
      category: "classes",
      origin: "user_created",
      decision: "keep",
    });
    expect(classified.body.conversionExecuted).toBe(false);

    await database.db
      .updateTable("commercialTrials")
      .set({
        status: "trial_active",
        realDataDeclaration: "undeclared",
        pausedAt: null,
      })
      .where("facilityId", "=", "facility-alpha")
      .execute();
    const assistance = await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "assistance" })
      .expect(200);
    expect(assistance.body.trial).toMatchObject({
      status: "trial_paused_support",
      realDataDeclaration: "assistance",
    });

    await database.db
      .updateTable("commercialTrials")
      .set({
        status: "trial_active",
        realDataDeclaration: "undeclared",
        pausedAt: null,
      })
      .where("facilityId", "=", "facility-alpha")
      .execute();
    const withoutRealData = await request(app)
      .post("/api/commercial/trial/real-data-declaration")
      .set("Cookie", adminCookie)
      .send({ decision: "no" })
      .expect(200);
    expect(withoutRealData.body.trial.realDataDeclaration).toBe("no");

    const closed = await request(app)
      .post("/api/commercial/trial/close")
      .set("Cookie", adminCookie)
      .send({})
      .expect(200);
    expect(closed.body.trial.status).toBe("trial_closed");
  });

  it("does not leave commercial records blocking administrator deletion", async () => {
    const users = await import("../services/users.js");
    await expect(users.deleteUser("commercial-admin")).resolves.toBeUndefined();
    expect(
      await database.db
        .selectFrom("commercialTrials")
        .select("id")
        .executeTakeFirst(),
    ).toBeUndefined();
  });
});

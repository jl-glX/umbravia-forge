import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { db } from "../db/client.js";
import type {
  CommercialFacilityType,
  Database,
  RealDataDeclaration,
} from "../db/types.js";
import {
  COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS,
  COMMERCIAL_TRIAL_MS,
  commercialTemplates,
  getTrialNotice,
} from "../lib/commercial-trial.js";
import {
  createFacilitySlug,
  createTrialSubdomain,
} from "../lib/facility-slug.js";
import { deleteUserInTransaction, UserDeletionBlockedError } from "./users.js";
import { stageCommercialEnvironmentRemoval } from "./environment-manager.js";
import {
  ManagerCoordinationConflictError,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";
import { stageCommunityAttachmentFilesRemoval } from "./community-attachments.js";
import { stageSupportAttachmentFilesRemoval } from "./support.js";
import type { StagedFileRemoval } from "../lib/staged-file-removal.js";
import { tenantOriginForSlug } from "../lib/tenant-host.js";

type TrialInput = {
  facilityName: string;
  facilityType: CommercialFacilityType;
  classTypes?: string[];
  scheduleNotes?: string;
  locale?: "es" | "en" | "de" | "de-CH";
  currency?: string;
  usesBookings?: boolean;
  usesWaitlist?: boolean;
};

export type AdministratorTrialTenantInput = Pick<
  TrialInput,
  "facilityName" | "facilityType" | "locale"
>;

const conversionCategories = [
  "facility_configuration",
  "classes",
  "schedules",
  "real_members",
  "fictional_members",
  "real_trainers",
  "simulated_invoices",
  "legitimate_invoices",
  "booking_rules",
  "artificial_statistics",
] as const;
type ConversionCategory = (typeof conversionCategories)[number];
type ConversionOrigin = "demo_seed" | "user_created" | "imported" | "converted";
type ConversionDecision = "pending" | "keep" | "discard";
type ConversionDraftItem = {
  category: ConversionCategory;
  origin: ConversionOrigin;
  decision: ConversionDecision;
};

export type CommercialRequestInput = {
  name: string;
  facilityName: string;
  email: string;
  phone?: string | null;
  subject?: string;
  message: string;
  preferredChannel: "email" | "phone" | "whatsapp";
  preferredTime?: string;
  contactConsent: boolean;
  includeEnvironmentSummary?: boolean;
  problemCategory?: string | null;
};

function createConversionDraft(): ConversionDraftItem[] {
  return conversionCategories.map((category) => ({
    category,
    origin: "demo_seed",
    decision: "pending",
  }));
}

export async function finalizeAdministratorSignupInTransaction(
  transaction: Transaction<Database>,
  userId: string,
) {
  const pending = await transaction
    .selectFrom("administratorSignupProvisioning")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!pending) return null;

  const template = commercialTemplates[pending.facilityType];
  const now = Date.now();
  const facilityId = `facility-${randomUUID()}`;
  const trialId = `trial-${facilityId}`;
  const slug = createFacilitySlug(pending.facilityName);
  await transaction
    .insertInto("facilityProfiles")
    .values({
      id: facilityId,
      slug,
      name: pending.facilityName,
      logoDataUrl: "",
      accentColor: "#2563eb",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await transaction
    .insertInto("facilityMemberships")
    .values({
      id: `${facilityId}:${userId}`,
      facilityId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await transaction
    .insertInto("commercialTrials")
    .values({
      id: trialId,
      facilityId,
      ownerUserId: userId,
      facilityName: pending.facilityName,
      facilityType: pending.facilityType,
      approximateMembers: null,
      trainerCount: null,
      spaceCount: null,
      usualCapacity: template.usualCapacity,
      classTypes: JSON.stringify(template.classTypes),
      scheduleNotes: "",
      locale: pending.locale,
      currency: "EUR",
      usesBookings: 1,
      usesWaitlist: template.usesWaitlist ? 1 : 0,
      templateKey: pending.facilityType,
      status: "trial_active",
      subdomain: slug,
      realDataDeclaration: "undeclared",
      autoCleanupEligible: 1,
      dataReviewRequestedAt: null,
      cleanupEligibleAt: null,
      conversionDraft: "[]",
      startedAt: now,
      expiresAt: now + COMMERCIAL_TRIAL_MS,
      pausedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await transaction
    .insertInto("commercialTrialEvents")
    .values({
      id: randomUUID(),
      trialId,
      actorUserId: userId,
      type: "trial_created_with_administrator_account",
      metadata: JSON.stringify({ facilityType: pending.facilityType }),
      createdAt: now,
    })
    .execute();
  await transaction
    .deleteFrom("administratorSignupProvisioning")
    .where("userId", "=", userId)
    .execute();
  return {
    id: facilityId,
    slug,
    name: pending.facilityName,
    role: "owner" as const,
  };
}

export async function finalizeAdministratorSignup(userId: string) {
  return db
    .transaction()
    .execute((transaction) =>
      finalizeAdministratorSignupInTransaction(transaction, userId),
    );
}

function domainError(
  message: string,
  statusCode = 409,
  code?: string,
  retryAfterSeconds?: number,
) {
  return Object.assign(new Error(message), {
    statusCode,
    ...(code ? { code } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  });
}

function serializeTrial<T extends { classTypes: string }>(trial: T) {
  const publicTrial = { ...trial } as T & { conversionDraft?: string };
  delete publicTrial.conversionDraft;
  return {
    ...publicTrial,
    classTypes: JSON.parse(trial.classTypes) as string[],
    usesBookings: Boolean((trial as T & { usesBookings: number }).usesBookings),
    usesWaitlist: Boolean((trial as T & { usesWaitlist: number }).usesWaitlist),
    autoCleanupEligible: Boolean(
      (trial as T & { autoCleanupEligible: number }).autoCleanupEligible,
    ),
    notice: getTrialNotice(
      (trial as T & { startedAt: number }).startedAt,
      (trial as T & { expiresAt: number }).expiresAt,
    ),
  };
}

async function recordEvent(
  trialId: string,
  actorUserId: string,
  type: string,
  metadata: Record<string, unknown> = {},
) {
  await db
    .insertInto("commercialTrialEvents")
    .values({
      id: randomUUID(),
      trialId,
      actorUserId,
      type,
      metadata: JSON.stringify(metadata),
      createdAt: Date.now(),
    })
    .execute();
}

function cleanupExecutionEnabled(): boolean {
  const configured = process.env.COMMERCIAL_TRIAL_CLEANUP_ENABLED;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}

async function deleteTrialTenantInTransaction(
  transaction: Transaction<Database>,
  trial: { id: string; facilityId: string; ownerUserId: string },
) {
  const facility = await transaction
    .selectFrom("facilityProfiles")
    .select("status")
    .where("id", "=", trial.facilityId)
    .executeTakeFirstOrThrow();
  if (facility.status !== "active")
    throw new Error("An inactive facility cannot be removed automatically");

  await transaction
    .insertInto("commercialLifecycleFacts")
    .values({
      id: `commercial-trial-abandoned:${trial.id}`,
      kind: "commercial_trial_abandoned",
      subjectId: trial.id,
      occurredAt: Date.now(),
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  const classRows = await transaction
    .selectFrom("activitySessions")
    .select("id")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  const activitySessionIds = classRows.map((row) => row.id);

  await transaction
    .deleteFrom("moderationCases")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("parentalControls")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("facilityLinks")
    .where("sourceFacilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("supportTickets")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("supportAgents")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("supportKnowledgeArticles")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("billingRecords")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("bookingReputationEvents")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("bookingReputations")
    .where("facilityId", "=", trial.facilityId)
    .execute();
  await transaction
    .deleteFrom("communityChannels")
    .where("scope", "=", "facility")
    .where("scopeId", "=", trial.facilityId)
    .execute();

  if (activitySessionIds.length > 0) {
    await transaction
      .deleteFrom("communityChannels")
      .where("scope", "=", "class")
      .where("scopeId", "in", activitySessionIds)
      .execute();
    await transaction
      .deleteFrom("bookings")
      .where("activitySessionId", "in", activitySessionIds)
      .execute();
    await transaction
      .deleteFrom("waitlistEntries")
      .where("activitySessionId", "in", activitySessionIds)
      .execute();
    await transaction
      .deleteFrom("activitySessions")
      .where("id", "in", activitySessionIds)
      .execute();
  }

  await transaction
    .deleteFrom("commercialTrials")
    .where("id", "=", trial.id)
    .execute();
  await transaction
    .deleteFrom("facilityProfiles")
    .where("id", "=", trial.facilityId)
    .execute();

  const [remainingMembership, remainingTrial] = await Promise.all([
    transaction
      .selectFrom("facilityMemberships")
      .select("id")
      .where("userId", "=", trial.ownerUserId)
      .where("status", "in", ["active", "invited", "suspended"])
      .executeTakeFirst(),
    transaction
      .selectFrom("commercialTrials")
      .select("id")
      .where("ownerUserId", "=", trial.ownerUserId)
      .executeTakeFirst(),
  ]);
  if (remainingMembership || remainingTrial) {
    return {
      accountDeleted: false as const,
      retainedFor: ["other_active_tenant"],
    };
  }

  try {
    await deleteUserInTransaction(transaction, trial.ownerUserId);
    return { accountDeleted: true as const };
  } catch (error) {
    if (error instanceof UserDeletionBlockedError) {
      return {
        accountDeleted: false as const,
        retainedFor: error.blockers.map((blocker) => blocker.code),
      };
    }
    throw error;
  }
}

async function stageTrialAttachmentRemoval(
  transaction: Transaction<Database>,
  facilityId: string,
) {
  const classRows = await transaction
    .selectFrom("activitySessions")
    .select("id")
    .where("facilityId", "=", facilityId)
    .execute();
  const activitySessionIds = classRows.map(
    (activitySession) => activitySession.id,
  );
  const channelRows = await transaction
    .selectFrom("communityChannels")
    .select("id")
    .where((expression) =>
      expression.or([
        expression.and([
          expression("scope", "=", "facility"),
          expression("scopeId", "=", facilityId),
        ]),
        ...(activitySessionIds.length > 0
          ? [
              expression.and([
                expression("scope", "=", "class"),
                expression("scopeId", "in", activitySessionIds),
              ]),
            ]
          : []),
      ]),
    )
    .execute();
  const channelIds = channelRows.map((channel) => channel.id);
  const [supportRows, communityRows] = await Promise.all([
    transaction
      .selectFrom("supportAttachments")
      .innerJoin(
        "supportTickets",
        "supportTickets.id",
        "supportAttachments.ticketId",
      )
      .select("supportAttachments.storageKey")
      .where("supportTickets.facilityId", "=", facilityId)
      .execute(),
    channelIds.length > 0
      ? transaction
          .selectFrom("communityAttachments")
          .select("storageKey")
          .where("channelId", "in", channelIds)
          .execute()
      : Promise.resolve([]),
  ]);

  const removals: StagedFileRemoval[] = [];
  try {
    removals.push(
      await stageSupportAttachmentFilesRemoval(
        supportRows.map((attachment) => attachment.storageKey),
      ),
    );
    removals.push(
      await stageCommunityAttachmentFilesRemoval(
        communityRows.map((attachment) => attachment.storageKey),
      ),
    );
  } catch (error) {
    for (const removal of [...removals].reverse()) await removal.rollback();
    throw error;
  }
  return {
    commit: async () => {
      for (const removal of removals) await removal.commit();
    },
    rollback: async () => {
      for (const removal of [...removals].reverse()) await removal.rollback();
    },
  };
}

async function cleanupDueCommercialTrial(
  trial: { id: string; facilityId: string; subdomain: string },
  now: number,
) {
  return withCoordinatedManagerOperation(
    "account",
    "commercial",
    "cleanup-abandoned-commercial-trial",
    [`commercial-trial:${trial.facilityId}`],
    async () => {
      const environment = await stageCommercialEnvironmentRemoval(
        trial.subdomain,
      );
      let result;
      try {
        result = await db.transaction().execute(async (transaction) => {
          const current = await transaction
            .selectFrom("commercialTrials")
            .select([
              "id",
              "facilityId",
              "ownerUserId",
              "realDataDeclaration",
              "autoCleanupEligible",
              "cleanupEligibleAt",
              "status",
            ])
            .where("id", "=", trial.id)
            .executeTakeFirst();
          if (
            !current ||
            current.autoCleanupEligible !== 1 ||
            current.cleanupEligibleAt === null ||
            current.cleanupEligibleAt > now ||
            !["undeclared", "no"].includes(current.realDataDeclaration) ||
            !["trial_expired", "trial_closed"].includes(current.status)
          ) {
            return null;
          }
          const attachments = await stageTrialAttachmentRemoval(
            transaction,
            current.facilityId,
          );
          try {
            return {
              outcome: await deleteTrialTenantInTransaction(
                transaction,
                current,
              ),
              attachments,
            };
          } catch (error) {
            await attachments.rollback();
            throw error;
          }
        });
      } catch (error) {
        await environment.rollback();
        throw error;
      }
      if (result) {
        await result.attachments.commit();
        await environment.commit();
      } else {
        await environment.rollback();
      }
      return result?.outcome ?? null;
    },
  );
}

export async function evaluateDueCommercialTrialCleanups(now = Date.now()) {
  const expiredTrials = await db
    .selectFrom("commercialTrials")
    .select(["id", "autoCleanupEligible"])
    .where("status", "=", "trial_active")
    .where("expiresAt", "<=", now)
    .execute();
  for (const trial of expiredTrials) {
    await db
      .updateTable("commercialTrials")
      .set({
        status: "trial_expired",
        dataReviewRequestedAt: now,
        cleanupEligibleAt:
          trial.autoCleanupEligible === 1
            ? now + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS
            : null,
        updatedAt: now,
      })
      .where("id", "=", trial.id)
      .where("status", "=", "trial_active")
      .execute();
  }

  const dueTrials = await db
    .selectFrom("commercialTrials")
    .select([
      "id",
      "facilityId",
      "ownerUserId",
      "realDataDeclaration",
      "subdomain",
    ])
    .where("autoCleanupEligible", "=", 1)
    .where("cleanupEligibleAt", "is not", null)
    .where("cleanupEligibleAt", "<=", now)
    .where("realDataDeclaration", "in", ["undeclared", "no"])
    .where("status", "in", ["trial_expired", "trial_closed"])
    .execute();

  if (!cleanupExecutionEnabled()) {
    return {
      expired: expiredTrials.length,
      eligible: dueTrials.length,
      deletedTenants: 0,
      deletedAccounts: 0,
      retainedAccounts: 0,
      executionEnabled: false as const,
    };
  }

  let deletedTenants = 0;
  let deletedAccounts = 0;
  let retainedAccounts = 0;
  for (const trial of dueTrials) {
    let outcome;
    try {
      outcome = await cleanupDueCommercialTrial(trial, now);
    } catch (error) {
      if (error instanceof ManagerCoordinationConflictError) continue;
      throw error;
    }
    if (!outcome) continue;
    deletedTenants += 1;
    if (outcome.accountDeleted) deletedAccounts += 1;
    else retainedAccounts += 1;
  }

  return {
    expired: expiredTrials.length,
    eligible: dueTrials.length,
    deletedTenants,
    deletedAccounts,
    retainedAccounts,
    executionEnabled: true as const,
  };
}

async function expireIfNeeded(facilityId: string) {
  const trial = await db
    .selectFrom("commercialTrials")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (trial?.status === "trial_active" && trial.expiresAt <= Date.now()) {
    const now = Date.now();
    await db
      .updateTable("commercialTrials")
      .set({
        status: "trial_expired",
        dataReviewRequestedAt: now,
        cleanupEligibleAt:
          trial.autoCleanupEligible === 1
            ? now + COMMERCIAL_TRIAL_DATA_REVIEW_GRACE_MS
            : null,
        updatedAt: now,
      })
      .where("id", "=", trial.id)
      .execute();
    return { ...trial, status: "trial_expired" as const };
  }
  return trial;
}

async function createEnvironmentSummary(facilityId: string) {
  const [users, classes, bookings, waitlist, billingRecords] =
    await Promise.all([
      db
        .selectFrom("facilityMemberships")
        .innerJoin("users", "users.id", "facilityMemberships.userId")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("facilityMemberships.facilityId", "=", facilityId)
        .where("facilityMemberships.status", "=", "active")
        .where("users.accountStatus", "=", "active")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("activitySessions")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("facilityId", "=", facilityId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("bookings")
        .innerJoin(
          "activitySessions",
          "activitySessions.id",
          "bookings.activitySessionId",
        )
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("activitySessions.facilityId", "=", facilityId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("waitlistEntries")
        .innerJoin(
          "activitySessions",
          "activitySessions.id",
          "waitlistEntries.activitySessionId",
        )
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("activitySessions.facilityId", "=", facilityId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("billingRecords")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("facilityId", "=", facilityId)
        .executeTakeFirstOrThrow(),
    ]);
  return {
    users: Number(users.count),
    classes: Number(classes.count),
    bookings: Number(bookings.count),
    waitlist: Number(waitlist.count),
    billingRecords: Number(billingRecords.count),
  };
}

async function insertCommercialRequest(
  actorUserId: string,
  facilityId: string,
  kind: "commercial_contact" | "support" | "problem",
  input: CommercialRequestInput,
) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  if (!input.contactConsent)
    throw domainError("Contact consent is required", 400);

  const id = `commercial-request-${randomUUID()}`;
  const now = Date.now();
  const environmentSummary = input.includeEnvironmentSummary
    ? JSON.stringify(await createEnvironmentSummary(facilityId))
    : null;
  await db
    .insertInto("commercialRequests")
    .values({
      id,
      trialId: trial.id,
      requesterUserId: actorUserId,
      kind,
      status: "open",
      name: input.name,
      facilityName: input.facilityName,
      email: input.email,
      phone: input.phone ?? null,
      subject: input.subject ?? "",
      message: input.message,
      preferredChannel: input.preferredChannel,
      preferredTime: input.preferredTime ?? "",
      contactConsent: 1,
      includeEnvironmentSummary: input.includeEnvironmentSummary ? 1 : 0,
      environmentSummary,
      problemCategory: input.problemCategory ?? null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    })
    .execute();
  await recordEvent(trial.id, actorUserId, `${kind}_requested`, {
    requestId: id,
    preferredChannel: input.preferredChannel,
    environmentSummaryShared: Boolean(environmentSummary),
  });
  return { id, kind, status: "open" as const };
}

export async function getCommercialTrialOverview(facilityId: string) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) return null;
  const tenantOrigin = tenantOriginForSlug(trial.subdomain);
  const [counts, events, requests] = await Promise.all([
    createEnvironmentSummary(facilityId),
    db
      .selectFrom("commercialTrialEvents")
      .select(["id", "type", "metadata", "createdAt"])
      .where("trialId", "=", trial.id)
      .orderBy("createdAt", "desc")
      .limit(12)
      .execute(),
    db
      .selectFrom("commercialRequests")
      .select([
        "id",
        "kind",
        "status",
        "preferredChannel",
        "problemCategory",
        "createdAt",
        "resolvedAt",
      ])
      .where("trialId", "=", trial.id)
      .orderBy("createdAt", "desc")
      .limit(12)
      .execute(),
  ]);
  return {
    trial: serializeTrial(trial),
    environment: {
      isolation: "shared_local_demo" as const,
      routing: tenantOrigin
        ? ("tenant_subdomain" as const)
        : ("not_provisioned" as const),
      subdomainMeaning: tenantOrigin
        ? ("active_tenant_hostname" as const)
        : ("reserved_identifier" as const),
      tenantOrigin,
      counts,
      modules: [
        "bookings",
        "waitlist",
        "billing",
        "analytics",
        "account_control",
        "security",
      ],
      restorationScope: "commercial_configuration_only" as const,
      operationsLocked: trial.status === "trial_paused_support",
    },
    events: events.map((event) => ({
      ...event,
      metadata: JSON.parse(event.metadata) as Record<string, unknown>,
    })),
    requests,
  };
}

export async function requestCommercialContact(
  actorUserId: string,
  facilityId: string,
  input: CommercialRequestInput,
) {
  return insertCommercialRequest(
    actorUserId,
    facilityId,
    "commercial_contact",
    input,
  );
}

export async function createCommercialTrial(
  actorUserId: string,
  facilityId: string,
  input: TrialInput,
) {
  if (await expireIfNeeded(facilityId))
    throw domainError("A commercial trial already exists");
  const facility = await db
    .selectFrom("facilityProfiles")
    .select("slug")
    .where("id", "=", facilityId)
    .where("status", "=", "active")
    .executeTakeFirstOrThrow();
  const template = commercialTemplates[input.facilityType];
  const now = Date.now();
  const values = {
    id: `trial-${facilityId}`,
    facilityId,
    ownerUserId: actorUserId,
    facilityName: input.facilityName,
    facilityType: input.facilityType,
    // These legacy columns are no longer user-entered configuration. Current
    // centre measurements are derived from tenant data in Forge Analytics.
    approximateMembers: null,
    trainerCount: null,
    spaceCount: null,
    usualCapacity: template.usualCapacity,
    classTypes: JSON.stringify(input.classTypes ?? template.classTypes),
    scheduleNotes: input.scheduleNotes ?? "",
    locale: input.locale ?? ("es" as const),
    currency: (input.currency ?? "EUR").toUpperCase(),
    usesBookings: input.usesBookings === false ? 0 : 1,
    usesWaitlist: (input.usesWaitlist ?? template.usesWaitlist) ? 1 : 0,
    templateKey: input.facilityType,
    status: "trial_active" as const,
    subdomain: facility.slug || createTrialSubdomain(input.facilityName),
    realDataDeclaration: "undeclared" as const,
    autoCleanupEligible: 0,
    dataReviewRequestedAt: null,
    cleanupEligibleAt: null,
    conversionDraft: "[]",
    startedAt: now,
    expiresAt: now + COMMERCIAL_TRIAL_MS,
    pausedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("commercialTrials").values(values).execute();
    await trx
      .updateTable("facilityProfiles")
      .set({ name: input.facilityName, updatedAt: now })
      .where("id", "=", facilityId)
      .execute();
  });
  await recordEvent(values.id, actorUserId, "trial_created", {
    facilityType: input.facilityType,
  });
  return getCommercialTrialOverview(facilityId);
}

export async function updateCommercialTrial(
  actorUserId: string,
  facilityId: string,
  input: Partial<TrialInput>,
) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  const isPostTrialEditable =
    trial.status === "trial_expired" || trial.status === "trial_converted";
  if (trial.status !== "trial_active" && !isPostTrialEditable) {
    throw domainError(
      "This trial configuration cannot be edited",
      409,
      "COMMERCIAL_TRIAL_NOT_EDITABLE",
    );
  }

  // During the trial, edits are deliberately unlimited. Once the trial has
  // ended, this narrow per-trial window only slows sustained editor abuse; it
  // does not reserve capacity or affect another facility/tenant.
  const now = Date.now();
  if (isPostTrialEditable) {
    const editWindowMs = 10 * 60 * 1000;
    const recentUpdates = await db
      .selectFrom("commercialTrialEvents")
      .select(["createdAt", "metadata"])
      .where("trialId", "=", trial.id)
      .where("type", "=", "trial_configuration_updated")
      .where("createdAt", ">=", now - editWindowMs)
      .orderBy("createdAt", "asc")
      .execute();
    const limitedUpdates = recentUpdates.filter((event) => {
      try {
        const metadata = JSON.parse(event.metadata) as {
          editPolicy?: string;
        };
        return metadata.editPolicy === "post_trial_limited";
      } catch {
        return false;
      }
    });
    if (limitedUpdates.length >= 20) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((limitedUpdates[0].createdAt + editWindowMs - now) / 1000),
      );
      throw domainError(
        "Too many configuration edits",
        429,
        "COMMERCIAL_TRIAL_EDIT_COOLDOWN",
        retryAfterSeconds,
      );
    }
  }
  const update = {
    ...(input.facilityName !== undefined
      ? { facilityName: input.facilityName }
      : {}),
    ...(input.facilityType !== undefined
      ? { facilityType: input.facilityType, templateKey: input.facilityType }
      : {}),
    ...(input.classTypes !== undefined
      ? { classTypes: JSON.stringify(input.classTypes) }
      : {}),
    ...(input.scheduleNotes !== undefined
      ? { scheduleNotes: input.scheduleNotes }
      : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.currency !== undefined
      ? { currency: input.currency.toUpperCase() }
      : {}),
    ...(input.usesBookings !== undefined
      ? { usesBookings: input.usesBookings ? 1 : 0 }
      : {}),
    ...(input.usesWaitlist !== undefined
      ? { usesWaitlist: input.usesWaitlist ? 1 : 0 }
      : {}),
    updatedAt: now,
  };
  await db
    .updateTable("commercialTrials")
    .set(update)
    .where("id", "=", trial.id)
    .execute();
  if (input.facilityName) {
    await db
      .updateTable("facilityProfiles")
      .set({ name: input.facilityName, updatedAt: now })
      .where("id", "=", facilityId)
      .execute();
  }
  await recordEvent(trial.id, actorUserId, "trial_configuration_updated", {
    fields: Object.keys(input),
    editPolicy: isPostTrialEditable ? "post_trial_limited" : "trial_unlimited",
  });
  return getCommercialTrialOverview(facilityId);
}

export async function restoreCommercialTrialConfiguration(
  actorUserId: string,
  facilityId: string,
) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  if (trial.status !== "trial_active")
    throw domainError("Only an active trial can be restored");
  const template = commercialTemplates[trial.facilityType];
  await db
    .updateTable("commercialTrials")
    .set({
      usualCapacity: template.usualCapacity,
      classTypes: JSON.stringify(template.classTypes),
      usesBookings: 1,
      usesWaitlist: template.usesWaitlist ? 1 : 0,
      scheduleNotes: "",
      updatedAt: Date.now(),
    })
    .where("id", "=", trial.id)
    .execute();
  await recordEvent(
    trial.id,
    actorUserId,
    "commercial_configuration_restored",
    {
      templateKey: trial.templateKey,
      scope: "commercial_configuration_only",
    },
  );
  return getCommercialTrialOverview(facilityId);
}

export async function declareCommercialTrialData(
  actorUserId: string,
  facilityId: string,
  decision: Exclude<RealDataDeclaration, "undeclared">,
) {
  return withCoordinatedManagerOperation(
    "account",
    "commercial",
    "declare-commercial-trial-data",
    [`commercial-trial:${facilityId}`],
    async () => {
      const trial = await expireIfNeeded(facilityId);
      if (!trial) throw domainError("Commercial trial not found", 404);
      if (trial.status !== "trial_active" && trial.status !== "trial_expired") {
        throw domainError("This trial cannot enter another data review");
      }
      const now = Date.now();
      const status =
        decision === "yes"
          ? ("trial_conversion_review" as const)
          : decision === "assistance"
            ? ("trial_paused_support" as const)
            : ("trial_closed" as const);
      await db
        .updateTable("commercialTrials")
        .set({
          realDataDeclaration: decision,
          conversionDraft:
            decision === "yes"
              ? JSON.stringify(createConversionDraft())
              : trial.conversionDraft,
          status,
          pausedAt: decision === "no" ? null : now,
          closedAt: decision === "no" ? now : trial.closedAt,
          dataReviewRequestedAt: trial.dataReviewRequestedAt ?? now,
          cleanupEligibleAt:
            decision === "no" && trial.autoCleanupEligible === 1 ? now : null,
          updatedAt: now,
        })
        .where("id", "=", trial.id)
        .execute();
      await recordEvent(trial.id, actorUserId, "real_data_declared", {
        decision,
      });
      return getCommercialTrialOverview(facilityId);
    },
  );
}

export async function getCommercialConversionDraft(facilityId: string) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  if (trial.realDataDeclaration !== "yes") {
    throw domainError("Real data must be declared before classification");
  }
  return {
    mode: "classification_only" as const,
    conversionExecuted: false,
    items: JSON.parse(trial.conversionDraft) as ConversionDraftItem[],
  };
}

export async function updateCommercialConversionDraft(
  actorUserId: string,
  facilityId: string,
  category: ConversionCategory,
  origin: ConversionOrigin,
  decision: ConversionDecision,
) {
  const current = await getCommercialConversionDraft(facilityId);
  const items = current.items.map((item) =>
    item.category === category ? { ...item, origin, decision } : item,
  );
  if (!current.items.some((item) => item.category === category)) {
    throw domainError("Conversion category not found", 404);
  }
  await db
    .updateTable("commercialTrials")
    .set({ conversionDraft: JSON.stringify(items), updatedAt: Date.now() })
    .where("facilityId", "=", facilityId)
    .execute();
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  await recordEvent(trial.id, actorUserId, "conversion_draft_updated", {
    category,
    origin,
    decision,
  });
  return { ...current, items };
}

export async function closeCommercialTrial(
  actorUserId: string,
  facilityId: string,
) {
  const trial = await expireIfNeeded(facilityId);
  if (!trial) throw domainError("Commercial trial not found", 404);
  if (trial.realDataDeclaration !== "no") {
    throw domainError(
      "Confirm that the environment contains no real data before closing it",
    );
  }
  const now = Date.now();
  await db
    .updateTable("commercialTrials")
    .set({
      status: "trial_closed",
      closedAt: now,
      dataReviewRequestedAt: trial.dataReviewRequestedAt ?? now,
      cleanupEligibleAt: trial.autoCleanupEligible === 1 ? now : null,
      updatedAt: now,
    })
    .where("id", "=", trial.id)
    .execute();
  await recordEvent(trial.id, actorUserId, "trial_closed");
  return getCommercialTrialOverview(facilityId);
}

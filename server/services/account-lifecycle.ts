import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import {
  ACCOUNT_DATA_CATEGORIES,
  getAccountDispositionPreview,
  type AccountDataCategory,
} from "./data-retention.js";
import { recordSecurityEvent } from "./security-events.js";
import {
  publishManagerSignal,
  withCoordinatedManagerOperation,
} from "./manager-coordinator.js";
import { getAccountContinuityBridge } from "./account-continuity.js";
import {
  queueAccountDeletionPreparationEmail,
  queueAccountInactivityReviewEmail,
} from "./email-delivery.js";
import { hashPassword } from "./auth.js";
import {
  deleteUserInTransaction,
  inspectUserDeletionBlockers,
} from "./users.js";
import { stageCommunityAttachmentFilesRemoval } from "./community-attachments.js";
import { stageE2eeAttachmentFilesRemoval } from "./e2ee-attachments.js";
import type { Transaction } from "kysely";
import type { Database } from "../db/types.js";
import type { StagedFileRemoval } from "../lib/staged-file-removal.js";
import { getAccountDeletionConfirmation } from "./account-deletion-confirmation.js";

export const INACTIVITY_DELETION_OPTIONS = [6, 12, 18, 24, 36] as const;
export type InactivityDeletionMonths =
  (typeof INACTIVITY_DELETION_OPTIONS)[number];

const DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_INACTIVITY_REVIEW_MONTHS = 6;
export const INACTIVITY_REVIEW_RESPONSE_MS = 14 * 24 * 60 * 60 * 1000;
export const INACTIVITY_REVIEW_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

type InactivityReviewStage = "awaiting_usage_confirmation" | "confirm_deletion";
export type InactivityReviewState =
  | {
      status: "none";
      stage: null;
      deliveredAt: null;
      responseDueAt: null;
    }
  | {
      status: "pending";
      stage: InactivityReviewStage;
      deliveredAt: number;
      responseDueAt: number | null;
    };

type InactivityReviewMetadata = {
  deliveryId?: string;
  reviewDeliveryId?: string;
  answer?: string;
  stage?: string;
  reminder?: boolean;
};

export const MEANINGFUL_ACTIVITY_SOURCES = [
  "login_success",
  "booking_created",
  "booking_cancelled",
  "personal_account_action",
  "authenticated_tool_use",
  "user_initiated_payment",
  "account_configuration_changed",
  "account_recovery_completed",
] as const;
export type MeaningfulActivitySource =
  (typeof MEANINGFUL_ACTIVITY_SOURCES)[number];

export const ACCOUNT_LIFECYCLE_STATES = [
  "pending_verification",
  "active",
  "security_review",
  "recovery_in_progress",
  "inactive",
  "suspended_pending_deletion",
  "deletion_cancelled",
  "closure_requested",
  "deletion_processing",
  "retained_legal",
  "legal_hold",
  "anonymized",
  "deleted",
] as const;
export type AccountLifecycleState = (typeof ACCOUNT_LIFECYCLE_STATES)[number];

function addUtcMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.getTime();
}

function requestId(): string {
  return `deletion-${randomBytes(12).toString("hex")}`;
}

function deletionJobId(): string {
  return `deletion-job-${randomBytes(12).toString("hex")}`;
}

function lifecycleRequestError(
  message: string,
  code: string,
  statusCode = 409,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function parseEventMetadata(value: string): InactivityReviewMetadata {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as InactivityReviewMetadata)
      : {};
  } catch {
    return {};
  }
}

function clientUrl(pathname: string, search?: Record<string, string>): string {
  const configured = process.env.CLIENT_ORIGIN?.split(",")[0]?.trim();
  if (configured) {
    const origin = new URL(configured);
    const url = new URL(pathname, origin);
    for (const [key, value] of Object.entries(search ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CLIENT_ORIGIN is required for account lifecycle email");
  }
  const url = new URL(pathname, "http://127.0.0.1:3000");
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function latestInactivityReviewEvents(userId: string) {
  const rows = await db
    .selectFrom("securityEvents")
    .select(["type", "createdAt", "metadata"])
    .where("userId", "=", userId)
    .where("type", "in", [
      "account_inactivity_review_queued",
      "account_inactivity_review_delivered",
      "account_inactivity_review_answered",
      "account_inactivity_review_reminder_queued",
    ])
    .orderBy("createdAt", "desc")
    .limit(30)
    .execute();
  return rows.map((row) => ({
    ...row,
    parsed: parseEventMetadata(row.metadata),
  }));
}

async function getInactivityReviewState(
  userId: string,
): Promise<InactivityReviewState> {
  const events = await latestInactivityReviewEvents(userId);
  const delivered = events.find(
    (event) =>
      event.type === "account_inactivity_review_delivered" &&
      !event.parsed.reminder,
  );
  if (!delivered) {
    return {
      status: "none",
      stage: null,
      deliveredAt: null,
      responseDueAt: null,
    };
  }
  const reviewId =
    delivered.parsed.reviewDeliveryId ?? delivered.parsed.deliveryId;
  const answer = events.find(
    (event) =>
      event.type === "account_inactivity_review_answered" &&
      event.createdAt >= delivered.createdAt &&
      event.parsed.reviewDeliveryId === reviewId,
  );
  if (answer?.parsed.answer === "not_using") {
    return {
      status: "pending",
      stage: "confirm_deletion",
      deliveredAt: delivered.createdAt,
      responseDueAt: null,
    };
  }
  if (answer) {
    return {
      status: "none",
      stage: null,
      deliveredAt: null,
      responseDueAt: null,
    };
  }
  return {
    status: "pending",
    stage: "awaiting_usage_confirmation",
    deliveredAt: delivered.createdAt,
    responseDueAt: delivered.createdAt + INACTIVITY_REVIEW_RESPONSE_MS,
  };
}

export async function getAccountLifecycle(userId: string) {
  const [preference, request, deletionJob, dataDisposition, user] =
    await Promise.all([
      db
        .selectFrom("accountDeletionPreferences")
        .selectAll()
        .where("userId", "=", userId)
        .executeTakeFirst(),
      db
        .selectFrom("accountDeletionRequests")
        .select(["id", "trigger", "status", "requestedAt", "graceEndsAt"])
        .where("userId", "=", userId)
        .where("status", "=", "scheduled")
        .executeTakeFirst(),
      db
        .selectFrom("accountDeletionJobs")
        .select(["id", "status", "executionEnabled", "createdAt", "updatedAt"])
        .where("userId", "=", userId)
        .where("status", "in", ["planned", "blocked_retention_review"])
        .orderBy("updatedAt", "desc")
        .executeTakeFirst(),
      getAccountDispositionPreview(userId),
      db
        .selectFrom("users")
        .select(["createdAt", "accountStatus"])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow(),
    ]);

  const currentState: AccountLifecycleState = request
    ? request.trigger === "inactivity"
      ? "suspended_pending_deletion"
      : "closure_requested"
    : user.accountStatus;

  const lastMeaningfulActivityAt =
    preference?.lastMeaningfulActivityAt ?? user.createdAt;
  return {
    currentState,
    supportedStates: ACCOUNT_LIFECYCLE_STATES,
    inactivityMonths: preference?.inactivityMonths ?? null,
    lastMeaningfulActivityAt,
    inactivityReview: await getInactivityReviewState(userId),
    deletionRequest: request ?? null,
    deletionJob: deletionJob
      ? { ...deletionJob, executionEnabled: deletionJob.executionEnabled === 1 }
      : null,
    gracePeriodDays: 30,
    dataDisposition,
    continuityBridge: await getAccountContinuityBridge(userId),
  };
}

export async function updateInactivityDeletionPreference(
  userId: string,
  inactivityMonths: InactivityDeletionMonths | null,
) {
  const now = Date.now();
  await db
    .insertInto("accountDeletionPreferences")
    .values({
      userId,
      inactivityMonths,
      lastMeaningfulActivityAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        inactivityMonths,
        lastMeaningfulActivityAt: now,
        updatedAt: now,
      }),
    )
    .execute();
  await recordSecurityEvent("deletion_preference_updated", userId, {
    inactivityMonths: inactivityMonths ?? "disabled",
  });
  return getAccountLifecycle(userId);
}

export async function markMeaningfulAccountActivity(
  userId: string,
  source: MeaningfulActivitySource,
  occurredAt = Date.now(),
): Promise<void> {
  if (!MEANINGFUL_ACTIVITY_SOURCES.includes(source)) {
    throw new Error("Invalid meaningful account activity source");
  }
  const commercialIdentity = await db
    .selectFrom("users")
    .select("id")
    .where("id", "=", userId)
    .where("identityRealm", "=", "commercial")
    .executeTakeFirst();
  if (!commercialIdentity) return;
  await db
    .insertInto("accountDeletionPreferences")
    .values({
      userId,
      inactivityMonths: null,
      lastMeaningfulActivityAt: occurredAt,
      updatedAt: occurredAt,
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        lastMeaningfulActivityAt: occurredAt,
        updatedAt: occurredAt,
      }),
    )
    .execute();
}

export async function hasScheduledAccountDeletion(
  userId: string,
): Promise<boolean> {
  const request = await db
    .selectFrom("accountDeletionRequests")
    .select("id")
    .where("userId", "=", userId)
    .where("status", "=", "scheduled")
    .executeTakeFirst();
  return Boolean(request);
}

export async function evaluateDueInactivityDeletions(
  now = Date.now(),
): Promise<{ evaluated: number; scheduled: number }> {
  const preferences = await db
    .selectFrom("accountDeletionPreferences")
    .innerJoin("users", "users.id", "accountDeletionPreferences.userId")
    .select(["userId", "inactivityMonths", "lastMeaningfulActivityAt"])
    .where("users.identityRealm", "=", "commercial")
    .where("inactivityMonths", "is not", null)
    .execute();
  let scheduled = 0;
  for (const preference of preferences) {
    if (
      preference.inactivityMonths !== null &&
      addUtcMonths(
        preference.lastMeaningfulActivityAt,
        preference.inactivityMonths,
      ) <= now
    ) {
      const before = await db
        .selectFrom("accountDeletionRequests")
        .select("id")
        .where("userId", "=", preference.userId)
        .where("status", "=", "scheduled")
        .executeTakeFirst();
      if (!before) {
        await scheduleAccountDeletion(preference.userId, "inactivity", now);
        scheduled += 1;
      }
    }
  }
  return { evaluated: preferences.length, scheduled };
}

export async function evaluateUnconfiguredInactivityReviews(
  now = Date.now(),
): Promise<{
  evaluated: number;
  queued: number;
  reminders: number;
  scheduled: number;
}> {
  const candidates = await db
    .selectFrom("users")
    .where("users.identityRealm", "=", "commercial")
    .leftJoin(
      "accountDeletionPreferences",
      "accountDeletionPreferences.userId",
      "users.id",
    )
    .select([
      "users.id as userId",
      "users.email",
      "users.name",
      "users.locale",
      "users.createdAt",
      "users.emailVerifiedAt",
      "accountDeletionPreferences.inactivityMonths",
      "accountDeletionPreferences.lastMeaningfulActivityAt",
    ])
    .where("users.accountStatus", "=", "active")
    .where("users.emailVerifiedAt", "is not", null)
    .where("accountDeletionPreferences.inactivityMonths", "is", null)
    .execute();
  let queued = 0;
  let reminders = 0;
  let scheduled = 0;

  for (const candidate of candidates) {
    const lastActivity =
      candidate.lastMeaningfulActivityAt ?? candidate.createdAt;
    if (addUtcMonths(lastActivity, DEFAULT_INACTIVITY_REVIEW_MONTHS) > now) {
      continue;
    }
    if (await hasScheduledAccountDeletion(candidate.userId)) continue;

    const state = await getInactivityReviewState(candidate.userId);
    const events = await latestInactivityReviewEvents(candidate.userId);
    const delivered = events.find(
      (event) =>
        event.type === "account_inactivity_review_delivered" &&
        !event.parsed.reminder &&
        event.createdAt >= lastActivity,
    );
    const reviewDeliveryId =
      delivered?.parsed.reviewDeliveryId ?? delivered?.parsed.deliveryId;

    if (state.status === "pending") {
      if (
        state.stage === "awaiting_usage_confirmation" &&
        lastActivity > state.deliveredAt &&
        reviewDeliveryId
      ) {
        await recordSecurityEvent(
          "account_inactivity_review_answered",
          candidate.userId,
          {
            reviewDeliveryId,
            stage: "usage",
            answer: "still_using",
            source: "meaningful_activity_observed",
          },
        );
        continue;
      }
      if (
        state.stage === "awaiting_usage_confirmation" &&
        state.responseDueAt !== null &&
        state.responseDueAt <= now
      ) {
        await scheduleAccountDeletion(candidate.userId, "inactivity", now);
        scheduled += 1;
        continue;
      }
      if (
        state.stage === "awaiting_usage_confirmation" &&
        reviewDeliveryId &&
        state.deliveredAt + INACTIVITY_REVIEW_REMINDER_MS <= now
      ) {
        const reminderExists = events.some(
          (event) =>
            event.type === "account_inactivity_review_reminder_queued" &&
            event.parsed.reviewDeliveryId === reviewDeliveryId,
        );
        if (!reminderExists) {
          const reminderDeliveryId = await queueAccountInactivityReviewEmail({
            userId: candidate.userId,
            email: candidate.email,
            name: candidate.name,
            locale: normalizedLocale(candidate.locale),
            actionUrl: clientUrl("/account/lifecycle"),
            reminder: true,
            reviewDeliveryId,
          });
          await recordSecurityEvent(
            "account_inactivity_review_reminder_queued",
            candidate.userId,
            { reviewDeliveryId, deliveryId: reminderDeliveryId },
          );
          reminders += 1;
        }
      }
      continue;
    }

    const queuedEvent = events.find(
      (event) =>
        event.type === "account_inactivity_review_queued" &&
        event.createdAt >= lastActivity,
    );
    if (queuedEvent?.parsed.deliveryId) {
      const delivery = await db
        .selectFrom("emailDeliveries")
        .select("status")
        .where("id", "=", queuedEvent.parsed.deliveryId)
        .executeTakeFirst();
      if (delivery) continue;
    }

    const deliveryId = await queueAccountInactivityReviewEmail({
      userId: candidate.userId,
      email: candidate.email,
      name: candidate.name,
      locale: normalizedLocale(candidate.locale),
      actionUrl: clientUrl("/account/lifecycle"),
    });
    await recordSecurityEvent(
      "account_inactivity_review_queued",
      candidate.userId,
      { deliveryId },
    );
    queued += 1;
  }

  return { evaluated: candidates.length, queued, reminders, scheduled };
}

function normalizedLocale(value: string): "es" | "en" | "de" | "de-CH" {
  return value === "en" || value === "de" || value === "de-CH" ? value : "es";
}

export async function answerInactivityReview(
  userId: string,
  input: {
    stage: "usage" | "deletion";
    answer: "yes" | "no";
    keepSessionId?: string;
  },
) {
  const preference = await db
    .selectFrom("accountDeletionPreferences")
    .select(["inactivityMonths", "lastMeaningfulActivityAt"])
    .where("userId", "=", userId)
    .executeTakeFirst();
  const user = await db
    .selectFrom("users")
    .select("createdAt")
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  const lastActivity = preference?.lastMeaningfulActivityAt ?? user.createdAt;
  if (preference?.inactivityMonths !== null && preference !== undefined) {
    throw lifecycleRequestError(
      "No unconfigured inactivity review is pending",
      "INACTIVITY_REVIEW_NOT_PENDING",
    );
  }
  const state = await getInactivityReviewState(userId);
  const expectedStage =
    input.stage === "usage"
      ? "awaiting_usage_confirmation"
      : "confirm_deletion";
  if (state.status !== "pending" || state.stage !== expectedStage) {
    throw lifecycleRequestError(
      "No matching inactivity review is pending",
      "INACTIVITY_REVIEW_NOT_PENDING",
    );
  }
  const events = await latestInactivityReviewEvents(userId);
  const delivered = events.find(
    (event) =>
      event.type === "account_inactivity_review_delivered" &&
      !event.parsed.reminder &&
      event.createdAt >= lastActivity,
  );
  const reviewDeliveryId =
    delivered?.parsed.reviewDeliveryId ?? delivered?.parsed.deliveryId;
  if (!reviewDeliveryId) {
    throw lifecycleRequestError(
      "The inactivity review delivery could not be verified",
      "INACTIVITY_REVIEW_DELIVERY_UNCONFIRMED",
    );
  }

  const answer =
    input.stage === "usage"
      ? input.answer === "yes"
        ? "still_using"
        : "not_using"
      : input.answer === "yes"
        ? "delete_confirmed"
        : "keep_account";
  await recordSecurityEvent("account_inactivity_review_answered", userId, {
    reviewDeliveryId,
    stage: input.stage,
    answer,
  });
  if (answer === "still_using" || answer === "keep_account") {
    await markMeaningfulAccountActivity(
      userId,
      "personal_account_action",
      Date.now(),
    );
  } else if (answer === "delete_confirmed") {
    await scheduleAccountDeletion(userId, "inactivity", Date.now(), {
      keepSessionId: input.keepSessionId,
    });
  }
  return getAccountLifecycle(userId);
}

export async function scheduleAccountDeletion(
  userId: string,
  trigger: "manual" | "inactivity",
  requestedAt = Date.now(),
  options: { keepSessionId?: string } = {},
) {
  return withCoordinatedManagerOperation(
    "account",
    "commercial",
    "schedule-account-deletion",
    ["account-records"],
    async () => {
      const commercialIdentity = await db
        .selectFrom("users")
        .select("id")
        .where("id", "=", userId)
        .where("identityRealm", "=", "commercial")
        .executeTakeFirst();
      if (!commercialIdentity) {
        throw new Error(
          "Commercial account deletion requires a commercial identity",
        );
      }
      const existing = await db
        .selectFrom("accountDeletionRequests")
        .selectAll()
        .where("userId", "=", userId)
        .where("status", "=", "scheduled")
        .executeTakeFirst();
      if (existing) return getAccountLifecycle(userId);

      const now = requestedAt;
      const newRequestId = requestId();
      const result = await db.transaction().execute(async (transaction) => {
        const insertResult = await transaction
          .insertInto("accountDeletionRequests")
          .values({
            id: newRequestId,
            userId,
            trigger,
            status: "scheduled",
            requestedAt: now,
            graceEndsAt: now + DELETION_GRACE_PERIOD_MS,
            cancelledAt: null,
            completedAt: null,
          })
          .onConflict((conflict) => conflict.doNothing())
          .executeTakeFirst();
        if (Number(insertResult.numInsertedOrUpdatedRows) > 0) {
          await transaction
            .insertInto("accountDeletionJobs")
            .values({
              id: deletionJobId(),
              requestId: newRequestId,
              userId,
              status: "planned",
              executionEnabled: 1,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            })
            .execute();
        }
        return insertResult;
      });
      if (Number(result.numInsertedOrUpdatedRows) > 0) {
        await recordSecurityEvent("account_deletion_scheduled", userId, {
          trigger,
        });
        const user = await db
          .selectFrom("users")
          .select(["email", "name", "locale"])
          .where("id", "=", userId)
          .executeTakeFirstOrThrow();
        try {
          const plannedCleanup = await inspectTransientAccountSecrets(
            userId,
            options.keepSessionId,
          );
          const deliveryId = await queueAccountDeletionPreparationEmail({
            userId,
            email: user.email,
            name: user.name,
            locale: normalizedLocale(user.locale),
            graceEndsAt: now + DELETION_GRACE_PERIOD_MS,
            accountUrl: clientUrl("/account/lifecycle"),
            loginUrl: clientUrl("/login"),
            recoveryUrl: clientUrl("/recover-account"),
            feedbackUrl: clientUrl("/feedback", {
              context: "account-closure",
            }),
            ...plannedCleanup,
          });
          let cleanup;
          try {
            cleanup = await revokeTransientAccountSecrets(
              userId,
              options.keepSessionId,
            );
          } catch (error) {
            await db
              .updateTable("emailDeliveries")
              .set({
                status: "superseded",
                recipient: "",
                payloadEncrypted: "",
                updatedAt: Date.now(),
              })
              .where("id", "=", deliveryId)
              .where("status", "in", ["queued", "retry", "processing"])
              .execute();
            throw error;
          }
          await recordSecurityEvent(
            "account_deletion_preparation_notified",
            userId,
            {
              deliveryId,
              ...cleanup,
            },
          );
        } catch {
          publishManagerSignal(
            "email",
            "commercial",
            "warning",
            "ACCOUNT_DELETION_PREPARATION_NOTICE_FAILED",
            "An account closure was scheduled, but its preparation notice could not be queued.",
          );
        }
      }
      return getAccountLifecycle(userId);
    },
  );
}

export async function revokeTransientAccountSecrets(
  userId: string,
  keepSessionId?: string,
): Promise<{
  revokedOtherSessions: boolean;
  removedTemporaryChallenges: boolean;
}> {
  return db.transaction().execute(async (transaction) => {
    const emailVerification = await transaction
      .deleteFrom("emailVerificationChallenges")
      .where("userId", "=", userId)
      .executeTakeFirst();
    const recovery = await transaction
      .deleteFrom("accountRecoveryChallenges")
      .where("userId", "=", userId)
      .executeTakeFirst();
    const deletionConfirmation = await transaction
      .deleteFrom("accountDeletionChallenges")
      .where("userId", "=", userId)
      .executeTakeFirst();
    const auth = await transaction
      .deleteFrom("authChallenges")
      .where("userId", "=", userId)
      .executeTakeFirst();
    const webauthn = await transaction
      .deleteFrom("webauthnChallenges")
      .where("userId", "=", userId)
      .executeTakeFirst();
    let sessions = transaction
      .deleteFrom("sessions")
      .where("userId", "=", userId);
    if (keepSessionId) sessions = sessions.where("id", "!=", keepSessionId);
    const removedSessions = await sessions.executeTakeFirst();
    return {
      revokedOtherSessions: Number(removedSessions.numDeletedRows) > 0,
      removedTemporaryChallenges:
        Number(emailVerification.numDeletedRows) +
          Number(recovery.numDeletedRows) +
          Number(deletionConfirmation.numDeletedRows) +
          Number(auth.numDeletedRows) +
          Number(webauthn.numDeletedRows) >
        0,
    };
  });
}

async function inspectTransientAccountSecrets(
  userId: string,
  keepSessionId?: string,
): Promise<{
  revokedOtherSessions: boolean;
  removedTemporaryChallenges: boolean;
}> {
  const [
    emailVerification,
    recovery,
    deletionConfirmation,
    auth,
    webauthn,
    sessionRows,
  ] = await Promise.all([
    db
      .selectFrom("emailVerificationChallenges")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("accountRecoveryChallenges")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("accountDeletionChallenges")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("authChallenges")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("webauthnChallenges")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("sessions")
      .select("id")
      .where("userId", "=", userId)
      .execute(),
  ]);
  return {
    revokedOtherSessions: sessionRows.some(
      (session) => !keepSessionId || session.id !== keepSessionId,
    ),
    removedTemporaryChallenges:
      Number(emailVerification.count) +
        Number(recovery.count) +
        Number(deletionConfirmation.count) +
        Number(auth.count) +
        Number(webauthn.count) >
      0,
  };
}

async function destroyAccountAccessSecrets(
  transaction: Transaction<Database>,
  userId: string,
  unusablePassword: string,
): Promise<void> {
  await transaction
    .updateTable("users")
    .set({ accountStatus: "security_review", password: unusablePassword })
    .where("id", "=", userId)
    .execute();
  await transaction
    .deleteFrom("sessions")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("emailVerificationChallenges")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("accountRecoveryChallenges")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("accountDeletionChallenges")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("authChallenges")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("webauthnChallenges")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("mfaCredentials")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("passkeyCredentials")
    .where("userId", "=", userId)
    .execute();
  await transaction
    .deleteFrom("emailDeliveries")
    .where("userId", "=", userId)
    .execute();
}

async function stageAccountAttachmentRemoval(
  transaction: Transaction<Database>,
  userId: string,
) {
  const [community, e2ee] = await Promise.all([
    transaction
      .selectFrom("communityAttachments")
      .select("storageKey")
      .where("uploadedByUserId", "=", userId)
      .execute(),
    transaction
      .selectFrom("e2eeAttachments")
      .select("storageKey")
      .where((expression) =>
        expression.or([
          expression("senderUserId", "=", userId),
          expression("recipientUserId", "=", userId),
        ]),
      )
      .execute(),
  ]);
  const removals: StagedFileRemoval[] = [];
  try {
    removals.push(
      await stageCommunityAttachmentFilesRemoval(
        community.map((item) => item.storageKey),
      ),
    );
    removals.push(
      await stageE2eeAttachmentFilesRemoval(
        e2ee.map((item) => item.storageKey),
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

export async function executeDueAccountDeletionJobs(
  now = Date.now(),
): Promise<{ evaluated: number; completed: number; blocked: number }> {
  const due = await db
    .selectFrom("accountDeletionJobs")
    .innerJoin(
      "accountDeletionRequests",
      "accountDeletionRequests.id",
      "accountDeletionJobs.requestId",
    )
    .innerJoin("users", "users.id", "accountDeletionJobs.userId")
    .select([
      "accountDeletionJobs.id as jobId",
      "accountDeletionJobs.userId",
      "accountDeletionRequests.id as requestId",
    ])
    .where("accountDeletionJobs.executionEnabled", "=", 1)
    .where("accountDeletionJobs.status", "in", [
      "planned",
      "blocked_retention_review",
    ])
    .where("accountDeletionRequests.status", "=", "scheduled")
    .where("accountDeletionRequests.graceEndsAt", "<=", now)
    .where("users.identityRealm", "=", "commercial")
    .execute();
  let completed = 0;
  let blocked = 0;

  for (const item of due) {
    await withCoordinatedManagerOperation(
      "account",
      "commercial",
      "execute-account-deletion",
      [`account:${item.userId}`],
      async () => {
        const preflight = await db
          .transaction()
          .execute(async (transaction) => {
            const [retained, ownerMembership, blockers] = await Promise.all([
              transaction
                .selectFrom("dataRetentionRecords")
                .select(({ fn }) => fn.countAll<number>().as("count"))
                .where("userId", "=", item.userId)
                .where("status", "in", ["retained", "legal_hold"])
                .executeTakeFirstOrThrow(),
              transaction
                .selectFrom("facilityMemberships")
                .select("id")
                .where("userId", "=", item.userId)
                .where("role", "=", "owner")
                .where("status", "in", ["active", "invited", "suspended"])
                .executeTakeFirst(),
              inspectUserDeletionBlockers(transaction, item.userId),
            ]);
            return {
              retained: Number(retained.count),
              ownerMembership: Boolean(ownerMembership),
              blockers,
            };
          });
        if (
          preflight.retained > 0 ||
          preflight.ownerMembership ||
          preflight.blockers.length > 0
        ) {
          await db
            .updateTable("accountDeletionJobs")
            .set({ status: "blocked_retention_review", updatedAt: now })
            .where("id", "=", item.jobId)
            .execute();
          publishManagerSignal(
            "account",
            "commercial",
            "warning",
            "ACCOUNT_DELETION_REVIEW_REQUIRED",
            "An expired account closure requires retention or tenant ownership review.",
          );
          blocked += 1;
          return;
        }

        const staged = await db
          .transaction()
          .execute((transaction) =>
            stageAccountAttachmentRemoval(transaction, item.userId),
          );
        const unusablePassword = await hashPassword(
          randomBytes(48).toString("base64url"),
        );
        try {
          await db.transaction().execute(async (transaction) => {
            const [retained, ownerMembership, blockers] = await Promise.all([
              transaction
                .selectFrom("dataRetentionRecords")
                .select(({ fn }) => fn.countAll<number>().as("count"))
                .where("userId", "=", item.userId)
                .where("status", "in", ["retained", "legal_hold"])
                .executeTakeFirstOrThrow(),
              transaction
                .selectFrom("facilityMemberships")
                .select("id")
                .where("userId", "=", item.userId)
                .where("role", "=", "owner")
                .where("status", "in", ["active", "invited", "suspended"])
                .executeTakeFirst(),
              inspectUserDeletionBlockers(transaction, item.userId),
            ]);
            if (
              Number(retained.count) > 0 ||
              ownerMembership ||
              blockers.length > 0
            ) {
              throw new Error("ACCOUNT_DELETION_REVIEW_REQUIRED");
            }
            await destroyAccountAccessSecrets(
              transaction,
              item.userId,
              unusablePassword,
            );
            await deleteUserInTransaction(transaction, item.userId);
          });
          await staged.commit();
        } catch (error) {
          await staged.rollback();
          if (
            error instanceof Error &&
            error.message === "ACCOUNT_DELETION_REVIEW_REQUIRED"
          ) {
            await db
              .updateTable("accountDeletionJobs")
              .set({ status: "blocked_retention_review", updatedAt: now })
              .where("id", "=", item.jobId)
              .execute();
            blocked += 1;
            return;
          }
          throw error;
        }
        await recordSecurityEvent("account_deletion_completed", null, {
          requestId: item.requestId,
          physicallyDeleted: true,
        });
        completed += 1;
      },
    );
  }
  return { evaluated: due.length, completed, blocked };
}

export async function cancelScheduledAccountDeletion(
  userId: string,
  options: { recoveryEvent?: string } = {},
) {
  return withCoordinatedManagerOperation(
    "account",
    "commercial",
    "cancel-account-deletion",
    ["account-records"],
    async () => {
      const now = Date.now();
      const result = await db
        .updateTable("accountDeletionRequests")
        .set({ status: "cancelled", cancelledAt: now })
        .where("userId", "=", userId)
        .where("status", "=", "scheduled")
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) > 0) {
        await db
          .updateTable("accountDeletionJobs")
          .set({ status: "cancelled", updatedAt: now })
          .where("userId", "=", userId)
          .where("status", "in", ["planned", "blocked_retention_review"])
          .execute();
        await markMeaningfulAccountActivity(
          userId,
          options.recoveryEvent
            ? "account_recovery_completed"
            : "personal_account_action",
          now,
        );
        await recordSecurityEvent("account_deletion_cancelled", userId);
      }
      return getAccountLifecycle(userId);
    },
  );
}

export async function getDataDeletionReview(userId: string) {
  const now = Date.now();
  const [
    lifecycle,
    draft,
    affectedBookings,
    activeSessionRows,
    sessionSettings,
    affectedDelegations,
    confirmation,
  ] = await Promise.all([
    getAccountLifecycle(userId),
    db
      .selectFrom("accountDataDeletionDrafts")
      .select(["selectedCategories", "intent", "updatedAt"])
      .where("userId", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("bookings")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("userId", "=", userId)
      .where("status", "!=", "cancelled")
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("sessions")
      .select("lastSeenAt")
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .where("expiresAt", ">", now)
      .execute(),
    db
      .selectFrom("users")
      .select("sessionIdleTimeoutMinutes")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("delegationGrants")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where((expression) =>
        expression.or([
          expression("ownerUserId", "=", userId),
          expression("delegateUserId", "=", userId),
        ]),
      )
      .where("revokedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("expiresAt", "is", null),
          expression("expiresAt", ">", now),
        ]),
      )
      .executeTakeFirstOrThrow(),
    getAccountDeletionConfirmation(userId),
  ]);

  let selectedCategories: AccountDataCategory[] = [];
  if (draft) {
    try {
      const parsed = JSON.parse(draft.selectedCategories) as unknown;
      if (Array.isArray(parsed)) {
        selectedCategories = parsed.filter(
          (category): category is AccountDataCategory =>
            typeof category === "string" &&
            ACCOUNT_DATA_CATEGORIES.includes(category as AccountDataCategory),
        );
      }
    } catch {
      selectedCategories = [];
    }
  }

  return {
    ...lifecycle,
    accountEmail: confirmation.user.email,
    confirmationMethod: confirmation.method,
    passwordRequired: confirmation.passwordAvailable,
    mfaRequired: confirmation.mfaRequired,
    emailCodeRequired: confirmation.emailCodeRequired,
    emailCodeAvailable: confirmation.emailAvailable,
    deletionDraft: draft
      ? {
          selectedCategories,
          intent: draft.intent,
          updatedAt: draft.updatedAt,
        }
      : null,
    legalRetentionNoticeRequired: true,
    closureImpact: {
      reservationsAffected: Number(affectedBookings.count),
      activeSessions: activeSessionRows.filter(
        (session) =>
          session.lastSeenAt +
            sessionSettings.sessionIdleTimeoutMinutes * 60 * 1000 >
          now,
      ).length,
      delegationGrantsAffected: Number(affectedDelegations.count),
      dataExportStatus: "planned" as const,
      executionEnabled: true as const,
    },
  };
}

export async function saveDataDeletionReview(
  userId: string,
  selectedCategories: AccountDataCategory[],
  intent: "selected_data" | "account_closure",
) {
  const normalizedCategories = [
    ...new Set(
      selectedCategories.filter((category) =>
        ACCOUNT_DATA_CATEGORIES.includes(category),
      ),
    ),
  ];
  if (intent === "selected_data" && normalizedCategories.length === 0) {
    throw lifecycleRequestError(
      "Select at least one data category",
      "DATA_CATEGORY_REQUIRED",
      400,
    );
  }

  const now = Date.now();
  await db
    .insertInto("accountDataDeletionDrafts")
    .values({
      userId,
      selectedCategories: JSON.stringify(normalizedCategories),
      intent,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        selectedCategories: JSON.stringify(normalizedCategories),
        intent,
        updatedAt: now,
      }),
    )
    .execute();
  await recordSecurityEvent("account_data_deletion_draft_updated", userId, {
    intent,
    categoryCount: normalizedCategories.length,
  });
  return getDataDeletionReview(userId);
}

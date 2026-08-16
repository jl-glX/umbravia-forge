import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { BookingAnalyticsEventType, Database } from "../db/types.js";

interface RecordBookingAnalyticsEventInput {
  bookingId: string;
  eventType: Exclude<BookingAnalyticsEventType, "baseline_import">;
  fromState: string | null;
  toState: string;
  occurredAt: number;
}

/**
 * Records an operational snapshot in the same transaction as the booking
 * transition. The event contains no contact details or free-form metadata.
 */
export async function recordBookingAnalyticsEvent(
  transaction: Transaction<Database>,
  input: RecordBookingAnalyticsEventInput,
): Promise<void> {
  const snapshot = await transaction
    .selectFrom("bookings")
    .innerJoin(
      "activitySessions",
      "activitySessions.id",
      "bookings.activitySessionId",
    )
    .leftJoin(
      "users as trainerUsers",
      "trainerUsers.id",
      "activitySessions.trainerId",
    )
    .select([
      "bookings.id",
      "bookings.activitySessionId",
      "bookings.userId",
      "activitySessions.facilityId",
      "trainerUsers.id as trainerUserId",
      "activitySessions.name as activityName",
      "activitySessions.scheduledAt",
      "activitySessions.maxCapacity as capacitySnapshot",
    ])
    .where("bookings.id", "=", input.bookingId)
    .executeTakeFirstOrThrow();

  const deduplicationKey = [
    "live",
    input.bookingId,
    input.eventType,
    input.fromState ?? "none",
    input.toState,
    input.occurredAt,
  ].join(":");

  await transaction
    .insertInto("bookingAnalyticsEvents")
    .values({
      id: `booking-analytics-${randomUUID()}`,
      deduplicationKey,
      facilityId: snapshot.facilityId,
      bookingId: snapshot.id,
      activitySessionId: snapshot.activitySessionId,
      memberUserId: snapshot.userId,
      trainerUserId: snapshot.trainerUserId,
      eventType: input.eventType,
      source: "live",
      fromState: input.fromState,
      toState: input.toState,
      activityName: snapshot.activityName,
      scheduledAt: snapshot.scheduledAt,
      capacitySnapshot: snapshot.capacitySnapshot,
      occurredAt: input.occurredAt,
      recordedAt: Date.now(),
    })
    .onConflict((conflict) => conflict.column("deduplicationKey").doNothing())
    .execute();
}

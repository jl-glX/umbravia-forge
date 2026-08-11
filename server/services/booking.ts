import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { db } from "../db/client.js";
import type {
  AttendanceIntention,
  BookingLifecycleStatus,
  Database,
} from "../db/types.js";
import {
  calculateWaitlistPriority,
  ensureBookingReputation,
  recordBookingReputationEvent,
} from "./booking-reputation.js";
import { parseBookingConfiguration } from "../lib/booking-configuration.js";
import { PRIMARY_FACILITY_ID } from "./facility-context.js";

const DEFAULT_PROMOTION_CONFIRMATION_MINUTES = 15;

async function getConfiguration(
  transaction: Transaction<Database>,
  classId: string,
) {
  const row = await transaction
    .selectFrom("classBookingConfigurations")
    .select("configuration")
    .where("classId", "=", classId)
    .executeTakeFirst();
  return parseBookingConfiguration(row?.configuration);
}

async function assertBookingEligibility(
  transaction: Transaction<Database>,
  userId: string,
  configuration: ReturnType<typeof parseBookingConfiguration>,
  now: number,
) {
  const user = await transaction
    .selectFrom("users")
    .select("role")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user) throw new Error("User not found");
  if (
    configuration.allowedRoles.length > 0 &&
    !configuration.allowedRoles.includes(user.role)
  ) {
    throw new Error("User role is not eligible for this class");
  }
  if (configuration.bookingOpensAt && configuration.bookingOpensAt > now) {
    throw new Error("Booking is not open yet");
  }
  if (configuration.bookingClosesAt && configuration.bookingClosesAt <= now) {
    throw new Error("Booking is already closed");
  }
  return user;
}

async function createLifecycle(
  transaction: Transaction<Database>,
  bookingId: string,
  lifecycleStatus: BookingLifecycleStatus,
  now: number,
) {
  await transaction
    .insertInto("bookingLifecycles")
    .values({
      bookingId,
      lifecycleStatus,
      attendanceIntention: "unanswered",
      intentionUpdatedAt: null,
      confirmedAt: lifecycleStatus === "confirmed" ? now : null,
      lastReminderAt: null,
      reminderCount: 0,
      updatedAt: now,
    })
    .execute();
}

async function releaseExpiredPromotions(
  transaction: Transaction<Database>,
  classId: string,
  now: number,
) {
  const expired = await transaction
    .selectFrom("waitlistEntries")
    .select(["id", "userId"])
    .where("classId", "=", classId)
    .where("promotedAt", "is not", null)
    .where("promotionExpiresAt", "is not", null)
    .where("promotionExpiresAt", "<=", now)
    .execute();

  for (const entry of expired) {
    const booking = await transaction
      .selectFrom("bookings")
      .select("id")
      .where("classId", "=", classId)
      .where("userId", "=", entry.userId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    if (booking) {
      await transaction
        .updateTable("bookings")
        .set({ status: "cancelled", cancelledAt: now })
        .where("id", "=", booking.id)
        .execute();
      await transaction
        .updateTable("bookingLifecycles")
        .set({ lifecycleStatus: "promotion_expired", updatedAt: now })
        .where("bookingId", "=", booking.id)
        .execute();
    }
    await transaction
      .deleteFrom("waitlistEntries")
      .where("id", "=", entry.id)
      .execute();
  }
  return expired.length;
}

async function promoteFromWaitlist(
  transaction: Transaction<Database>,
  classId: string,
  now = Date.now(),
) {
  const gymClass = await transaction
    .selectFrom("gymClasses")
    .select("facilityId")
    .where("id", "=", classId)
    .executeTakeFirst();
  if (!gymClass) return null;

  const entries = await transaction
    .selectFrom("waitlistEntries")
    .innerJoin("users", "waitlistEntries.userId", "users.id")
    .select([
      "waitlistEntries.id",
      "waitlistEntries.classId",
      "waitlistEntries.userId",
      "waitlistEntries.position",
      "waitlistEntries.createdAt",
      "waitlistEntries.promotedAt",
      "waitlistEntries.promotionExpiresAt",
      "users.role",
    ])
    .where("classId", "=", classId)
    .where("promotedAt", "is", null)
    .execute();
  if (entries.length === 0) return null;

  const configuration = await getConfiguration(transaction, classId);
  const eligibleEntries = entries.filter(
    (entry) =>
      configuration.allowedRoles.length === 0 ||
      configuration.allowedRoles.includes(entry.role),
  );
  if (eligibleEntries.length === 0) return null;
  const candidates = await Promise.all(
    eligibleEntries.map(async (entry) => {
      const reputation = await ensureBookingReputation(
        transaction,
        entry.userId,
        gymClass.facilityId,
      );
      return {
        entry,
        priority: calculateWaitlistPriority({
          score: reputation.score,
          penaltyUntil: reputation.penaltyUntil,
          createdAt: entry.createdAt,
          now,
        }),
      };
    }),
  );
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.entry.position - b.entry.position ||
      a.entry.createdAt - b.entry.createdAt,
  );
  const promotionExpiresAt =
    now +
    (configuration.promotionConfirmationMinutes ??
      DEFAULT_PROMOTION_CONFIRMATION_MINUTES) *
      60_000;

  for (const candidate of candidates) {
    const selected = candidate.entry;
    const claimed = await transaction
      .updateTable("waitlistEntries")
      .set({ promotedAt: now, promotionExpiresAt })
      .where("id", "=", selected.id)
      .where("promotedAt", "is", null)
      .executeTakeFirst();
    if (Number(claimed.numUpdatedRows) === 0) continue;

    const promotedBooking = await transaction
      .selectFrom("bookings")
      .select("id")
      .where("classId", "=", classId)
      .where("userId", "=", selected.userId)
      .where("status", "=", "waitlist")
      .executeTakeFirst();
    if (!promotedBooking) {
      await transaction
        .deleteFrom("waitlistEntries")
        .where("id", "=", selected.id)
        .execute();
      continue;
    }
    const bookingUpdate = await transaction
      .updateTable("bookings")
      .set({ status: "confirmed" })
      .where("id", "=", promotedBooking.id)
      .where("status", "=", "waitlist")
      .executeTakeFirst();
    if (Number(bookingUpdate.numUpdatedRows) === 0) {
      await transaction
        .deleteFrom("waitlistEntries")
        .where("id", "=", selected.id)
        .execute();
      continue;
    }
    await transaction
      .updateTable("bookingLifecycles")
      .set({
        lifecycleStatus: "promoted",
        attendanceIntention: "unanswered",
        intentionUpdatedAt: null,
        confirmedAt: null,
        updatedAt: now,
      })
      .where("bookingId", "=", promotedBooking.id)
      .execute();
    await normalizeWaitlistPositions(transaction, classId);
    return { bookingId: promotedBooking.id, promotionExpiresAt };
  }
  await normalizeWaitlistPositions(transaction, classId);
  return null;
}

async function fillAvailablePlacesFromWaitlist(
  transaction: Transaction<Database>,
  classId: string,
  now = Date.now(),
) {
  await releaseExpiredPromotions(transaction, classId, now);
  const gymClass = await transaction
    .selectFrom("gymClasses")
    .select("maxCapacity")
    .where("id", "=", classId)
    .executeTakeFirst();
  if (!gymClass) return [];
  const confirmed = await transaction
    .selectFrom("bookings")
    .select((eb) => eb.fn.count("id").as("count"))
    .where("classId", "=", classId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();
  const available = Math.max(
    0,
    gymClass.maxCapacity - Number(confirmed?.count ?? 0),
  );
  const promotions = [];
  for (let index = 0; index < available; index += 1) {
    const promoted = await promoteFromWaitlist(transaction, classId, now);
    if (!promoted) break;
    promotions.push(promoted);
  }
  return promotions;
}

async function hasReputationEventForClass(
  transaction: Transaction<Database>,
  userId: string,
  classId: string,
  type: "cancelled_on_time" | "uncertain",
) {
  return Boolean(
    await transaction
      .selectFrom("bookingReputationEvents")
      .innerJoin("bookings", "bookingReputationEvents.bookingId", "bookings.id")
      .select("bookingReputationEvents.id")
      .where("bookingReputationEvents.userId", "=", userId)
      .where("bookingReputationEvents.type", "=", type)
      .where("bookings.classId", "=", classId)
      .executeTakeFirst(),
  );
}

async function normalizeWaitlistPositions(
  transaction: Transaction<Database>,
  classId: string,
) {
  const remaining = await transaction
    .selectFrom("waitlistEntries")
    .select(["id", "position"])
    .where("classId", "=", classId)
    .where("promotedAt", "is", null)
    .orderBy("position", "asc")
    .execute();
  for (let index = 0; index < remaining.length; index += 1) {
    await transaction
      .updateTable("waitlistEntries")
      .set({ position: index + 1 })
      .where("id", "=", remaining[index].id)
      .execute();
  }
}

async function cancelBookingInTransaction(
  transaction: Transaction<Database>,
  bookingId: string,
  userId: string,
  now: number,
) {
  const booking = await transaction
    .selectFrom("bookings")
    .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
    .select([
      "bookings.id",
      "bookings.classId",
      "bookings.status",
      "gymClasses.facilityId",
      "gymClasses.scheduledAt",
    ])
    .where("bookings.id", "=", bookingId)
    .where("bookings.userId", "=", userId)
    .executeTakeFirst();
  if (!booking) throw new Error("Booking not found or not owned by user");
  if (booking.status === "cancelled")
    throw new Error("Booking already cancelled");
  if (booking.scheduledAt <= now)
    throw new Error("The class has already started");

  const configuration = await getConfiguration(transaction, booking.classId);
  const cancellationNoticeMinutes = (booking.scheduledAt - now) / 60_000;
  const cancellationType =
    booking.status === "waitlist" ||
    cancellationNoticeMinutes >= configuration.onTimeCancellationMinutes
      ? "cancelled_on_time"
      : cancellationNoticeMinutes <= configuration.lateCancellationMinutes
        ? "cancelled_late"
        : "cancelled_neutral";
  const lifecycleStatus: BookingLifecycleStatus = cancellationType;

  await transaction
    .updateTable("bookings")
    .set({ status: "cancelled", cancelledAt: now })
    .where("id", "=", bookingId)
    .execute();
  await transaction
    .updateTable("bookingLifecycles")
    .set({
      lifecycleStatus,
      attendanceIntention: "no",
      intentionUpdatedAt: now,
      updatedAt: now,
    })
    .where("bookingId", "=", bookingId)
    .execute();

  if (booking.status === "waitlist") {
    await transaction
      .deleteFrom("waitlistEntries")
      .where("classId", "=", booking.classId)
      .where("userId", "=", userId)
      .execute();
    await normalizeWaitlistPositions(transaction, booking.classId);
  } else {
    await transaction
      .deleteFrom("waitlistEntries")
      .where("classId", "=", booking.classId)
      .where("userId", "=", userId)
      .execute();
    const alreadyRewarded =
      cancellationType === "cancelled_on_time" &&
      (await hasReputationEventForClass(
        transaction,
        userId,
        booking.classId,
        "cancelled_on_time",
      ));
    await recordBookingReputationEvent(transaction, {
      userId,
      facilityId: booking.facilityId,
      bookingId,
      type: cancellationType,
      pointsDelta: alreadyRewarded ? 0 : undefined,
      reason:
        cancellationType === "cancelled_late"
          ? "Cancelación comunicada dentro del periodo tardío configurado."
          : cancellationType === "cancelled_neutral"
            ? "Cancelación comunicada antes del periodo tardío, pero sin la antelación necesaria para recuperar prioridad."
            : alreadyRewarded
              ? "Cancelación comunicada a tiempo; la recuperación ya se había aplicado anteriormente para esta clase."
              : "Cancelación comunicada con antelación suficiente.",
      now,
    });
    await fillAvailablePlacesFromWaitlist(transaction, booking.classId, now);
  }
  return { lifecycleStatus };
}

export async function getClassWithAvailability(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
) {
  let gymClass = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!gymClass) return null;

  await db.transaction().execute(async (transaction) => {
    await fillAvailablePlacesFromWaitlist(transaction, classId, Date.now());
  });
  gymClass = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!gymClass) return null;

  const [confirmedCount, waitlistCount] = await Promise.all([
    db
      .selectFrom("bookings")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("classId", "=", classId)
      .where("status", "=", "confirmed")
      .executeTakeFirst(),
    db
      .selectFrom("waitlistEntries")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("classId", "=", classId)
      .where("promotedAt", "is", null)
      .executeTakeFirst(),
  ]);
  const bookedCount = Number(confirmedCount?.count ?? 0);
  return {
    ...gymClass,
    bookedCount,
    availablePlaces: Math.max(0, gymClass.maxCapacity - bookedCount),
    waitlistCount: Number(waitlistCount?.count ?? 0),
  };
}

export async function bookClass(
  classId: string,
  userId: string,
  facilityId = PRIMARY_FACILITY_ID,
) {
  return db.transaction().execute(async (transaction) => {
    const now = Date.now();
    const gymClass = await transaction
      .selectFrom("gymClasses")
      .select(["id", "maxCapacity", "scheduledAt"])
      .where("id", "=", classId)
      .where("facilityId", "=", facilityId)
      .executeTakeFirst();
    if (!gymClass) throw new Error("Class not found");
    if (gymClass.scheduledAt <= now)
      throw new Error("Class has already started");

    const membership = await transaction
      .selectFrom("facilityMemberships")
      .select("id")
      .where("facilityId", "=", facilityId)
      .where("userId", "=", userId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!membership) throw new Error("Active facility membership required");

    await fillAvailablePlacesFromWaitlist(transaction, classId, now);

    const existingBooking = await transaction
      .selectFrom("bookings")
      .select("id")
      .where("classId", "=", classId)
      .where("userId", "=", userId)
      .where("status", "!=", "cancelled")
      .executeTakeFirst();
    if (existingBooking)
      throw new Error("User already has a booking for this class");

    const configuration = await getConfiguration(transaction, classId);
    await assertBookingEligibility(transaction, userId, configuration, now);
    const confirmedCount = await transaction
      .selectFrom("bookings")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("classId", "=", classId)
      .where("status", "=", "confirmed")
      .executeTakeFirst();
    const bookingId = `booking-${randomUUID()}`;

    if (Number(confirmedCount?.count ?? 0) < gymClass.maxCapacity) {
      await transaction
        .insertInto("bookings")
        .values({
          id: bookingId,
          classId,
          userId,
          status: "confirmed",
          createdAt: now,
          cancelledAt: null,
        })
        .execute();
      await createLifecycle(
        transaction,
        bookingId,
        configuration.confirmationRequired
          ? "confirmation_pending"
          : "confirmed",
        now,
      );
      return { bookingId, status: "confirmed" as const };
    }
    if (!configuration.waitlistEnabled)
      throw new Error("Class is full and the waitlist is disabled");

    const waitlistCount = await transaction
      .selectFrom("waitlistEntries")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("classId", "=", classId)
      .where("promotedAt", "is", null)
      .executeTakeFirst();
    const position = Number(waitlistCount?.count ?? 0) + 1;
    await transaction
      .insertInto("waitlistEntries")
      .values({
        id: `waitlist-${randomUUID()}`,
        classId,
        userId,
        position,
        createdAt: now,
        promotedAt: null,
        promotionExpiresAt: null,
      })
      .execute();
    await transaction
      .insertInto("bookings")
      .values({
        id: bookingId,
        classId,
        userId,
        status: "waitlist",
        createdAt: now,
        cancelledAt: null,
      })
      .execute();
    await createLifecycle(transaction, bookingId, "waitlisted", now);
    return { bookingId, status: "waitlist" as const, position };
  });
}

export async function cancelBooking(bookingId: string, userId: string) {
  return db
    .transaction()
    .execute((transaction) =>
      cancelBookingInTransaction(transaction, bookingId, userId, Date.now()),
    );
}

export async function setAttendanceIntention(
  bookingId: string,
  userId: string,
  intention: Exclude<AttendanceIntention, "unanswered">,
) {
  const result = await db.transaction().execute(async (transaction) => {
    const now = Date.now();
    const booking = await transaction
      .selectFrom("bookings")
      .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
      .leftJoin(
        "bookingLifecycles",
        "bookings.id",
        "bookingLifecycles.bookingId",
      )
      .leftJoin("waitlistEntries", (join) =>
        join
          .onRef("waitlistEntries.classId", "=", "bookings.classId")
          .onRef("waitlistEntries.userId", "=", "bookings.userId"),
      )
      .select([
        "bookings.id",
        "bookings.classId",
        "bookings.status",
        "gymClasses.facilityId",
        "gymClasses.scheduledAt",
        "bookingLifecycles.attendanceIntention",
        "bookingLifecycles.lifecycleStatus",
        "waitlistEntries.promotionExpiresAt",
      ])
      .where("bookings.id", "=", bookingId)
      .where("bookings.userId", "=", userId)
      .executeTakeFirst();
    if (!booking || booking.status === "cancelled")
      throw new Error("Active booking not found");
    if (booking.status !== "confirmed")
      throw new Error("Attendance intention requires a confirmed booking");
    if (booking.scheduledAt <= now)
      throw new Error("The class has already started");
    if (
      booking.lifecycleStatus === "promoted" &&
      (booking.promotionExpiresAt ?? 0) <= now
    ) {
      await fillAvailablePlacesFromWaitlist(transaction, booking.classId, now);
      return { expired: true as const };
    }
    if (intention === "no") {
      const cancellation = await cancelBookingInTransaction(
        transaction,
        bookingId,
        userId,
        now,
      );
      return {
        expired: false as const,
        ...cancellation,
        attendanceIntention: "no" as const,
      };
    }

    const lifecycleStatus: BookingLifecycleStatus =
      intention === "yes" ? "confirmed" : "uncertain";
    await transaction
      .updateTable("bookingLifecycles")
      .set({
        lifecycleStatus,
        attendanceIntention: intention,
        intentionUpdatedAt: now,
        confirmedAt: intention === "yes" ? now : null,
        updatedAt: now,
      })
      .where("bookingId", "=", bookingId)
      .execute();
    if (intention === "yes" && booking.lifecycleStatus === "promoted") {
      await transaction
        .deleteFrom("waitlistEntries")
        .where("classId", "=", booking.classId)
        .where("userId", "=", userId)
        .execute();
      await normalizeWaitlistPositions(transaction, booking.classId);
    }
    if (
      intention === "uncertain" &&
      booking.attendanceIntention !== "uncertain" &&
      !(await hasReputationEventForClass(
        transaction,
        userId,
        booking.classId,
        "uncertain",
      ))
    ) {
      await recordBookingReputationEvent(transaction, {
        userId,
        facilityId: booking.facilityId,
        bookingId,
        type: "uncertain",
        reason: "La persona indicó que todavía no conoce su asistencia.",
        now,
      });
    }
    return {
      expired: false as const,
      lifecycleStatus,
      attendanceIntention: intention,
    };
  });
  if (result.expired) {
    throw new Error("The promotion confirmation deadline has expired");
  }
  const { expired: _expired, ...response } = result;
  return response;
}

export async function recordBookingReminder(bookingId: string) {
  return db.transaction().execute(async (transaction) => {
    const now = Date.now();
    const booking = await transaction
      .selectFrom("bookings")
      .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
      .leftJoin(
        "bookingLifecycles",
        "bookings.id",
        "bookingLifecycles.bookingId",
      )
      .leftJoin("waitlistEntries", (join) =>
        join
          .onRef("waitlistEntries.classId", "=", "bookings.classId")
          .onRef("waitlistEntries.userId", "=", "bookings.userId"),
      )
      .select([
        "bookings.classId",
        "bookings.status",
        "gymClasses.scheduledAt",
        "bookingLifecycles.attendanceIntention",
        "bookingLifecycles.lastReminderAt",
        "bookingLifecycles.lifecycleStatus",
        "waitlistEntries.promotionExpiresAt",
      ])
      .where("bookings.id", "=", bookingId)
      .executeTakeFirst();
    if (!booking || booking.status !== "confirmed") {
      throw new Error("Active booking not found");
    }
    if (
      booking.lifecycleStatus === "promoted" &&
      (booking.promotionExpiresAt ?? 0) <= now
    ) {
      throw new Error("The promotion confirmation deadline has expired");
    }
    const configuration = await getConfiguration(transaction, booking.classId);
    if (!configuration.remindersEnabled) {
      throw new Error("Reminders are disabled for this class");
    }
    if (booking.scheduledAt <= now) {
      throw new Error("The class has already started");
    }
    if (
      booking.attendanceIntention === "yes" ||
      booking.attendanceIntention === "no"
    ) {
      throw new Error("This booking does not need another reminder");
    }
    if ((booking.lastReminderAt ?? 0) > now - 30 * 60_000) {
      throw new Error("A reminder was recorded recently");
    }
    await transaction
      .updateTable("bookingLifecycles")
      .set((eb) => ({
        lastReminderAt: now,
        reminderCount: eb("reminderCount", "+", 1),
        updatedAt: now,
      }))
      .where("bookingId", "=", bookingId)
      .execute();
    return { recordedAt: now };
  });
}

export async function markBookingAttendance(
  bookingId: string,
  status: "attended" | "absent" | "excused",
) {
  return db.transaction().execute(async (transaction) => {
    const now = Date.now();
    const booking = await transaction
      .selectFrom("bookings")
      .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
      .leftJoin(
        "bookingLifecycles",
        "bookings.id",
        "bookingLifecycles.bookingId",
      )
      .select([
        "bookings.userId",
        "bookings.status",
        "gymClasses.facilityId",
        "gymClasses.scheduledAt",
        "bookingLifecycles.lifecycleStatus",
        "bookingLifecycles.attendanceIntention",
      ])
      .where("bookings.id", "=", bookingId)
      .executeTakeFirst();
    if (!booking || booking.status !== "confirmed")
      throw new Error("Active booking not found");
    if (booking.scheduledAt > now) {
      throw new Error("Attendance cannot be recorded before the class starts");
    }
    const correctingAcceptedJustification =
      booking.lifecycleStatus === "absent" && status === "excused";
    if (
      ["attended", "absent", "excused"].includes(
        booking.lifecycleStatus ?? "",
      ) &&
      !correctingAcceptedJustification
    ) {
      throw new Error("Attendance has already been recorded");
    }
    await transaction
      .updateTable("bookingLifecycles")
      .set({ lifecycleStatus: status, updatedAt: now })
      .where("bookingId", "=", bookingId)
      .execute();
    await recordBookingReputationEvent(transaction, {
      userId: booking.userId,
      facilityId: booking.facilityId,
      bookingId,
      type: status,
      reason: correctingAcceptedJustification
        ? "El centro aceptó posteriormente una justificación y revirtió la penalización de la ausencia."
        : status === "excused"
          ? "El centro aceptó una justificación sin conservar detalles sensibles."
          : status === "attended"
            ? "Asistencia registrada por el centro."
            : "Ausencia registrada por el centro.",
      now,
    });
    if (status === "attended" && booking.attendanceIntention === "yes") {
      await recordBookingReputationEvent(transaction, {
        userId: booking.userId,
        facilityId: booking.facilityId,
        bookingId,
        type: "confirmed_attended",
        reason: "La confirmación de asistencia se cumplió.",
        now,
      });
    }
    return { lifecycleStatus: status };
  });
}

export async function getUserBookings(
  userId: string,
  facilityId = PRIMARY_FACILITY_ID,
) {
  const rows = await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
    .leftJoin("bookingLifecycles", "bookings.id", "bookingLifecycles.bookingId")
    .leftJoin("waitlistEntries", (join) =>
      join
        .onRef("waitlistEntries.classId", "=", "bookings.classId")
        .onRef("waitlistEntries.userId", "=", "bookings.userId"),
    )
    .select([
      "bookings.id",
      "bookings.classId",
      "bookings.status",
      "bookings.createdAt",
      "gymClasses.name",
      "gymClasses.scheduledAt",
      "gymClasses.trainerName",
      "bookingLifecycles.lifecycleStatus",
      "bookingLifecycles.attendanceIntention",
      "bookingLifecycles.lastReminderAt",
      "bookingLifecycles.reminderCount",
      "waitlistEntries.position as waitlistPosition",
      "waitlistEntries.promotionExpiresAt",
    ])
    .where("bookings.userId", "=", userId)
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.status", "!=", "cancelled")
    .orderBy("gymClasses.scheduledAt", "asc")
    .execute();
  const now = Date.now();
  return Promise.all(
    rows.map(async (row) => {
      let waitlistPosition = row.waitlistPosition;
      if (row.status === "waitlist") {
        const ordered = await getClassWaitlist(row.classId, facilityId);
        const dynamicIndex = ordered.findIndex(
          (entry) => entry.userId === userId,
        );
        waitlistPosition = dynamicIndex < 0 ? null : dynamicIndex + 1;
      }
      return {
        ...row,
        waitlistPosition,
        lifecycleStatus:
          row.lifecycleStatus ??
          (row.status === "waitlist" ? "waitlisted" : "confirmation_pending"),
        attendanceIntention: row.attendanceIntention ?? "unanswered",
        reminderDue:
          row.scheduledAt > now &&
          row.scheduledAt - now <= 24 * 60 * 60 * 1_000 &&
          !["yes", "no"].includes(row.attendanceIntention ?? "unanswered"),
      };
    }),
  );
}

export async function getClassBookings(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
) {
  return db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
    .innerJoin("users", "bookings.userId", "users.id")
    .leftJoin("bookingLifecycles", "bookings.id", "bookingLifecycles.bookingId")
    .select([
      "bookings.id",
      "bookings.userId",
      "bookings.status",
      "users.name",
      "users.email",
      "bookingLifecycles.lifecycleStatus",
      "bookingLifecycles.attendanceIntention",
    ])
    .where("bookings.classId", "=", classId)
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.status", "=", "confirmed")
    .orderBy("bookings.createdAt", "asc")
    .execute();
}

export async function getClassWaitlist(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
) {
  const entries = await db
    .selectFrom("waitlistEntries")
    .innerJoin("gymClasses", "waitlistEntries.classId", "gymClasses.id")
    .innerJoin("users", "waitlistEntries.userId", "users.id")
    .leftJoin("bookingReputations", (join) =>
      join
        .onRef("bookingReputations.userId", "=", "waitlistEntries.userId")
        .onRef("bookingReputations.facilityId", "=", "gymClasses.facilityId"),
    )
    .select([
      "waitlistEntries.id",
      "waitlistEntries.userId",
      "waitlistEntries.position",
      "waitlistEntries.createdAt",
      "users.name",
      "users.email",
      "bookingReputations.score",
      "bookingReputations.penaltyUntil",
    ])
    .where("waitlistEntries.classId", "=", classId)
    .where("gymClasses.facilityId", "=", facilityId)
    .where("waitlistEntries.promotedAt", "is", null)
    .execute();
  const ordered = entries
    .map((entry) => ({
      ...entry,
      dynamicPriority: calculateWaitlistPriority({
        score: entry.score ?? 100,
        penaltyUntil: entry.penaltyUntil,
        createdAt: entry.createdAt,
      }),
    }))
    .sort(
      (a, b) =>
        b.dynamicPriority - a.dynamicPriority || a.position - b.position,
    );
  return ordered.map((entry, index) => ({
    ...entry,
    originalPosition: entry.position,
    position: index + 1,
  }));
}

export async function exportClassAttendeesCsv(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
): Promise<string> {
  const gymClass = await db
    .selectFrom("gymClasses")
    .select("id")
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!gymClass) throw new Error("Class not found");
  const attendees = await getClassBookings(classId, facilityId);
  const waitlist = await getClassWaitlist(classId, facilityId);
  const rows = ['"Name","Email","Status","Waitlist Position"'];
  attendees.forEach((attendee) =>
    rows.push(
      `"${escapeCsvCell(attendee.name)}","${escapeCsvCell(attendee.email)}","Confirmed",""`,
    ),
  );
  waitlist.forEach((entry) =>
    rows.push(
      `"${escapeCsvCell(entry.name)}","${escapeCsvCell(entry.email)}","Waitlist","${entry.position}"`,
    ),
  );
  return rows.join("\n");
}

function escapeCsvCell(value: string): string {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return safeValue.replace(/"/g, '""');
}

import { db } from "../db/client.js";
import { randomBytes } from "crypto";
import {
  defaultBookingConfiguration,
  parseBookingConfiguration,
  type BookingConfiguration,
} from "../lib/booking-configuration.js";

export interface ClassWithAvailability {
  id: string;
  facilityId: string;
  name: string;
  description: string;
  trainerId: string;
  trainerName: string;
  maxCapacity: number;
  scheduledAt: number;
  bookedCount: number;
  availablePlaces: number;
  waitlistCount: number;
  bookingConfiguration: BookingConfiguration;
  lifecycleState: "active" | "suspended" | "cancelled";
  seriesId: string | null;
}

export interface ClassDeletionBlockers {
  bookings: number;
  waitlistEntries: number;
  sessionContent: number;
  sessionProgress: number;
  communityChannels: number;
}

export class ClassDeletionBlockedError extends Error {
  readonly code = "CLASS_DELETION_REQUIRES_REVIEW";

  constructor(readonly blockers: ClassDeletionBlockers) {
    super("Class deletion requires review because related activity exists");
    this.name = "ClassDeletionBlockedError";
  }
}

export async function createClassSeries(
  data: {
    name: string;
    description: string;
    trainerId: string;
    trainerName: string;
    maxCapacity: number;
    occurrences: number[];
    bookingOpensMinutesBefore: number | null;
  },
  facilityId: string,
): Promise<ClassWithAvailability[]> {
  const occurrences = [...new Set(data.occurrences)].sort((a, b) => a - b);
  if (
    !data.name ||
    !data.trainerId ||
    !data.maxCapacity ||
    occurrences.length < 1
  ) {
    throw new Error("Missing required fields");
  }
  if (occurrences.length > 31) {
    throw new Error("A class series cannot contain more than 31 sessions");
  }
  if (data.maxCapacity < 1) {
    throw new Error("Max capacity must be at least 1");
  }
  const now = Date.now();
  if (occurrences.some((scheduledAt) => scheduledAt <= now)) {
    throw new Error("All class dates must be in the future");
  }
  if (
    data.bookingOpensMinutesBefore !== null &&
    (!Number.isSafeInteger(data.bookingOpensMinutesBefore) ||
      data.bookingOpensMinutesBefore < 0 ||
      data.bookingOpensMinutesBefore > 525_600)
  ) {
    throw new Error("Invalid booking opening lead time");
  }

  const seriesId =
    occurrences.length > 1 ? `series-${randomBytes(8).toString("hex")}` : null;
  const ids = occurrences.map(() => `class-${randomBytes(8).toString("hex")}`);

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("activitySessions")
      .values(
        occurrences.map((scheduledAt, index) => ({
          id: ids[index],
          facilityId,
          name: data.name,
          description: data.description || "",
          trainerId: data.trainerId,
          trainerName: data.trainerName,
          maxCapacity: data.maxCapacity,
          scheduledAt,
        })),
      )
      .execute();

    if (data.bookingOpensMinutesBefore !== null || seriesId) {
      await transaction
        .insertInto("activitySessionBookingConfigurations")
        .values(
          occurrences.map((scheduledAt, index) => ({
            activitySessionId: ids[index],
            configuration: JSON.stringify({
              ...defaultBookingConfiguration,
              bookingOpensAt:
                data.bookingOpensMinutesBefore === null
                  ? null
                  : scheduledAt - data.bookingOpensMinutesBefore * 60_000,
            }),
            lifecycleState: "active" as const,
            seriesId,
            updatedAt: now,
          })),
        )
        .execute();
    }
  });

  const created = await Promise.all(
    ids.map((id) => getClassWithAvailability(id, facilityId)),
  );
  if (created.some((activitySession) => activitySession === null)) {
    throw new Error("Failed to retrieve created classes");
  }
  return created as ClassWithAvailability[];
}

export async function saveActivitySessionBookingConfiguration(
  activitySessionId: string,
  input: {
    configuration: Partial<BookingConfiguration>;
    lifecycleState?: "active" | "suspended" | "cancelled";
    seriesId?: string | null;
  },
  facilityId: string,
) {
  const activitySession = await db
    .selectFrom("activitySessions")
    .select("id")
    .where("id", "=", activitySessionId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!activitySession) throw new Error("Class not found");

  const existing = await db
    .selectFrom("activitySessionBookingConfigurations")
    .selectAll()
    .where("activitySessionId", "=", activitySessionId)
    .executeTakeFirst();
  const configuration = {
    ...defaultBookingConfiguration,
    ...parseBookingConfiguration(existing?.configuration),
    ...input.configuration,
  };
  if (
    configuration.lateCancellationMinutes >
    configuration.onTimeCancellationMinutes
  ) {
    throw new Error(
      "The late cancellation window cannot exceed the on-time cancellation window",
    );
  }
  if (
    configuration.lateCancellationMinutes >
    configuration.onTimeCancellationMinutes
  ) {
    throw new Error(
      "The late cancellation window cannot exceed the on-time cancellation window",
    );
  }
  await db
    .insertInto("activitySessionBookingConfigurations")
    .values({
      activitySessionId,
      configuration: JSON.stringify(configuration),
      lifecycleState:
        input.lifecycleState ?? existing?.lifecycleState ?? "active",
      seriesId: input.seriesId ?? existing?.seriesId ?? null,
      updatedAt: Date.now(),
    })
    .onConflict((conflict) =>
      conflict.column("activitySessionId").doUpdateSet({
        configuration: JSON.stringify(configuration),
        lifecycleState:
          input.lifecycleState ?? existing?.lifecycleState ?? "active",
        seriesId: input.seriesId ?? existing?.seriesId ?? null,
        updatedAt: Date.now(),
      }),
    )
    .execute();
  return getClassWithAvailability(activitySessionId, facilityId);
}

export async function getAllClasses(
  facilityId: string,
): Promise<ClassWithAvailability[]> {
  const classes = await db
    .selectFrom("activitySessions")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .orderBy("scheduledAt", "asc")
    .execute();

  const withAvailability = await Promise.all(
    classes.map(async (activitySession) => {
      return getClassWithAvailability(activitySession.id, facilityId);
    }),
  );

  return withAvailability.filter((c) => c !== null) as ClassWithAvailability[];
}

export async function getClassWithAvailability(
  activitySessionId: string,
  facilityId: string,
): Promise<ClassWithAvailability | null> {
  const activitySession = await db
    .selectFrom("activitySessions")
    .selectAll()
    .where("id", "=", activitySessionId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!activitySession) {
    return null;
  }

  const confirmedCount = await db
    .selectFrom("bookings")
    .select((eb) => eb.fn.count("id").as("count"))
    .where("activitySessionId", "=", activitySessionId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();

  const bookedCount = Number(confirmedCount?.count ?? 0);
  const availablePlaces = activitySession.maxCapacity - bookedCount;
  const waitlistCount = await db
    .selectFrom("waitlistEntries")
    .select((eb) => eb.fn.count("id").as("count"))
    .where("activitySessionId", "=", activitySessionId)
    .where("promotedAt", "is", null)
    .executeTakeFirst();
  const configuration = await db
    .selectFrom("activitySessionBookingConfigurations")
    .selectAll()
    .where("activitySessionId", "=", activitySessionId)
    .executeTakeFirst();

  return {
    ...activitySession,
    bookedCount,
    availablePlaces,
    waitlistCount: Number(waitlistCount?.count ?? 0),
    bookingConfiguration: parseBookingConfiguration(
      configuration?.configuration,
    ),
    lifecycleState: configuration?.lifecycleState ?? "active",
    seriesId: configuration?.seriesId ?? null,
  };
}

export async function createClass(
  data: {
    name: string;
    description: string;
    trainerId: string;
    trainerName: string;
    maxCapacity: number;
    scheduledAt: number;
  },
  facilityId: string,
): Promise<ClassWithAvailability> {
  // Validate input
  if (!data.name || !data.trainerId || !data.maxCapacity || !data.scheduledAt) {
    throw new Error("Missing required fields");
  }

  if (data.maxCapacity < 1) {
    throw new Error("Max capacity must be at least 1");
  }

  if (data.scheduledAt < Date.now()) {
    throw new Error("Class date must be in the future");
  }

  const activitySessionId = `class-${randomBytes(8).toString("hex")}`;

  await db
    .insertInto("activitySessions")
    .values({
      id: activitySessionId,
      facilityId,
      name: data.name,
      description: data.description || "",
      trainerId: data.trainerId,
      trainerName: data.trainerName,
      maxCapacity: data.maxCapacity,
      scheduledAt: data.scheduledAt,
    })
    .execute();

  const newClass = await getClassWithAvailability(
    activitySessionId,
    facilityId,
  );
  if (!newClass) {
    throw new Error("Failed to create class");
  }

  return newClass;
}

export async function updateClass(
  activitySessionId: string,
  updates: {
    name?: string;
    description?: string;
    trainerId?: string;
    trainerName?: string;
    maxCapacity?: number;
    scheduledAt?: number;
  },
  facilityId: string,
): Promise<ClassWithAvailability> {
  const activitySession = await db
    .selectFrom("activitySessions")
    .selectAll()
    .where("id", "=", activitySessionId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!activitySession) {
    throw new Error("Class not found");
  }

  if (updates.maxCapacity !== undefined && updates.maxCapacity < 1) {
    throw new Error("Max capacity must be at least 1");
  }

  if (updates.scheduledAt !== undefined && updates.scheduledAt < Date.now()) {
    throw new Error("Class date must be in the future");
  }

  const updateValues: Record<string, unknown> = {};

  if (updates.name) updateValues.name = updates.name;
  if (updates.description) updateValues.description = updates.description;
  if (updates.trainerId) updateValues.trainerId = updates.trainerId;
  if (updates.trainerName) updateValues.trainerName = updates.trainerName;
  if (updates.maxCapacity) updateValues.maxCapacity = updates.maxCapacity;
  if (updates.scheduledAt) updateValues.scheduledAt = updates.scheduledAt;

  await db
    .updateTable("activitySessions")
    .set(updateValues)
    .where("id", "=", activitySessionId)
    .where("facilityId", "=", facilityId)
    .execute();

  const updatedClass = await getClassWithAvailability(
    activitySessionId,
    facilityId,
  );
  if (!updatedClass) {
    throw new Error("Failed to retrieve updated class");
  }

  return updatedClass;
}

export async function deleteClass(
  activitySessionId: string,
  facilityId: string,
): Promise<void> {
  const activitySession = await db
    .selectFrom("activitySessions")
    .selectAll()
    .where("id", "=", activitySessionId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!activitySession) {
    throw new Error("Class not found");
  }

  const [
    bookings,
    waitlistEntries,
    sessionContent,
    sessionProgress,
    communityChannels,
  ] = await Promise.all([
    db
      .selectFrom("bookings")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("activitySessionId", "=", activitySessionId)
      .executeTakeFirst(),
    db
      .selectFrom("waitlistEntries")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("activitySessionId", "=", activitySessionId)
      .executeTakeFirst(),
    db
      .selectFrom("activitySessionContents")
      .select((eb) => eb.fn.count("activitySessionId").as("count"))
      .where("activitySessionId", "=", activitySessionId)
      .executeTakeFirst(),
    db
      .selectFrom("sessionContentProgress")
      .select((eb) => eb.fn.count("activitySessionId").as("count"))
      .where("activitySessionId", "=", activitySessionId)
      .executeTakeFirst(),
    db
      .selectFrom("communityChannels")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("scope", "=", "class")
      .where("scopeId", "=", activitySessionId)
      .executeTakeFirst(),
  ]);
  const blockers = {
    bookings: Number(bookings?.count ?? 0),
    waitlistEntries: Number(waitlistEntries?.count ?? 0),
    sessionContent: Number(sessionContent?.count ?? 0),
    sessionProgress: Number(sessionProgress?.count ?? 0),
    communityChannels: Number(communityChannels?.count ?? 0),
  };
  if (Object.values(blockers).some((count) => count > 0)) {
    throw new ClassDeletionBlockedError(blockers);
  }

  await db.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom("activitySessionBookingConfigurations")
      .where("activitySessionId", "=", activitySessionId)
      .execute();
    await transaction
      .deleteFrom("activitySessions")
      .where("id", "=", activitySessionId)
      .where("facilityId", "=", facilityId)
      .execute();
  });
}

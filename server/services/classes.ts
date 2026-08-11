import { db } from "../db/client.js";
import { randomBytes } from "crypto";
import {
  defaultBookingConfiguration,
  parseBookingConfiguration,
  type BookingConfiguration,
} from "../lib/booking-configuration.js";
import { PRIMARY_FACILITY_ID } from "./facility-context.js";

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

export async function saveClassBookingConfiguration(
  classId: string,
  input: {
    configuration: Partial<BookingConfiguration>;
    lifecycleState?: "active" | "suspended" | "cancelled";
    seriesId?: string | null;
  },
  facilityId = PRIMARY_FACILITY_ID,
) {
  const gymClass = await db
    .selectFrom("gymClasses")
    .select("id")
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!gymClass) throw new Error("Class not found");

  const existing = await db
    .selectFrom("classBookingConfigurations")
    .selectAll()
    .where("classId", "=", classId)
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
    .insertInto("classBookingConfigurations")
    .values({
      classId,
      configuration: JSON.stringify(configuration),
      lifecycleState:
        input.lifecycleState ?? existing?.lifecycleState ?? "active",
      seriesId: input.seriesId ?? existing?.seriesId ?? null,
      updatedAt: Date.now(),
    })
    .onConflict((conflict) =>
      conflict.column("classId").doUpdateSet({
        configuration: JSON.stringify(configuration),
        lifecycleState:
          input.lifecycleState ?? existing?.lifecycleState ?? "active",
        seriesId: input.seriesId ?? existing?.seriesId ?? null,
        updatedAt: Date.now(),
      }),
    )
    .execute();
  return getClassWithAvailability(classId, facilityId);
}

export async function getAllClasses(
  facilityId = PRIMARY_FACILITY_ID,
): Promise<ClassWithAvailability[]> {
  const classes = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .orderBy("scheduledAt", "asc")
    .execute();

  const withAvailability = await Promise.all(
    classes.map(async (gymClass) => {
      return getClassWithAvailability(gymClass.id, facilityId);
    }),
  );

  return withAvailability.filter((c) => c !== null) as ClassWithAvailability[];
}

export async function getClassWithAvailability(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
): Promise<ClassWithAvailability | null> {
  const gymClass = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!gymClass) {
    return null;
  }

  const confirmedCount = await db
    .selectFrom("bookings")
    .select((eb) => eb.fn.count("id").as("count"))
    .where("classId", "=", classId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();

  const bookedCount = Number(confirmedCount?.count ?? 0);
  const availablePlaces = gymClass.maxCapacity - bookedCount;
  const waitlistCount = await db
    .selectFrom("waitlistEntries")
    .select((eb) => eb.fn.count("id").as("count"))
    .where("classId", "=", classId)
    .where("promotedAt", "is", null)
    .executeTakeFirst();
  const configuration = await db
    .selectFrom("classBookingConfigurations")
    .selectAll()
    .where("classId", "=", classId)
    .executeTakeFirst();

  return {
    ...gymClass,
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
  facilityId = PRIMARY_FACILITY_ID,
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

  const classId = `class-${randomBytes(8).toString("hex")}`;

  await db
    .insertInto("gymClasses")
    .values({
      id: classId,
      facilityId,
      name: data.name,
      description: data.description || "",
      trainerId: data.trainerId,
      trainerName: data.trainerName,
      maxCapacity: data.maxCapacity,
      scheduledAt: data.scheduledAt,
    })
    .execute();

  const newClass = await getClassWithAvailability(classId, facilityId);
  if (!newClass) {
    throw new Error("Failed to create class");
  }

  return newClass;
}

export async function updateClass(
  classId: string,
  updates: {
    name?: string;
    description?: string;
    trainerId?: string;
    trainerName?: string;
    maxCapacity?: number;
    scheduledAt?: number;
  },
  facilityId = PRIMARY_FACILITY_ID,
): Promise<ClassWithAvailability> {
  const gymClass = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!gymClass) {
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
    .updateTable("gymClasses")
    .set(updateValues)
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .execute();

  const updatedClass = await getClassWithAvailability(classId, facilityId);
  if (!updatedClass) {
    throw new Error("Failed to retrieve updated class");
  }

  return updatedClass;
}

export async function deleteClass(
  classId: string,
  facilityId = PRIMARY_FACILITY_ID,
): Promise<void> {
  const gymClass = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .executeTakeFirst();

  if (!gymClass) {
    throw new Error("Class not found");
  }

  // Delete associated bookings
  await db.deleteFrom("bookings").where("classId", "=", classId).execute();

  // Delete associated waitlist entries
  await db
    .deleteFrom("waitlistEntries")
    .where("classId", "=", classId)
    .execute();

  // Delete class
  await db
    .deleteFrom("gymClasses")
    .where("id", "=", classId)
    .where("facilityId", "=", facilityId)
    .execute();
}

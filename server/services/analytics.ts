import { db } from "../db/client.js";

export interface MonthlyMetrics {
  month: string;
  totalBookings: number;
  totalCancellations: number;
  totalClasses: number;
  averageOccupancy: number;
}

export interface ClassPopularity {
  classId: string;
  className: string;
  trainerName: string;
  totalBookings: number;
  averageOccupancy: number;
  nextScheduledAt: number | null;
}

export interface PeakHours {
  hour: number;
  bookingCount: number;
  classCount: number;
}

export interface UserActivityMetrics {
  userId: string;
  userName: string;
  userEmail: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  upcomingBookings: number;
}

export interface MemberMetrics {
  totalMembers: number;
  activeMembers: number;
  memberJoinedThisWeek: number;
  memberJoinedThisMonth: number;
}

// Get monthly metrics
export async function getMonthlyMetrics(
  year: number,
  month: number,
  facilityId: string,
): Promise<MonthlyMetrics> {
  const startDate = new Date(year, month - 1, 1).getTime();
  const endDate = new Date(year, month, 0, 23, 59, 59).getTime();

  const bookings = await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "gymClasses.id", "bookings.classId")
    .selectAll("bookings")
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.createdAt", ">=", startDate)
    .where("bookings.createdAt", "<=", endDate)
    .execute();

  const classes = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .where("scheduledAt", ">=", startDate)
    .where("scheduledAt", "<=", endDate)
    .execute();

  const confirmedCount = bookings.filter(
    (b) => b.status === "confirmed",
  ).length;
  const cancelledCount = bookings.filter(
    (b) => b.status === "cancelled",
  ).length;

  let totalOccupancy = 0;
  let classesWithOccupancy = 0;

  for (const gymClass of classes) {
    const classBookings = bookings.filter(
      (b) => b.classId === gymClass.id && b.status === "confirmed",
    );
    const booked = classBookings.length;
    const capacity = gymClass.maxCapacity;
    if (capacity > 0) {
      totalOccupancy += (booked / capacity) * 100;
      classesWithOccupancy++;
    }
  }

  const averageOccupancy =
    classesWithOccupancy > 0
      ? Math.round(totalOccupancy / classesWithOccupancy)
      : 0;

  const monthName = new Date(year, month - 1).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  return {
    month: monthName,
    totalBookings: confirmedCount,
    totalCancellations: cancelledCount,
    totalClasses: classes.length,
    averageOccupancy,
  };
}

// Get class popularity metrics
export async function getClassPopularity(
  facilityId: string,
): Promise<ClassPopularity[]> {
  const classes = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .execute();

  const popularity: ClassPopularity[] = [];

  for (const gymClass of classes) {
    const bookings = await db
      .selectFrom("bookings")
      .selectAll()
      .where("classId", "=", gymClass.id)
      .where("status", "=", "confirmed")
      .execute();

    const booked = bookings.length;
    const occupancyPercent =
      gymClass.maxCapacity > 0
        ? Math.round((booked / gymClass.maxCapacity) * 100)
        : 0;

    popularity.push({
      classId: gymClass.id,
      className: gymClass.name,
      trainerName: gymClass.trainerName,
      totalBookings: booked,
      averageOccupancy: occupancyPercent,
      nextScheduledAt: gymClass.scheduledAt,
    });
  }

  return popularity.sort((a, b) => b.totalBookings - a.totalBookings);
}

// Get peak hours based on class schedules and bookings
export async function getPeakHours(facilityId: string): Promise<PeakHours[]> {
  const classes = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("facilityId", "=", facilityId)
    .execute();

  const hourMap = new Map<
    number,
    { bookingCount: number; classCount: number }
  >();

  for (const gymClass of classes) {
    const hour = Math.floor((gymClass.scheduledAt % 86400000) / 3600000);

    const bookings = await db
      .selectFrom("bookings")
      .selectAll()
      .where("classId", "=", gymClass.id)
      .where("status", "=", "confirmed")
      .execute();

    const current = hourMap.get(hour) || { bookingCount: 0, classCount: 0 };
    current.bookingCount += bookings.length;
    current.classCount += 1;
    hourMap.set(hour, current);
  }

  const peakHours: PeakHours[] = Array.from(hourMap.entries()).map(
    ([hour, data]) => ({
      hour,
      ...data,
    }),
  );

  return peakHours.sort((a, b) => b.bookingCount - a.bookingCount);
}

// Get user activity metrics
export async function getUserActivityMetrics(
  userId: string,
  facilityId: string,
): Promise<UserActivityMetrics | null> {
  const user = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select(["users.id", "users.name", "users.email"])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.userId", "=", userId)
    .where("facilityMemberships.status", "=", "active")
    .where("users.accountStatus", "=", "active")
    .executeTakeFirst();

  if (!user) {
    return null;
  }

  const bookings = await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "gymClasses.id", "bookings.classId")
    .selectAll("bookings")
    .where("bookings.userId", "=", userId)
    .where("gymClasses.facilityId", "=", facilityId)
    .execute();

  const confirmedCount = bookings.filter(
    (b) => b.status === "confirmed",
  ).length;
  const cancelledCount = bookings.filter(
    (b) => b.status === "cancelled",
  ).length;
  const upcomingBookings = await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
    .select("bookings.id")
    .where("bookings.userId", "=", userId)
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.status", "=", "confirmed")
    .where("gymClasses.scheduledAt", ">", Date.now())
    .execute();

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    totalBookings: bookings.length,
    confirmedBookings: confirmedCount,
    cancelledBookings: cancelledCount,
    upcomingBookings: upcomingBookings.length,
  };
}

// Get trainer activity metrics
export async function getTrainerActivityMetrics(
  trainerId: string,
  facilityId: string,
): Promise<{
  trainerId: string;
  totalClasses: number;
  totalBookings: number;
  averageOccupancy: number;
  totalMembers: number;
}> {
  const classes = await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("trainerId", "=", trainerId)
    .where("facilityId", "=", facilityId)
    .execute();

  let totalBookings = 0;
  let totalOccupancy = 0;
  const uniqueMembers = new Set<string>();

  for (const gymClass of classes) {
    const bookings = await db
      .selectFrom("bookings")
      .selectAll()
      .where("classId", "=", gymClass.id)
      .where("status", "=", "confirmed")
      .execute();

    totalBookings += bookings.length;
    const occupancyPercent =
      gymClass.maxCapacity > 0
        ? (bookings.length / gymClass.maxCapacity) * 100
        : 0;
    totalOccupancy += occupancyPercent;

    bookings.forEach((b) => uniqueMembers.add(b.userId));
  }

  const averageOccupancy =
    classes.length > 0 ? Math.round(totalOccupancy / classes.length) : 0;

  return {
    trainerId,
    totalClasses: classes.length,
    totalBookings,
    averageOccupancy,
    totalMembers: uniqueMembers.size,
  };
}

// Get member metrics
export async function getMemberMetrics(
  facilityId: string,
): Promise<MemberMetrics> {
  const members = await db
    .selectFrom("facilityMemberships")
    .innerJoin("users", "users.id", "facilityMemberships.userId")
    .select(["facilityMemberships.userId", "facilityMemberships.createdAt"])
    .where("facilityMemberships.facilityId", "=", facilityId)
    .where("facilityMemberships.role", "=", "member")
    .where("facilityMemberships.status", "=", "active")
    .where("users.accountStatus", "=", "active")
    .execute();

  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;

  // Get unique users who made bookings in last 30 days
  const activeBookings = await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "gymClasses.id", "bookings.classId")
    .innerJoin("facilityMemberships", (join) =>
      join
        .onRef("facilityMemberships.userId", "=", "bookings.userId")
        .onRef("facilityMemberships.facilityId", "=", "gymClasses.facilityId"),
    )
    .innerJoin("users", "users.id", "bookings.userId")
    .select("bookings.userId")
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.status", "=", "confirmed")
    .where("bookings.createdAt", ">", monthAgo)
    .where("facilityMemberships.role", "=", "member")
    .where("facilityMemberships.status", "=", "active")
    .where("users.accountStatus", "=", "active")
    .execute();

  const uniqueActiveMembers = new Set(activeBookings.map((b) => b.userId));

  const membersThisWeek = members.filter((m) => m.createdAt > weekAgo).length;
  const membersThisMonth = members.filter((m) => m.createdAt > monthAgo).length;

  return {
    totalMembers: members.length,
    activeMembers: uniqueActiveMembers.size,
    memberJoinedThisWeek: membersThisWeek,
    memberJoinedThisMonth: membersThisMonth,
  };
}

// Get upcoming bookings for a user
export async function getUpcomingBookings(userId: string, facilityId: string) {
  return await db
    .selectFrom("bookings")
    .innerJoin("gymClasses", "bookings.classId", "gymClasses.id")
    .selectAll()
    .where("bookings.userId", "=", userId)
    .where("gymClasses.facilityId", "=", facilityId)
    .where("bookings.status", "=", "confirmed")
    .where("gymClasses.scheduledAt", ">", Date.now())
    .orderBy("gymClasses.scheduledAt", "asc")
    .limit(5)
    .execute();
}

// Get upcoming classes for a trainer
export async function getTrainerUpcomingClasses(
  trainerId: string,
  facilityId: string,
) {
  return await db
    .selectFrom("gymClasses")
    .selectAll()
    .where("trainerId", "=", trainerId)
    .where("facilityId", "=", facilityId)
    .where("scheduledAt", ">", Date.now())
    .orderBy("scheduledAt", "asc")
    .limit(5)
    .execute();
}

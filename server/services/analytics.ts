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

export type AnalyticsConsumer = "administration" | "trainer";

export interface AnalyticsPeriod {
  from: number;
  to: number;
  utcOffsetMinutes: number;
}

export interface AnalyticsSummary {
  sessions: number;
  availablePlaces: number;
  confirmedBookings: number;
  cancellations: number;
  currentWaitlistDemand: number;
  attended: number;
  absent: number;
  excused: number;
  uniqueMembers: number;
  occupancyRate: number;
  attendanceRate: number | null;
  noShowRate: number | null;
}

export interface ActivityPerformance {
  activityName: string;
  trainerName: string;
  sessions: number;
  availablePlaces: number;
  confirmedBookings: number;
  cancellations: number;
  currentWaitlistDemand: number;
  attended: number;
  absent: number;
  occupancyRate: number;
  attendanceRate: number | null;
}

export interface MemberEngagement {
  userId: string;
  userName: string;
  bookedSessions: number;
  attendedSessions: number;
  absentSessions: number;
  cancelledSessions: number;
  favoriteActivity: string | null;
  lastSessionAt: number | null;
}

export interface AnalyticsRecommendation {
  code:
    | "COLLECT_MORE_DATA"
    | "INCREASE_CAPACITY"
    | "REVIEW_LOW_DEMAND"
    | "REDUCE_NO_SHOWS";
  priority: "info" | "opportunity" | "attention";
  activityName: string | null;
  observedValue: number | null;
}

export interface AnalyticsDataQuality {
  attendanceCoverageRate: number | null;
  causalExplanation: "survey_required";
  currentWaitlistOnly: true;
}

export interface AnalyticsOverview {
  consumer: AnalyticsConsumer;
  period: AnalyticsPeriod;
  summary: AnalyticsSummary;
  activities: ActivityPerformance[];
  peakHours: PeakHours[];
  members: MemberEngagement[];
  recommendations: AnalyticsRecommendation[];
  dataQuality: AnalyticsDataQuality;
}

interface AnalyticsOverviewInput extends AnalyticsPeriod {
  facilityId: string;
  consumer: AnalyticsConsumer;
  trainerId?: string;
}

interface ActivityAccumulator {
  activityName: string;
  trainerNames: Set<string>;
  sessions: number;
  availablePlaces: number;
  confirmedBookings: number;
  cancellations: number;
  currentWaitlistDemand: number;
  attended: number;
  absent: number;
}

interface MemberAccumulator {
  userId: string;
  userName: string;
  bookedSessions: number;
  attendedSessions: number;
  absentSessions: number;
  cancelledSessions: number;
  activityCounts: Map<string, number>;
  lastSessionAt: number | null;
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function localHour(timestamp: number, utcOffsetMinutes: number): number {
  const shifted = timestamp + utcOffsetMinutes * 60_000;
  return new Date(shifted).getUTCHours();
}

function bestActivity(activityCounts: Map<string, number>): string | null {
  let selected: string | null = null;
  let selectedCount = 0;
  for (const [activityName, count] of activityCounts) {
    if (
      count > selectedCount ||
      (count === selectedCount && selected !== null && activityName < selected)
    ) {
      selected = activityName;
      selectedCount = count;
    }
  }
  return selected;
}

function buildRecommendations(
  activities: ActivityPerformance[],
  summary: AnalyticsSummary,
): AnalyticsRecommendation[] {
  const recommendations: AnalyticsRecommendation[] = [];

  for (const activity of activities) {
    if (
      activity.sessions >= 1 &&
      activity.occupancyRate >= 85 &&
      activity.currentWaitlistDemand > 0
    ) {
      recommendations.push({
        code: "INCREASE_CAPACITY",
        priority: "opportunity",
        activityName: activity.activityName,
        observedValue: activity.occupancyRate,
      });
    }
    if (activity.sessions >= 2 && activity.occupancyRate < 35) {
      recommendations.push({
        code: "REVIEW_LOW_DEMAND",
        priority: "attention",
        activityName: activity.activityName,
        observedValue: activity.occupancyRate,
      });
    }
  }

  const attendanceOutcomes = summary.attended + summary.absent;
  if (
    attendanceOutcomes >= 5 &&
    summary.noShowRate !== null &&
    summary.noShowRate >= 20
  ) {
    recommendations.push({
      code: "REDUCE_NO_SHOWS",
      priority: "attention",
      activityName: null,
      observedValue: summary.noShowRate,
    });
  }

  if (summary.sessions === 0 || summary.confirmedBookings < 5) {
    recommendations.push({
      code: "COLLECT_MORE_DATA",
      priority: "info",
      activityName: null,
      observedValue: summary.confirmedBookings,
    });
  }

  return recommendations.slice(0, 6);
}

export async function getAnalyticsOverview(
  input: AnalyticsOverviewInput,
): Promise<AnalyticsOverview> {
  let classesQuery = db
    .selectFrom("gymClasses")
    .select([
      "id",
      "name",
      "trainerId",
      "trainerName",
      "maxCapacity",
      "scheduledAt",
    ])
    .where("facilityId", "=", input.facilityId)
    .where("scheduledAt", ">=", input.from)
    .where("scheduledAt", "<", input.to);

  if (input.trainerId) {
    classesQuery = classesQuery.where("trainerId", "=", input.trainerId);
  }

  const classes = await classesQuery.orderBy("scheduledAt", "asc").execute();
  const classIds = classes.map((gymClass) => gymClass.id);
  const classById = new Map(classes.map((gymClass) => [gymClass.id, gymClass]));

  const bookingRows =
    classIds.length === 0
      ? []
      : await db
          .selectFrom("bookings")
          .leftJoin(
            "bookingLifecycles",
            "bookingLifecycles.bookingId",
            "bookings.id",
          )
          .leftJoin("users", "users.id", "bookings.userId")
          .leftJoin("facilityMemberships", (join) =>
            join
              .onRef("facilityMemberships.userId", "=", "bookings.userId")
              .on("facilityMemberships.facilityId", "=", input.facilityId),
          )
          .select([
            "bookings.id",
            "bookings.classId",
            "bookings.userId",
            "bookings.status",
            "bookingLifecycles.lifecycleStatus",
            "users.name as userName",
            "users.accountStatus",
            "facilityMemberships.role as membershipRole",
            "facilityMemberships.status as membershipStatus",
          ])
          .where("bookings.classId", "in", classIds)
          .execute();

  const activities = new Map<string, ActivityAccumulator>();
  const hourMap = new Map<
    number,
    { bookingCount: number; classCount: number }
  >();
  const members = new Map<string, MemberAccumulator>();

  for (const gymClass of classes) {
    const existing = activities.get(gymClass.name) ?? {
      activityName: gymClass.name,
      trainerNames: new Set<string>(),
      sessions: 0,
      availablePlaces: 0,
      confirmedBookings: 0,
      cancellations: 0,
      currentWaitlistDemand: 0,
      attended: 0,
      absent: 0,
    };
    existing.sessions += 1;
    existing.availablePlaces += gymClass.maxCapacity;
    existing.trainerNames.add(gymClass.trainerName);
    activities.set(gymClass.name, existing);

    const hour = localHour(gymClass.scheduledAt, input.utcOffsetMinutes);
    const hourData = hourMap.get(hour) ?? { bookingCount: 0, classCount: 0 };
    hourData.classCount += 1;
    hourMap.set(hour, hourData);
  }

  let confirmedBookings = 0;
  let cancellations = 0;
  let currentWaitlistDemand = 0;
  let attended = 0;
  let absent = 0;
  let excused = 0;
  let attendanceEligibleBookings = 0;
  const now = Date.now();

  for (const booking of bookingRows) {
    const gymClass = classById.get(booking.classId);
    if (!gymClass) continue;
    const activity = activities.get(gymClass.name);
    if (!activity) continue;

    if (booking.status === "confirmed") {
      confirmedBookings += 1;
      activity.confirmedBookings += 1;
      if (gymClass.scheduledAt <= now) attendanceEligibleBookings += 1;
      const hour = localHour(gymClass.scheduledAt, input.utcOffsetMinutes);
      const hourData = hourMap.get(hour);
      if (hourData) hourData.bookingCount += 1;
    } else if (booking.status === "cancelled") {
      cancellations += 1;
      activity.cancellations += 1;
    } else if (booking.status === "waitlist") {
      currentWaitlistDemand += 1;
      activity.currentWaitlistDemand += 1;
    }

    if (booking.lifecycleStatus === "attended") {
      attended += 1;
      activity.attended += 1;
    } else if (booking.lifecycleStatus === "absent") {
      absent += 1;
      activity.absent += 1;
    } else if (booking.lifecycleStatus === "excused") {
      excused += 1;
    }

    if (
      booking.userName === null ||
      booking.accountStatus !== "active" ||
      booking.membershipRole !== "member" ||
      booking.membershipStatus !== "active"
    ) {
      continue;
    }

    const member = members.get(booking.userId) ?? {
      userId: booking.userId,
      userName: booking.userName,
      bookedSessions: 0,
      attendedSessions: 0,
      absentSessions: 0,
      cancelledSessions: 0,
      activityCounts: new Map<string, number>(),
      lastSessionAt: null,
    };
    if (booking.status === "confirmed") {
      member.bookedSessions += 1;
      member.activityCounts.set(
        gymClass.name,
        (member.activityCounts.get(gymClass.name) ?? 0) + 1,
      );
    }
    if (booking.status === "cancelled") member.cancelledSessions += 1;
    if (booking.lifecycleStatus === "attended") member.attendedSessions += 1;
    if (booking.lifecycleStatus === "absent") member.absentSessions += 1;
    member.lastSessionAt = Math.max(
      member.lastSessionAt ?? 0,
      gymClass.scheduledAt,
    );
    members.set(booking.userId, member);
  }

  const activityPerformance = Array.from(activities.values())
    .map<ActivityPerformance>((activity) => ({
      activityName: activity.activityName,
      trainerName: Array.from(activity.trainerNames).sort().join(", "),
      sessions: activity.sessions,
      availablePlaces: activity.availablePlaces,
      confirmedBookings: activity.confirmedBookings,
      cancellations: activity.cancellations,
      currentWaitlistDemand: activity.currentWaitlistDemand,
      attended: activity.attended,
      absent: activity.absent,
      occupancyRate:
        percentage(activity.confirmedBookings, activity.availablePlaces) ?? 0,
      attendanceRate: percentage(
        activity.attended,
        activity.attended + activity.absent,
      ),
    }))
    .sort(
      (left, right) =>
        right.occupancyRate - left.occupancyRate ||
        right.confirmedBookings - left.confirmedBookings ||
        left.activityName.localeCompare(right.activityName),
    );

  const memberEngagement = Array.from(members.values())
    .map<MemberEngagement>((member) => ({
      userId: member.userId,
      userName: member.userName,
      bookedSessions: member.bookedSessions,
      attendedSessions: member.attendedSessions,
      absentSessions: member.absentSessions,
      cancelledSessions: member.cancelledSessions,
      favoriteActivity: bestActivity(member.activityCounts),
      lastSessionAt: member.lastSessionAt,
    }))
    .sort(
      (left, right) =>
        right.attendedSessions - left.attendedSessions ||
        right.bookedSessions - left.bookedSessions ||
        left.userName.localeCompare(right.userName),
    );

  const summary: AnalyticsSummary = {
    sessions: classes.length,
    availablePlaces: classes.reduce(
      (total, gymClass) => total + gymClass.maxCapacity,
      0,
    ),
    confirmedBookings,
    cancellations,
    currentWaitlistDemand,
    attended,
    absent,
    excused,
    uniqueMembers: members.size,
    occupancyRate:
      percentage(
        confirmedBookings,
        classes.reduce((total, gymClass) => total + gymClass.maxCapacity, 0),
      ) ?? 0,
    attendanceRate: percentage(attended, attended + absent),
    noShowRate: percentage(absent, attended + absent),
  };

  return {
    consumer: input.consumer,
    period: {
      from: input.from,
      to: input.to,
      utcOffsetMinutes: input.utcOffsetMinutes,
    },
    summary,
    activities: activityPerformance,
    peakHours: Array.from(hourMap.entries())
      .map(([hour, values]) => ({ hour, ...values }))
      .sort((left, right) => left.hour - right.hour),
    members: memberEngagement,
    recommendations: buildRecommendations(activityPerformance, summary),
    dataQuality: {
      attendanceCoverageRate: percentage(
        attended + absent + excused,
        attendanceEligibleBookings,
      ),
      causalExplanation: "survey_required",
      currentWaitlistOnly: true,
    },
  };
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
    .where("gymClasses.scheduledAt", ">=", startDate)
    .where("gymClasses.scheduledAt", "<=", endDate)
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

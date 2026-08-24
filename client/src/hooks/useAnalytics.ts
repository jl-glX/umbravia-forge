import { useState, useEffect } from "react";
import { authFetch } from "../lib/api";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export interface MonthlyMetric {
  month: string;
  totalBookings: number;
  totalCancellations: number;
  totalClasses: number;
  averageOccupancy: number;
}

export interface ClassPopularityMetric {
  activitySessionId: string;
  className: string;
  trainerName: string;
  totalBookings: number;
  averageOccupancy: number;
  nextScheduledAt: number | null;
}

export interface PeakHourMetric {
  hour: number;
  bookingCount: number;
  classCount: number;
}

export interface UserActivityMetric {
  userId: string;
  userName: string;
  userEmail: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  upcomingBookings: number;
}

export interface TrainerActivityMetric {
  trainerId: string;
  totalClasses: number;
  totalBookings: number;
  averageOccupancy: number;
  totalMembers: number;
}

export interface MemberMetric {
  totalMembers: number;
  activeMembers: number;
  memberJoinedThisWeek: number;
  memberJoinedThisMonth: number;
}

export interface UpcomingScheduleItem {
  id: string;
  activitySessionId?: string;
  userId?: string;
  status?: string;
  createdAt?: number;
  cancelledAt?: number | null;
  name?: string;
  description?: string;
  scheduledAt?: number;
  maxCapacity?: number;
  trainerId?: string;
  trainerName?: string;
}

export type AnalyticsPeriodType = "day" | "week" | "month";

export interface AnalyticsOverview {
  consumer: "administration" | "trainer";
  period: { from: number; to: number; utcOffsetMinutes: number };
  summary: {
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
  };
  activities: Array<{
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
  }>;
  timeSlots: Array<{
    activityName: string;
    weekday: number;
    hour: number;
    sessions: number;
    availablePlaces: number;
    confirmedBookings: number;
    cancellations: number;
    attended: number;
    absent: number;
    occupancyRate: number;
    attendanceRate: number | null;
  }>;
  peakHours: PeakHourMetric[];
  members: Array<{
    userId: string;
    userName: string;
    bookedSessions: number;
    attendedSessions: number;
    absentSessions: number;
    cancelledSessions: number;
    favoriteActivity: string | null;
    lastSessionAt: number | null;
  }>;
  recommendations: Array<{
    code:
      | "COLLECT_MORE_DATA"
      | "INCREASE_CAPACITY"
      | "REVIEW_LOW_DEMAND"
      | "REDUCE_NO_SHOWS";
    priority: "info" | "opportunity" | "attention";
    activityName: string | null;
    observedValue: number | null;
  }>;
  dataQuality: {
    attendanceCoverageRate: number | null;
    causalExplanation: "survey_required";
    currentWaitlistOnly: true;
    historyCoverage: "baseline_and_live";
  };
  history: {
    current: BookingEventFunnel;
    previous: BookingEventFunnel;
    baselineEvents: number;
    liveEvents: number;
    previousPeriod: { from: number; to: number };
  };
  centreBaseline: {
    activeMembers: number;
    activeTrainers: number;
    activeSpaces: number;
    averageSessionCapacity: number | null;
    newMembers: number;
    engagedMembers: number;
    participationRate: number | null;
    cancellationRate: number | null;
  } | null;
}

export interface BookingEventFunnel {
  observedBookings: number;
  waitlistEntries: number;
  promotions: number;
  cancellations: number;
  attended: number;
  absent: number;
  excused: number;
}

export function analyticsPeriodBounds(
  period: AnalyticsPeriodType,
  reference = new Date(),
) {
  const from = new Date(reference);
  from.setHours(0, 0, 0, 0);
  if (period === "week") {
    const daysSinceMonday = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - daysSinceMonday);
  } else if (period === "month") {
    from.setDate(1);
  }

  const to = new Date(from);
  if (period === "day") to.setDate(to.getDate() + 1);
  if (period === "week") to.setDate(to.getDate() + 7);
  if (period === "month") to.setMonth(to.getMonth() + 1);

  return {
    from: from.getTime(),
    to: to.getTime(),
    utcOffsetMinutes: -reference.getTimezoneOffset(),
  };
}

export function useAnalyticsOverview(period: AnalyticsPeriodType) {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const bounds = analyticsPeriodBounds(period);
    const query = new URLSearchParams({
      from: String(bounds.from),
      to: String(bounds.to),
      utcOffsetMinutes: String(bounds.utcOffsetMinutes),
    });

    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await authFetch(
          `${API_BASE}/api/analytics/overview?${query.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("ANALYTICS_OVERVIEW_FAILED");
        setData((await response.json()) as AnalyticsOverview);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "ANALYTICS_OVERVIEW_FAILED",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchOverview();
    return () => controller.abort();
  }, [period]);

  return { data, loading, error };
}

export function useMonthlyMetrics(year: number, month: number) {
  const [data, setData] = useState<MonthlyMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!year || !month) return;

    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_BASE}/api/analytics/monthly?year=${year}&month=${month}`,
        );
        if (!res.ok) throw new Error("Failed to fetch monthly metrics");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching monthly metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [year, month]);

  return { data, loading, error };
}

export function useClassPopularity() {
  const [data, setData] = useState<ClassPopularityMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_BASE}/api/analytics/class-popularity`,
        );
        if (!res.ok) throw new Error("Failed to fetch class popularity");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching class popularity:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  return { data, loading, error };
}

export function usePeakHours() {
  const [data, setData] = useState<PeakHourMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/analytics/peak-hours`);
        if (!res.ok) throw new Error("Failed to fetch peak hours");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching peak hours:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  return { data, loading, error };
}

export function useUserActivityMetrics(userId: string) {
  const [data, setData] = useState<UserActivityMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/analytics/user/${userId}`);
        if (!res.ok) throw new Error("Failed to fetch user activity metrics");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching user activity metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [userId]);

  return { data, loading, error };
}

export function useTrainerActivityMetrics(trainerId: string) {
  const [data, setData] = useState<TrainerActivityMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trainerId) return;

    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_BASE}/api/analytics/trainer/${trainerId}`,
        );
        if (!res.ok)
          throw new Error("Failed to fetch trainer activity metrics");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching trainer activity metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [trainerId]);

  return { data, loading, error };
}

export function useMemberMetrics() {
  const [data, setData] = useState<MemberMetric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/analytics/members`);
        if (!res.ok) throw new Error("Failed to fetch member metrics");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching member metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  return { data, loading, error };
}

export function useUpcomingBookings(userId: string) {
  const [data, setData] = useState<UpcomingScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const fetchBookings = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_BASE}/api/analytics/user/${userId}/upcoming-bookings`,
        );
        if (!res.ok) throw new Error("Failed to fetch upcoming bookings");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching upcoming bookings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [userId]);

  return { data, loading, error };
}

export function useTrainerUpcomingClasses(trainerId: string) {
  const [data, setData] = useState<UpcomingScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trainerId) return;

    const fetchClasses = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_BASE}/api/analytics/trainer/${trainerId}/upcoming-classes`,
        );
        if (!res.ok) throw new Error("Failed to fetch upcoming classes");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Error fetching upcoming classes:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchClasses();
  }, [trainerId]);

  return { data, loading, error };
}

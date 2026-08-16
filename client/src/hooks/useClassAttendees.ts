import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../lib/api";
import i18n from "../i18n/config";

interface Attendee {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: "confirmed";
  lifecycleStatus: string | null;
  attendanceIntention: "unanswered" | "yes" | "no" | "uncertain" | null;
}

interface WaitlistEntry {
  id: string;
  userId: string;
  position: number;
  name: string;
  email: string;
  createdAt: number;
}

interface AttendeeState {
  attendees: Attendee[];
  waitlist: WaitlistEntry[];
  loading: boolean;
  error: string | null;
}

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export function useClassAttendees(activitySessionId: string) {
  const [state, setState] = useState<AttendeeState>({
    attendees: [],
    waitlist: [],
    loading: true,
    error: null,
  });

  const fetchAttendees = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const [attendeesRes, waitlistRes] = await Promise.all([
        authFetch(`${API_BASE}/api/bookings/class/${activitySessionId}`),
        authFetch(`${API_BASE}/api/bookings/waitlist/${activitySessionId}`),
      ]);

      if (!attendeesRes.ok || !waitlistRes.ok) {
        throw new Error(i18n.t("errors.fetchAttendees"));
      }

      const attendees = await attendeesRes.json();
      const waitlist = await waitlistRes.json();

      setState({
        attendees: attendees.map(
          (a: {
            id: string;
            userId: string;
            name: string;
            email: string;
            status: "confirmed";
            lifecycleStatus: string | null;
            attendanceIntention:
              "unanswered" | "yes" | "no" | "uncertain" | null;
          }) => ({
            id: a.id,
            userId: a.userId,
            name: a.name,
            email: a.email,
            status: a.status,
            lifecycleStatus: a.lifecycleStatus,
            attendanceIntention: a.attendanceIntention,
          }),
        ),
        waitlist: waitlist.map(
          (w: {
            id: string;
            userId: string;
            position: number;
            name: string;
            email: string;
            createdAt: number;
          }) => ({
            id: w.id,
            userId: w.userId,
            position: w.position,
            name: w.name,
            email: w.email,
            createdAt: w.createdAt,
          }),
        ),
        loading: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("errors.fetchAttendees");
      setState({
        attendees: [],
        waitlist: [],
        loading: false,
        error: message,
      });
    }
  }, [activitySessionId]);

  useEffect(() => {
    if (activitySessionId) {
      fetchAttendees();
    }
  }, [activitySessionId, fetchAttendees]);

  return {
    attendees: state.attendees,
    waitlist: state.waitlist,
    loading: state.loading,
    error: state.error,
    refreshAttendees: fetchAttendees,
  };
}

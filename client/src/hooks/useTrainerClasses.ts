import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../lib/api";
import i18n from "../i18n/config";

interface TrainerClass {
  id: string;
  name: string;
  description: string;
  trainerId: string;
  trainerName: string;
  maxCapacity: number;
  scheduledAt: number;
  bookedCount: number;
  availablePlaces: number;
  waitlistCount: number;
}

interface TrainerClassesState {
  classes: TrainerClass[];
  loading: boolean;
  error: string | null;
}

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export function useTrainerClasses(trainerId: string) {
  const [state, setState] = useState<TrainerClassesState>({
    classes: [],
    loading: true,
    error: null,
  });

  const fetchClasses = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await authFetch(
        `${API_BASE}/api/activity-sessions/trainer/${trainerId}`,
      );

      if (!res.ok) {
        throw new Error(i18n.t("errors.fetchTrainerClasses"));
      }

      const classes = await res.json();
      setState({ classes, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("errors.fetchClasses");
      setState({ classes: [], loading: false, error: message });
    }
  }, [trainerId]);

  useEffect(() => {
    if (trainerId) {
      fetchClasses();
    }
  }, [trainerId, fetchClasses]);

  return {
    classes: state.classes,
    loading: state.loading,
    error: state.error,
    refreshClasses: fetchClasses,
  };
}

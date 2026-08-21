import { useState, useEffect } from "react";
import { authFetch } from "../lib/api";
import { localizedApiErrorMessage } from "../lib/api-error";
import i18n from "../i18n/config";

export interface ActivitySession {
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

export function useClasses() {
  const [classes, setClasses] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch("/api/activity-sessions");

      if (!response.ok) {
        throw new Error(
          await localizedApiErrorMessage(
            response,
            i18n.t("errors.fetchClasses"),
            (key) => i18n.t(key),
          ),
        );
      }

      const data = await response.json();
      setClasses(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("common.unknownError");
      setError(message);
      console.error("Error fetching classes:", err);
    } finally {
      setLoading(false);
    }
  };

  const refreshClasses = async () => {
    await fetchClasses();
  };

  return { classes, loading, error, refreshClasses };
}

import { useState } from "react";
import { authFetch } from "../lib/api";
import i18n from "../i18n/config";

export interface UserBooking {
  id: string;
  activitySessionId: string;
  status: "confirmed" | "cancelled" | "waitlist";
  createdAt: number;
  name: string;
  scheduledAt: number;
  trainerName: string;
}

export function useBookings(userId: string) {
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await authFetch(`/api/bookings/user/${userId}`);

      if (!response.ok) {
        throw new Error(i18n.t("bookings.fetchFailed"));
      }

      const data = await response.json();
      setBookings(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("common.unknownError");
      setError(message);
      console.error("Error fetching bookings:", err);
    } finally {
      setLoading(false);
    }
  };

  const bookClass = async (activitySessionId: string) => {
    try {
      setError(null);
      const response = await authFetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activitySessionId, userId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || i18n.t("errors.bookClass"));
      }

      const result = await response.json();
      await fetchBookings();
      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("common.unknownError");
      setError(message);
      throw err;
    }
  };

  const cancelBooking = async (bookingId: string) => {
    try {
      setError(null);
      const response = await authFetch(`/api/bookings/${bookingId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || i18n.t("bookings.cancelFailed"));
      }

      await fetchBookings();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : i18n.t("common.unknownError");
      setError(message);
      throw err;
    }
  };

  return {
    bookings,
    loading,
    error,
    fetchBookings,
    bookClass,
    cancelBooking,
  };
}

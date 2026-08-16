import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  AlertCircle,
  Check,
  CircleHelp,
  Clock,
  Loader,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import { formatDateTime, isFutureClass } from "../lib/dateUtils";
import { authFetch } from "../lib/api";
import { useTranslation } from "react-i18next";
import { localizeClass } from "../lib/classLocalization";

interface UserBooking {
  id: string;
  activitySessionId: string;
  status: "confirmed" | "cancelled" | "waitlist";
  createdAt: number;
  name: string;
  scheduledAt: number;
  trainerName: string;
  lifecycleStatus: string;
  attendanceIntention: "unanswered" | "yes" | "no" | "uncertain";
  reminderDue: boolean;
  waitlistPosition: number | null;
  promotionExpiresAt: number | null;
}

interface BookingReputationSummary {
  score: number;
  penaltyActive: boolean;
  penaltyUntil: number | null;
  tier: "reliable" | "standard" | "reduced";
  explanationCode: "temporary_penalty" | "no_penalty";
  recoveryActions: Array<
    "attend" | "honor_confirmation" | "cancel_on_time" | "request_review"
  >;
  events: Array<{
    id: string;
    type:
      | "attended"
      | "confirmed_attended"
      | "cancelled_on_time"
      | "cancelled_neutral"
      | "cancelled_late"
      | "absent"
      | "excused"
      | "uncertain"
      | "penalty_cleared"
      | "manual_adjustment";
    pointsDelta: number;
    createdAt: number;
  }>;
}

interface UserBookingsProps {
  userId: string;
}

export function UserBookings({ userId }: UserBookingsProps) {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [updatingIntention, setUpdatingIntention] = useState<string | null>(
    null,
  );
  const [reputation, setReputation] = useState<BookingReputationSummary | null>(
    null,
  );

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch(`/api/bookings/user/${userId}`);

      if (!response.ok) {
        throw new Error(t("bookings.fetchFailed"));
      }

      const data = await response.json();
      // Filter out cancelled bookings
      setBookings(data.filter((b: UserBooking) => b.status !== "cancelled"));
      const reputationResponse = await authFetch(
        `/api/bookings/reputation/${userId}`,
      );
      if (reputationResponse.ok) setReputation(await reputationResponse.json());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.unknownError");
      setError(message);
      console.error("Error fetching bookings:", err);
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  const handleCancel = async (bookingId: string) => {
    try {
      setCancelling(bookingId);
      const response = await authFetch(`/api/bookings/${bookingId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t("bookings.cancelFailed"));
      }

      await fetchBookings();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.unknownError");
      setError(message);
    } finally {
      setCancelling(null);
    }
  };

  const handleIntention = async (
    bookingId: string,
    intention: "yes" | "no" | "uncertain",
  ) => {
    setUpdatingIntention(bookingId);
    try {
      const response = await authFetch(`/api/bookings/${bookingId}/intention`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, intention }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || t("bookings.intentionError"));
      }
      await fetchBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknownError"));
    } finally {
      setUpdatingIntention(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="mr-2 animate-spin" />
        <span>{t("common.loadingBookings")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertCircle className="shrink-0 text-red-600" />
          <p>{error}</p>
        </div>
      )}
      {reputation && (
        <Card className="border-blue-100 bg-blue-50/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck size={18} className="text-blue-600" />
                {t("bookings.reputationTitle")}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {t("bookings.reputationScore", { score: reputation.score })}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {t(
                  `bookings.reputationExplanation.${reputation.explanationCode}`,
                )}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                reputation.penaltyActive
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {t(`bookings.reputationTier.${reputation.tier}`)}
            </span>
          </div>
          {reputation.penaltyActive && (
            <p className="mt-3 text-sm text-amber-800">
              {t("bookings.penaltyUntil", {
                date: reputation.penaltyUntil
                  ? formatDateTime(reputation.penaltyUntil)
                  : "—",
              })}
            </p>
          )}
          {reputation.recoveryActions.length > 0 && (
            <details className="mt-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold">
                {t("bookings.recoveryTitle")}
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {reputation.recoveryActions.map((action) => (
                  <li key={action}>
                    {t(`bookings.recoveryActions.${action}`)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {reputation.events.length > 0 && (
            <details className="mt-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold">
                {t("bookings.reputationHistory")}
              </summary>
              <ul className="mt-2 space-y-2">
                {reputation.events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap justify-between gap-2 border-t border-blue-100 pt-2"
                  >
                    <span>{t(`bookings.reputationEvents.${event.type}`)}</span>
                    <span className="text-slate-500">
                      {event.pointsDelta > 0 ? "+" : ""}
                      {event.pointsDelta} · {formatDateTime(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}
      {bookings.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 py-8 text-center">
          <p className="text-gray-600">{t("bookings.none")}</p>
        </div>
      )}
      {bookings.map((booking) => (
        <Card
          key={booking.id}
          className="flex items-center justify-between p-4"
        >
          <div className="flex-1 space-y-2">
            <h4 className="font-semibold">
              {localizeClass(booking.name, undefined, t).name}
            </h4>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <User size={14} />
                {booking.trainerName}
              </div>
              <div className="flex items-center gap-2">
                <Clock size={14} />
                {formatDateTime(booking.scheduledAt)}
              </div>
            </div>
            {booking.status === "waitlist" && (
              <div className="inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                {t("bookings.onWaitlistPosition", {
                  position: booking.waitlistPosition ?? "—",
                })}
              </div>
            )}
            {booking.lifecycleStatus === "promoted" &&
              booking.promotionExpiresAt && (
                <p className="text-xs font-medium text-amber-700">
                  {t("bookings.promotionDeadline", {
                    date: formatDateTime(booking.promotionExpiresAt),
                  })}
                </p>
              )}
            {booking.status === "confirmed" &&
              booking.lifecycleStatus !== "attended" &&
              booking.lifecycleStatus !== "absent" &&
              booking.lifecycleStatus !== "excused" &&
              isFutureClass(booking.scheduledAt) && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-slate-800">
                    {booking.reminderDue
                      ? t("bookings.reminderQuestion")
                      : t("bookings.intentionQuestion")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        booking.attendanceIntention === "yes"
                          ? "default"
                          : "outline"
                      }
                      disabled={updatingIntention === booking.id}
                      onClick={() => void handleIntention(booking.id, "yes")}
                    >
                      <Check size={15} /> {t("bookings.intentionYes")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        booking.attendanceIntention === "uncertain"
                          ? "default"
                          : "outline"
                      }
                      disabled={updatingIntention === booking.id}
                      onClick={() =>
                        void handleIntention(booking.id, "uncertain")
                      }
                    >
                      <CircleHelp size={15} />{" "}
                      {t("bookings.intentionUncertain")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updatingIntention === booking.id}
                      onClick={() => void handleIntention(booking.id, "no")}
                      className="text-red-700"
                    >
                      <X size={15} /> {t("bookings.intentionNo")}
                    </Button>
                  </div>
                </div>
              )}
          </div>

          {isFutureClass(booking.scheduledAt) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(booking.id)}
              disabled={cancelling === booking.id}
              className="ml-4"
              aria-label={t("bookings.cancelLabel")}
              title={t("bookings.cancelLabel")}
            >
              <Trash2 size={18} />
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

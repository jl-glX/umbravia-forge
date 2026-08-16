import { useEffect, useState } from "react";
import { Loader, AlertCircle, X, Download, BellRing } from "lucide-react";
import { Button } from "./ui/button";
import { useClassAttendees } from "../hooks/useClassAttendees";
import { useAuth } from "../hooks/useAuth";
import { formatDate, formatTime } from "../lib/dateUtils";
import { authFetch } from "../lib/api";
import { useTranslation } from "react-i18next";
import { localizeClass } from "../lib/classLocalization";
import { getAccessRole } from "../context/auth-context";

interface ClassDetailsModalProps {
  activitySessionId: string;
  className: string;
  scheduledAt: number;
  maxCapacity: number;
  bookedCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClassDetailsModal({
  activitySessionId,
  className,
  scheduledAt,
  maxCapacity,
  bookedCount,
  open,
  onOpenChange,
}: ClassDetailsModalProps) {
  const { t } = useTranslation();
  const { attendees, waitlist, loading, error, refreshAttendees } =
    useClassAttendees(activitySessionId);
  const { user } = useAuth();
  const [updatingBooking, setUpdatingBooking] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const accessRole = getAccessRole(user);
  const canExportCsv = accessRole === "trainer" || accessRole === "admin";
  const localizedClassName = localizeClass(className, undefined, t).name;

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  if (!open) return null;

  const handleExportCsv = async () => {
    try {
      const response = await authFetch(
        `/api/bookings/class/${activitySessionId}/export-csv`,
        {
          method: "GET",
        },
      );

      if (!response.ok) {
        throw new Error(t("classes.exportFailed"));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendees-${className.toLowerCase().replace(/\s+/g, "-")}-${new Date(scheduledAt).toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Error exporting CSV:", err);
      alert(t("classes.exportFailed"));
    }
  };

  const updateAttendance = async (
    bookingId: string,
    status: "attended" | "absent" | "excused",
  ) => {
    setUpdatingBooking(bookingId);
    try {
      const response = await authFetch(
        `/api/bookings/${bookingId}/attendance`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? t("classes.attendanceFailed"));
      setActionError("");
      await refreshAttendees();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUpdatingBooking(null);
    }
  };

  const recordReminder = async (bookingId: string) => {
    setUpdatingBooking(bookingId);
    try {
      const response = await authFetch(`/api/bookings/${bookingId}/reminder`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? t("classes.reminderFailed"));
      setActionError("");
      await refreshAttendees();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUpdatingBooking(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-details-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 sm:p-6 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h2
              id="class-details-title"
              className="text-2xl font-bold text-slate-900 line-clamp-2"
            >
              {localizedClassName}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {formatDate(scheduledAt)} {t("common.at")}{" "}
              {formatTime(scheduledAt)}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            aria-label={t("common.close")}
            className="shrink-0 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-6">
          {/* Capacity Overview */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">
              {t("common.capacity")}
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium text-slate-700">
                <span>{t("classes.booked")}</span>
                <span>
                  {bookedCount}/{maxCapacity}
                </span>
              </div>
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    bookedCount >= maxCapacity
                      ? "bg-red-500"
                      : bookedCount >= maxCapacity * 0.8
                        ? "bg-amber-500"
                        : "bg-green-500"
                  }`}
                  style={{ width: `${(bookedCount / maxCapacity) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-600 mt-2">
                {t("classes.spotsAvailable", {
                  count: maxCapacity - bookedCount,
                })}
              </p>
            </div>
          </div>

          {/* Error State */}
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {actionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {actionError}
            </div>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-slate-600 mr-2" />
              <span className="text-slate-600">
                {t("classes.loadingAttendees")}
              </span>
            </div>
          ) : (
            <>
              {/* Confirmed Attendees */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3">
                  {t("classes.confirmedAttendees", {
                    count: attendees.length,
                  })}
                </h3>
                {attendees.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                    <p className="text-sm text-gray-600">
                      {t("classes.noConfirmed")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attendees.map((attendee) => (
                      <div
                        key={attendee.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">
                            {attendee.name}
                          </p>
                          <p className="text-sm text-slate-600 truncate">
                            {attendee.email}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("classes.attendanceIntention")}:{" "}
                            {t(
                              `bookings.intentions.${attendee.attendanceIntention ?? "unanswered"}`,
                            )}
                          </p>
                        </div>
                        <div className="ml-3 flex flex-wrap justify-end gap-1">
                          {scheduledAt <= Date.now()
                            ? (["attended", "absent", "excused"] as const).map(
                                (status) => (
                                  <Button
                                    key={status}
                                    type="button"
                                    size="sm"
                                    variant={
                                      attendee.lifecycleStatus === status
                                        ? "default"
                                        : "outline"
                                    }
                                    disabled={
                                      updatingBooking === attendee.id ||
                                      attendee.lifecycleStatus === "attended" ||
                                      attendee.lifecycleStatus === "excused" ||
                                      (attendee.lifecycleStatus === "absent" &&
                                        status !== "excused")
                                    }
                                    onClick={() =>
                                      void updateAttendance(attendee.id, status)
                                    }
                                  >
                                    {t(`classes.attendance.${status}`)}
                                  </Button>
                                ),
                              )
                            : !["yes", "no"].includes(
                                attendee.attendanceIntention ?? "unanswered",
                              ) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingBooking === attendee.id}
                                  onClick={() =>
                                    void recordReminder(attendee.id)
                                  }
                                >
                                  <BellRing /> {t("classes.recordReminder")}
                                </Button>
                              )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Waitlist */}
              {waitlist.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">
                    {t("common.waitlist")} ({waitlist.length})
                  </h3>
                  <div className="space-y-2">
                    {waitlist.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50"
                      >
                        <div className="shrink-0 rounded-full bg-amber-200 w-6 h-6 flex items-center justify-center">
                          <span className="text-xs font-semibold text-amber-900">
                            {entry.position}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">
                            {entry.name}
                          </p>
                          <p className="text-sm text-slate-600 truncate">
                            {entry.email}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-6 flex gap-2">
          {canExportCsv && (
            <Button
              onClick={handleExportCsv}
              variant="outline"
              className="gap-2 flex-1"
            >
              <Download size={18} />
              {t("classes.exportCsv")}
            </Button>
          )}
          <Button
            onClick={() => onOpenChange(false)}
            className={canExportCsv ? "flex-1" : "w-full"}
            variant="outline"
          >
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

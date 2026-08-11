import { useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Loader,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { ClassCard } from "../components/ClassCard";
import { useClasses } from "../hooks/useClasses";
import { useBookings } from "../hooks/useBookings";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { groupClassesByDate } from "../lib/dateUtils";
import { formatDate } from "../lib/dateUtils";
import { useTranslation } from "react-i18next";
import { ClassManagement } from "../components/ClassManagement";
import { getAccessRole } from "../context/auth-context";

export function ClassesPage() {
  const user = useCurrentUser();
  const {
    classes,
    loading: classesLoading,
    error: classesError,
    refreshClasses,
  } = useClasses();
  const { bookings, bookClass } = useBookings(user?.id || "");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingInProgress, setBookingInProgress] = useState<string | null>(
    null,
  );
  const { t } = useTranslation();

  const userBookedClassIds = new Set(bookings.map((b) => b.classId));
  const groupedClasses = groupClassesByDate(classes);
  const sortedDates = Object.keys(groupedClasses).sort();
  const availableClasses = classes.filter(
    (gymClass) => gymClass.availablePlaces > 0,
  ).length;
  const totalPlaces = classes.reduce(
    (total, gymClass) => total + gymClass.availablePlaces,
    0,
  );

  const handleBook = async (classId: string) => {
    if (!user?.id) return;

    try {
      setBookingError(null);
      setBookingInProgress(classId);
      await bookClass(classId);
      await refreshClasses();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.unknownError");
      setBookingError(message);
    } finally {
      setBookingInProgress(null);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="mr-2 animate-spin" />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  if (getAccessRole(user) === "admin") {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
          <div className="mb-7">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
              {t("admin.operations")}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              {t("admin.classManagementTitle")}
            </h1>
            <p className="mt-2 text-slate-600">
              {t("admin.classManagementDescription")}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <ClassManagement />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[96rem] px-4 py-8 sm:px-6 sm:py-10 2xl:px-8">
        <section className="relative mb-10 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-2xl shadow-slate-900/10 sm:px-9 sm:py-10">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/25 blur-3xl" />
          <div className="absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-blue-100">
                <Sparkles size={15} />
                {t("classes.agenda")}
              </div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                {t("classes.title")}
              </h1>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                {t("classes.description")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 backdrop-blur-sm">
                <p className="text-2xl font-bold">{classes.length}</p>
                <p className="text-xs text-slate-300">
                  {t("classes.scheduled")}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 backdrop-blur-sm">
                <p className="text-2xl font-bold text-emerald-300">
                  {availableClasses}
                </p>
                <p className="text-xs text-slate-300">
                  {t("classes.available")}
                </p>
              </div>
              <div className="col-span-2 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 backdrop-blur-sm sm:col-span-1">
                <p className="text-2xl font-bold text-blue-300">
                  {totalPlaces}
                </p>
                <p className="text-xs text-slate-300">
                  {t("classes.openSpots")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
              {t("classes.schedule")}
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              {t("classes.upcoming")}
            </h2>
          </div>
          <Button
            onClick={refreshClasses}
            disabled={classesLoading}
            variant="outline"
            size="lg"
            className="gap-2 rounded-xl border-slate-200 bg-white shadow-sm hover:border-blue-200 hover:bg-blue-50"
          >
            <RefreshCw
              size={18}
              className={classesLoading ? "animate-spin" : ""}
            />
            {t("classes.refresh")}
          </Button>
        </div>

        {/* Error Messages */}
        {classesError && (
          <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <AlertCircle className="text-red-600" />
            <p className="text-red-800">{classesError}</p>
          </div>
        )}

        {bookingError && (
          <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
            <AlertCircle className="text-amber-600" />
            <p className="text-amber-800">{bookingError}</p>
          </div>
        )}

        {/* Loading State */}
        {classesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="mr-2 animate-spin" size={32} />
            <span className="text-lg">{t("common.loadingClasses")}</span>
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
            <AlertCircle className="mx-auto mb-4 text-gray-400" size={48} />
            <p className="text-gray-600">{t("classes.none")}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {sortedDates.map((date) => (
              <div key={date}>
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <CalendarDays size={19} />
                  </span>
                  <h3 className="text-xl font-bold capitalize text-slate-900">
                    {formatDate(groupedClasses[date][0].scheduledAt)}
                  </h3>
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-slate-200 sm:flex">
                    <Users size={14} />{" "}
                    {t("classes.count", { count: groupedClasses[date].length })}
                  </span>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedClasses[date].map((gymClass) => (
                    <ClassCard
                      key={gymClass.id}
                      id={gymClass.id}
                      name={gymClass.name}
                      description={gymClass.description}
                      trainerName={gymClass.trainerName}
                      scheduledAt={gymClass.scheduledAt}
                      maxCapacity={gymClass.maxCapacity}
                      bookedCount={gymClass.bookedCount}
                      availablePlaces={gymClass.availablePlaces}
                      waitlistCount={gymClass.waitlistCount}
                      onBookClick={() => handleBook(gymClass.id)}
                      isBooked={userBookedClassIds.has(gymClass.id)}
                      isLoading={bookingInProgress === gymClass.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

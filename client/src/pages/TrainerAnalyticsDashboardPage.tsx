import { AlertCircle, Loader } from "lucide-react";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  useTrainerActivityMetrics,
  useTrainerUpcomingClasses,
  useClassPopularity,
  usePeakHours,
} from "../hooks/useAnalytics";
import { MetricCard } from "../components/MetricCard";
import { UpcomingBookingsList } from "../components/UpcomingBookingsList";
import { PeakHoursChart } from "../components/PeakHoursChart";
import { ClassPopularityList } from "../components/ClassPopularityList";
import { useTranslation } from "react-i18next";
import { getAccessRole } from "../context/auth-context";

export function TrainerAnalyticsDashboardPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { data: trainerMetrics, loading: metricsLoading } =
    useTrainerActivityMetrics(user?.id || "");
  const { data: upcomingClasses, loading: classesLoading } =
    useTrainerUpcomingClasses(user?.id || "");
  const { data: allClassPopularity, loading: popularityLoading } =
    useClassPopularity();
  const { data: peakHours, loading: peakHoursLoading } = usePeakHours();

  if (!user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="mr-2 animate-spin" />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  if (getAccessRole(user) !== "trainer") {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
        <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
            <AlertCircle className="mx-auto mb-4 text-amber-600" size={48} />
            <p className="text-amber-800 font-medium">
              {t("unauthorized.title")}
            </p>
            <p className="mt-2 text-sm text-amber-700">
              {t("analytics.trainerOnly")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLoading =
    metricsLoading || classesLoading || popularityLoading || peakHoursLoading;

  // Filter popular classes by this trainer
  const trainerPopularClasses =
    allClassPopularity?.filter((cls) => {
      const upcomingClass = upcomingClasses?.find(
        (uc) => uc.id === cls.classId,
      );
      return upcomingClass !== undefined;
    }) || [];

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("analytics.trainerTitle")}
          </h1>
          <p className="mt-2 text-gray-600">
            {t("analytics.trainerDescription")}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="mr-2 animate-spin" />
            <span>{t("common.loadingAnalytics")}</span>
          </div>
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
              <MetricCard
                title={t("analytics.totalClasses")}
                value={trainerMetrics?.totalClasses || 0}
                subtitle={t("analytics.allClasses")}
              />
              <MetricCard
                title={t("analytics.totalBookings")}
                value={trainerMetrics?.totalBookings || 0}
                subtitle={t("analytics.acrossClasses")}
              />
              <MetricCard
                title={t("analytics.avgOccupancy")}
                value={`${trainerMetrics?.averageOccupancy || 0}%`}
                subtitle={t("analytics.classCapacity")}
              />
              <MetricCard
                title={t("analytics.uniqueMembers")}
                value={trainerMetrics?.totalMembers || 0}
                subtitle={t("analytics.registeredParticipants")}
              />
            </div>

            {/* Main Content Grid */}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              {/* Upcoming Classes */}
              <UpcomingBookingsList
                title={t("analytics.yourNextClasses")}
                data={
                  upcomingClasses?.map((cls) => ({
                    ...cls,
                    name: cls.name,
                    trainerName: cls.trainerName,
                  })) || []
                }
                limit={5}
              />

              {/* Peak Hours */}
              <PeakHoursChart
                title={t("analytics.gymPeakHours")}
                data={peakHours || []}
              />
            </div>

            {/* Trainer's Popular Classes */}
            {trainerPopularClasses.length > 0 && (
              <div className="mb-8">
                <ClassPopularityList
                  title={t("analytics.yourPopularClasses")}
                  data={trainerPopularClasses}
                  limit={5}
                />
              </div>
            )}

            {/* No Data State */}
            {(!trainerMetrics || trainerMetrics.totalClasses === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
                <AlertCircle
                  className="mx-auto mb-4 text-amber-600"
                  size={40}
                />
                <p className="text-amber-800 font-medium">
                  {t("analytics.noClasses")}
                </p>
                <p className="mt-2 text-sm text-amber-700">
                  {t("analytics.createClasses")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { AlertCircle, Loader } from "lucide-react";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  useMemberMetrics,
  useClassPopularity,
  usePeakHours,
  useMonthlyMetrics,
} from "../hooks/useAnalytics";
import { MetricCard } from "../components/MetricCard";
import { PeriodSelector } from "../components/PeriodSelector";
import { PeakHoursChart } from "../components/PeakHoursChart";
import { ClassPopularityList } from "../components/ClassPopularityList";
import { useTranslation } from "react-i18next";
import { getAccessRole } from "../context/auth-context";

type PeriodType = "day" | "week" | "month";

export function AdminAnalyticsDashboardPage() {
  const user = useCurrentUser();
  const [period, setPeriod] = useState<PeriodType>("month");
  const { t } = useTranslation();
  const { data: memberMetrics, loading: membersLoading } = useMemberMetrics();
  const { data: classPopularity, loading: popularityLoading } =
    useClassPopularity();
  const { data: peakHours, loading: peakHoursLoading } = usePeakHours();

  // Get current month metrics
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const { data: monthlyMetrics, loading: monthlyLoading } = useMonthlyMetrics(
    year,
    month,
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="mr-2 animate-spin" />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  if (getAccessRole(user) !== "admin") {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
        <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
            <AlertCircle className="mx-auto mb-4 text-amber-600" size={48} />
            <p className="text-amber-800 font-medium">
              {t("unauthorized.title")}
            </p>
            <p className="mt-2 text-sm text-amber-700">
              {t("analytics.adminOnly")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLoading =
    membersLoading || popularityLoading || peakHoursLoading || monthlyLoading;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("analytics.adminTitle")}
          </h1>
          <p className="mt-2 text-gray-600">
            {t("analytics.adminDescription")}
          </p>
        </div>

        {/* Period Selector */}
        <div className="mb-6">
          <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="mr-2 animate-spin" />
            <span>{t("common.loadingAnalytics")}</span>
          </div>
        ) : (
          <>
            {/* Member Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
              <MetricCard
                title={t("analytics.totalMembers")}
                value={memberMetrics?.totalMembers || 0}
                subtitle={t("analytics.registeredUsers")}
              />
              <MetricCard
                title={t("analytics.activeMembers")}
                value={memberMetrics?.activeMembers || 0}
                subtitle={t("analytics.last30Days")}
              />
              <MetricCard
                title={t("analytics.joinedWeek")}
                value={memberMetrics?.memberJoinedThisWeek || 0}
                subtitle={t("analytics.newMembers")}
              />
              <MetricCard
                title={t("analytics.joinedMonth")}
                value={memberMetrics?.memberJoinedThisMonth || 0}
                subtitle={t("analytics.thisMonth")}
              />
            </div>

            {/* Monthly Metrics */}
            {monthlyMetrics && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                <MetricCard
                  title={t("analytics.totalBookings")}
                  value={monthlyMetrics.totalBookings}
                  subtitle={t("analytics.thisMonthNumber", {
                    month: monthlyMetrics.month,
                  })}
                />
                <MetricCard
                  title={t("analytics.cancellations")}
                  value={monthlyMetrics.totalCancellations}
                  subtitle={t("analytics.thisMonth")}
                />
                <MetricCard
                  title={t("analytics.totalClasses")}
                  value={monthlyMetrics.totalClasses}
                  subtitle={t("analytics.thisMonth")}
                />
                <MetricCard
                  title={t("analytics.avgOccupancy")}
                  value={`${monthlyMetrics.averageOccupancy}%`}
                  subtitle={t("analytics.thisMonth")}
                />
              </div>
            )}

            {/* Main Content Grid */}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              {/* Peak Hours */}
              <PeakHoursChart
                title={t("analytics.gymPeakHours")}
                data={peakHours || []}
              />

              {/* Placeholder for other metrics */}
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="text-lg font-semibold mb-4">
                  {t("analytics.systemStatus")}
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">
                      {t("analytics.apiHealth")}
                    </span>
                    <span className="text-xs font-medium text-green-600 px-2 py-1 bg-green-50 rounded">
                      {t("analytics.operational")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">
                      {t("analytics.database")}
                    </span>
                    <span className="text-xs font-medium text-green-600 px-2 py-1 bg-green-50 rounded">
                      {t("analytics.connected")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Attendance comparison */}
            {classPopularity && classPopularity.length > 0 && (
              <div className="mb-8 grid gap-6 lg:grid-cols-2">
                <ClassPopularityList
                  title={t("analytics.popularClasses")}
                  data={classPopularity}
                  limit={5}
                />
                <ClassPopularityList
                  title={t("analytics.leastPopularClasses")}
                  data={[...classPopularity].reverse()}
                  limit={5}
                />
              </div>
            )}

            {/* No Data State */}
            {(!memberMetrics || memberMetrics.totalMembers === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
                <AlertCircle
                  className="mx-auto mb-4 text-amber-600"
                  size={40}
                />
                <p className="text-amber-800 font-medium">
                  {t("analytics.noSystemData")}
                </p>
                <p className="mt-2 text-sm text-amber-700">
                  {t("analytics.systemDataHint")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

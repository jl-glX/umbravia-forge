import { AlertCircle, Loader } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityPerformanceTable,
  ActivityTimeSlotTable,
  AnalyticsDataQuality,
  AnalyticsDecisionPanel,
  BookingHistoryPanel,
  MemberEngagementTable,
} from "../components/AnalyticsOverviewPanels";
import { MetricCard } from "../components/MetricCard";
import { AnalyticsSurveyManagement } from "../components/AnalyticsSurveyManagement";
import { AnalyticsSurveyResults } from "../components/AnalyticsSurveyResults";
import { PeakHoursChart } from "../components/PeakHoursChart";
import { PeriodSelector } from "../components/PeriodSelector";
import { getAccessRole } from "../context/auth-context";
import {
  useAnalyticsOverview,
  type AnalyticsPeriodType,
} from "../hooks/useAnalytics";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function AdminAnalyticsDashboardPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [period, setPeriod] = useState<AnalyticsPeriodType>("month");
  const { data, loading, error } = useAnalyticsOverview(period);

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
            <p className="font-medium text-amber-800">
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

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
        <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F07A3A]">
              Forge Analytics
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">
              {t("analytics.adminTitle")}
            </h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              {t("analytics.adminDescription")}
            </p>
          </div>
          <PeriodSelector selectedPeriod={period} onPeriodChange={setPeriod} />
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="mr-2 animate-spin" />
            <span>{t("common.loadingAnalytics")}</span>
          </div>
        ) : error || !data ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
            <p className="font-semibold">{t("analytics.loadError")}</p>
            <p className="mt-1 text-sm">{t("analytics.loadErrorHint")}</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title={t("analytics.totalClasses")}
                value={data.summary.sessions}
                subtitle={t(`analytics.period.${period}`)}
              />
              <MetricCard
                title={t("analytics.avgOccupancy")}
                value={`${data.summary.occupancyRate}%`}
                subtitle={t("analytics.weightedCapacity")}
              />
              <MetricCard
                title={t("analytics.attendanceLabel")}
                value={
                  data.summary.attendanceRate === null
                    ? "—"
                    : `${data.summary.attendanceRate}%`
                }
                subtitle={t("analytics.recordedAttendance")}
              />
              <MetricCard
                title={t("analytics.uniqueMembers")}
                value={data.summary.uniqueMembers}
                subtitle={t("analytics.activeInPeriod")}
              />
            </div>

            <AnalyticsDataQuality quality={data.dataQuality} />
            <AnalyticsSurveyManagement />
            <AnalyticsSurveyResults />
            <BookingHistoryPanel history={data.history} />

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <ActivityPerformanceTable activities={data.activities} />
              <AnalyticsDecisionPanel recommendations={data.recommendations} />
            </div>

            <ActivityTimeSlotTable timeSlots={data.timeSlots} />

            <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
              <PeakHoursChart
                title={t("analytics.gymPeakHours")}
                data={data.peakHours}
              />
              <MemberEngagementTable members={data.members} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

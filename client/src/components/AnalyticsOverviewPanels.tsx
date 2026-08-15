import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalyticsOverview } from "../hooks/useAnalytics";
import { localizeClass } from "../lib/classLocalization";
import { Card } from "./ui/card";

type Recommendation = AnalyticsOverview["recommendations"][number];

function recommendationIcon(priority: Recommendation["priority"]) {
  if (priority === "attention") {
    return <AlertTriangle className="mt-0.5 text-amber-600" size={19} />;
  }
  if (priority === "opportunity") {
    return <Lightbulb className="mt-0.5 text-emerald-600" size={19} />;
  }
  return <Info className="mt-0.5 text-slate-500" size={19} />;
}

export function AnalyticsDecisionPanel({
  recommendations,
}: {
  recommendations: AnalyticsOverview["recommendations"];
}) {
  const { t } = useTranslation();

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-slate-950">
        {t("analytics.decisionTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {t("analytics.decisionDescription")}
      </p>
      <div className="mt-5 space-y-3">
        {recommendations.length === 0 ? (
          <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 text-emerald-600" size={19} />
            <p className="text-sm text-emerald-900">
              {t("analytics.noRecommendation")}
            </p>
          </div>
        ) : (
          recommendations.map((recommendation, index) => (
            <div
              key={`${recommendation.code}-${recommendation.activityName ?? "all"}-${index}`}
              className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              {recommendationIcon(recommendation.priority)}
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {t(`analytics.recommendations.${recommendation.code}.title`, {
                    activity: recommendation.activityName,
                  })}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {t(`analytics.recommendations.${recommendation.code}.body`, {
                    activity: recommendation.activityName,
                    value: recommendation.observedValue,
                  })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function signedDelta(current: number, previous: number): string {
  const delta = current - previous;
  return delta > 0 ? `+${delta}` : String(delta);
}

export function BookingHistoryPanel({
  history,
}: {
  history: AnalyticsOverview["history"];
}) {
  const { t } = useTranslation();
  const metrics = [
    ["observedBookings", history.current.observedBookings],
    ["waitlistEntries", history.current.waitlistEntries],
    ["promotions", history.current.promotions],
    ["cancellations", history.current.cancellations],
    ["attended", history.current.attended],
    ["absent", history.current.absent],
  ] as const;

  return (
    <Card className="p-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            {t("analytics.historyTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("analytics.historyDescription")}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {t("analytics.historySources", {
            baseline: history.baselineEvents,
            live: history.liveEvents,
          })}
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map(([key, value]) => {
          const previous = history.previous[key];
          return (
            <div key={key} className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(`analytics.history.${key}`)}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t("analytics.vsPrevious", {
                  delta: signedDelta(value, previous),
                })}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ActivityPerformanceTable({
  activities,
}: {
  activities: AnalyticsOverview["activities"];
}) {
  const { t } = useTranslation();

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-950">
          {t("analytics.activityPerformance")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analytics.activityPerformanceDescription")}
        </p>
      </div>
      {activities.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">{t("common.noData")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">{t("analytics.activity")}</th>
                <th className="px-4 py-3">{t("analytics.sessions")}</th>
                <th className="px-4 py-3">{t("analytics.bookings")}</th>
                <th className="px-4 py-3">{t("analytics.occupancyLabel")}</th>
                <th className="px-4 py-3">{t("analytics.attendanceLabel")}</th>
                <th className="px-4 py-3">{t("analytics.waitlistDemand")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activities.map((activity) => (
                <tr key={activity.activityName} className="bg-white">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-950">
                      {localizeClass(activity.activityName, undefined, t).name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {activity.trainerName}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {activity.sessions}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {activity.confirmedBookings}
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-900">
                    {activity.occupancyRate}%
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {activity.attendanceRate === null
                      ? t("analytics.notMeasured")
                      : `${activity.attendanceRate}%`}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {activity.currentWaitlistDemand}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ActivityTimeSlotTable({
  timeSlots,
}: {
  timeSlots: AnalyticsOverview["timeSlots"];
}) {
  const { t } = useTranslation();

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-950">
          {t("analytics.timeSlotPerformance")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analytics.timeSlotPerformanceDescription")}
        </p>
      </div>
      {timeSlots.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">{t("common.noData")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">{t("analytics.activity")}</th>
                <th className="px-4 py-3">{t("analytics.schedule")}</th>
                <th className="px-4 py-3">{t("analytics.sessions")}</th>
                <th className="px-4 py-3">{t("analytics.bookings")}</th>
                <th className="px-4 py-3">{t("analytics.occupancyLabel")}</th>
                <th className="px-4 py-3">{t("analytics.attendanceLabel")}</th>
                <th className="px-4 py-3">{t("analytics.cancellations")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {timeSlots.map((timeSlot) => (
                <tr
                  key={`${timeSlot.activityName}-${timeSlot.weekday}-${timeSlot.hour}`}
                  className="bg-white"
                >
                  <td className="px-6 py-4 font-semibold text-slate-950">
                    {localizeClass(timeSlot.activityName, undefined, t).name}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {t(`analytics.weekdays.${timeSlot.weekday}`)} ·{" "}
                    {String(timeSlot.hour).padStart(2, "0")}:00
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {timeSlot.sessions}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {timeSlot.confirmedBookings}
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-900">
                    {timeSlot.occupancyRate}%
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {timeSlot.attendanceRate === null
                      ? t("analytics.notMeasured")
                      : `${timeSlot.attendanceRate}%`}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {timeSlot.cancellations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function MemberEngagementTable({
  members,
}: {
  members: AnalyticsOverview["members"];
}) {
  const { t, i18n } = useTranslation();

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-950">
          {t("analytics.memberEngagement")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analytics.memberEngagementDescription")}
        </p>
      </div>
      {members.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">{t("common.noData")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">{t("analytics.member")}</th>
                <th className="px-4 py-3">{t("analytics.bookings")}</th>
                <th className="px-4 py-3">{t("analytics.attended")}</th>
                <th className="px-4 py-3">{t("analytics.absent")}</th>
                <th className="px-4 py-3">{t("analytics.favoriteActivity")}</th>
                <th className="px-4 py-3">{t("analytics.lastSession")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.slice(0, 50).map((member) => (
                <tr key={member.userId} className="bg-white">
                  <td className="px-6 py-4 font-semibold text-slate-950">
                    {member.userName}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {member.bookedSessions}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {member.attendedSessions}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {member.absentSessions}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {member.favoriteActivity
                      ? localizeClass(member.favoriteActivity, undefined, t)
                          .name
                      : t("analytics.notMeasured")}
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {member.lastSessionAt
                      ? new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "medium",
                        }).format(member.lastSessionAt)
                      : t("analytics.notMeasured")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function AnalyticsDataQuality({
  quality,
}: {
  quality: AnalyticsOverview["dataQuality"];
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-semibold">{t("analytics.dataQualityTitle")}</p>
      <p className="mt-1">
        {quality.attendanceCoverageRate === null
          ? t("analytics.noAttendanceCoverage")
          : t("analytics.attendanceCoverage", {
              value: quality.attendanceCoverageRate,
            })}
      </p>
      <p className="mt-1 text-sky-800">{t("analytics.surveyCausalityHint")}</p>
    </div>
  );
}

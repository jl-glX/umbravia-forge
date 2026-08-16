import { Card } from "./ui/card";
import { useTranslation } from "react-i18next";
import { localizeClass } from "../lib/classLocalization";

interface ClassPopularityData {
  activitySessionId: string;
  className: string;
  trainerName: string;
  totalBookings: number;
  averageOccupancy: number;
  nextScheduledAt: number | null;
}

interface ClassPopularityListProps {
  title: string;
  data: ClassPopularityData[];
  limit?: number;
}

export function ClassPopularityList({
  title,
  data,
  limit = 10,
}: ClassPopularityListProps) {
  const { t } = useTranslation();
  const topClasses = data.slice(0, limit);

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      {topClasses.length === 0 ? (
        <p className="text-sm text-gray-400">{t("classes.none")}</p>
      ) : (
        <div className="space-y-3">
          {topClasses.map((item, index) => (
            <div
              key={item.activitySessionId}
              className="flex items-start justify-between pb-3 border-b border-gray-200 last:border-0"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-500">
                    #{index + 1}
                  </span>
                  <div>
                    <p className="font-medium text-sm">
                      {localizeClass(item.className, undefined, t).name}
                    </p>
                    <p className="text-xs text-gray-500">{item.trainerName}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-sm">{item.totalBookings}</p>
                <p className="text-xs text-gray-500">
                  {t("analytics.occupancy", { value: item.averageOccupancy })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

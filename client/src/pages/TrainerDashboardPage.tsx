import { useState, useMemo } from "react";
import { AlertCircle, Loader, RefreshCw, Filter } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { TrainerClassCard } from "../components/TrainerClassCard";
import { ClassDetailsModal } from "../components/ClassDetailsModal";
import { useTrainerClasses } from "../hooks/useTrainerClasses";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  formatDate,
  groupClassesByDate,
  isFutureClass,
} from "../lib/dateUtils";
import { useTranslation } from "react-i18next";
import { getAccessRole } from "../context/auth-context";

export function TrainerDashboardPage() {
  const user = useCurrentUser();
  const { classes, loading, error, refreshClasses } = useTrainerClasses(
    user?.id || "",
  );
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [showPastClasses, setShowPastClasses] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useTranslation();

  const filteredClasses = useMemo(() => {
    return classes.filter((cls) => {
      const matchesSearch = cls.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesStatus = showPastClasses || isFutureClass(cls.scheduledAt);
      return matchesSearch && matchesStatus;
    });
  }, [classes, searchQuery, showPastClasses]);

  const groupedClasses = groupClassesByDate(filteredClasses);
  const sortedDates = Object.keys(groupedClasses).sort();

  const selectedClass = classes.find((c) => c.id === selectedClassId);

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
            <p className="text-amber-800 font-medium">{t("trainer.only")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900">
            {t("trainer.title")}
          </h1>
          <p className="mt-2 text-gray-600">{t("trainer.description")}</p>
        </div>

        {/* Controls */}
        <div className="mb-8 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1 w-full sm:w-auto">
              <Input
                type="text"
                placeholder={t("trainer.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="flex gap-2 items-center">
              <Button
                onClick={() => setShowPastClasses(!showPastClasses)}
                variant={showPastClasses ? "default" : "outline"}
                size="sm"
                className="gap-2"
              >
                <Filter size={16} />
                {showPastClasses
                  ? t("trainer.showingPast")
                  : t("trainer.futureOnly")}
              </Button>

              <Button
                onClick={refreshClasses}
                disabled={loading}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw size={16} />
                {t("common.refresh")}
              </Button>
            </div>
          </div>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <AlertCircle className="text-red-600" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="mr-2 animate-spin" size={32} />
            <span className="text-lg">{t("trainer.loading")}</span>
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
            <AlertCircle className="mx-auto mb-4 text-gray-400" size={48} />
            <p className="text-gray-600">{t("trainer.noneAssigned")}</p>
          </div>
        ) : filteredClasses.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
            <AlertCircle className="mx-auto mb-4 text-gray-400" size={48} />
            <p className="text-gray-600">{t("trainer.noResults")}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedDates.map((date) => (
              <div key={date}>
                <h2 className="mb-4 text-2xl font-bold text-slate-800">
                  {formatDate(groupedClasses[date][0].scheduledAt)}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedClasses[date].map((activitySession) => (
                    <TrainerClassCard
                      key={activitySession.id}
                      id={activitySession.id}
                      name={activitySession.name}
                      scheduledAt={activitySession.scheduledAt}
                      maxCapacity={activitySession.maxCapacity}
                      bookedCount={activitySession.bookedCount}
                      availablePlaces={activitySession.availablePlaces}
                      waitlistCount={activitySession.waitlistCount}
                      onClick={() => setSelectedClassId(activitySession.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Class Details Modal */}
      {selectedClass && (
        <ClassDetailsModal
          activitySessionId={selectedClass.id}
          className={selectedClass.name}
          scheduledAt={selectedClass.scheduledAt}
          maxCapacity={selectedClass.maxCapacity}
          bookedCount={selectedClass.bookedCount}
          open={!!selectedClassId}
          onOpenChange={(open) => {
            if (!open) setSelectedClassId(null);
          }}
        />
      )}
    </div>
  );
}

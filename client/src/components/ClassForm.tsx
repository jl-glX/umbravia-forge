import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { useAdminClasses, type AdminClass } from "../hooks/useAdminClasses";
import { useUsers } from "../hooks/useUsers";
import { useTranslation } from "react-i18next";
import { VerifiedForm } from "./VerifiedForm";

interface ClassFormProps {
  activitySession?: AdminClass | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClassForm({
  activitySession,
  onClose,
  onSuccess,
}: ClassFormProps) {
  const { t } = useTranslation();
  const { createClassSeries, updateClass, updateBookingOpening } =
    useAdminClasses();
  const { users } = useUsers();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trainers = users.filter((u) => u.role === "trainer");

  const [formData, setFormData] = useState({
    name: activitySession?.name || "",
    description: activitySession?.description || "",
    trainerId:
      activitySession?.trainerId || (trainers.length > 0 ? trainers[0].id : ""),
    trainerName:
      activitySession?.trainerName ||
      (trainers.length > 0 ? trainers[0].name : ""),
    maxCapacity: activitySession?.maxCapacity || 20,
    occurrences: [
      activitySession
        ? new Date(activitySession.scheduledAt).toISOString().slice(0, 16)
        : "",
    ],
    bookingOpensHoursBefore:
      activitySession?.bookingConfiguration.bookingOpensAt === null ||
      activitySession?.bookingConfiguration.bookingOpensAt === undefined
        ? ""
        : String(
            Math.max(
              0,
              Math.round(
                (activitySession.scheduledAt -
                  activitySession.bookingConfiguration.bookingOpensAt) /
                  3_600_000,
              ),
            ),
          ),
  });

  useEffect(() => {
    if (formData.trainerId && !activitySession) {
      const trainer = trainers.find((t) => t.id === formData.trainerId);
      if (trainer) {
        setFormData((prev) => ({ ...prev, trainerName: trainer.name }));
      }
    }
  }, [formData.trainerId, trainers, activitySession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const occurrenceValues = formData.occurrences.filter(Boolean);
      if (occurrenceValues.length < 1) {
        setError(t("admin.dateRequired"));
        setLoading(false);
        return;
      }

      const occurrences = occurrenceValues.map((value) =>
        new Date(value).getTime(),
      );
      if (occurrences.some((value) => !Number.isFinite(value))) {
        setError(t("admin.dateRequired"));
        setLoading(false);
        return;
      }
      const bookingOpensMinutesBefore =
        formData.bookingOpensHoursBefore === ""
          ? null
          : Math.round(Number(formData.bookingOpensHoursBefore) * 60);

      if (activitySession) {
        const scheduledAt = occurrences[0];
        await updateClass(activitySession.id, {
          name: formData.name,
          description: formData.description,
          trainerId: formData.trainerId,
          trainerName: formData.trainerName,
          maxCapacity: Number(formData.maxCapacity),
          scheduledAt,
        });
        await updateBookingOpening(
          activitySession.id,
          bookingOpensMinutesBefore === null
            ? null
            : scheduledAt - bookingOpensMinutesBefore * 60_000,
        );
      } else {
        await createClassSeries({
          name: formData.name,
          description: formData.description,
          trainerId: formData.trainerId,
          trainerName: formData.trainerName,
          maxCapacity: Number(formData.maxCapacity),
          occurrences,
          bookingOpensMinutesBefore,
        });
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknownError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div className="mx-4 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6">
        <h2 className="text-xl font-bold mb-4">
          {activitySession ? t("admin.editClass") : t("admin.createClass")}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <VerifiedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("admin.className")}
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("common.description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("common.trainer")} *
            </label>
            <select
              required
              value={formData.trainerId}
              onChange={(e) => {
                const trainer = trainers.find((t) => t.id === e.target.value);
                setFormData({
                  ...formData,
                  trainerId: e.target.value,
                  trainerName: trainer?.name || "",
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">{t("admin.selectTrainer")}</option>
              {trainers.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-gray-700">
                  {activitySession
                    ? t("common.dateTime")
                    : t("admin.classDatesAndTimes")}{" "}
                  *
                </label>
                {!activitySession && formData.occurrences.length < 31 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        occurrences: [...formData.occurrences, ""],
                      })
                    }
                  >
                    <Plus size={14} />
                    {t("admin.addClassDate")}
                  </Button>
                )}
              </div>
              {formData.occurrences.map((occurrence, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="datetime-local"
                    required
                    value={occurrence}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        occurrences: formData.occurrences.map(
                          (value, itemIndex) =>
                            itemIndex === index ? event.target.value : value,
                        ),
                      })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  {!activitySession && formData.occurrences.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t("admin.removeClassDate")}
                      onClick={() =>
                        setFormData({
                          ...formData,
                          occurrences: formData.occurrences.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              ))}
              {!activitySession && (
                <p className="text-xs text-gray-500">
                  {t("admin.classDatesHint")}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("admin.maxCapacity")}
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.maxCapacity}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxCapacity: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("admin.bookingOpeningHours")}
            </label>
            <input
              type="number"
              min="0"
              max="8760"
              step="1"
              value={formData.bookingOpensHoursBefore}
              onChange={(event) =>
                setFormData({
                  ...formData,
                  bookingOpensHoursBefore: event.target.value,
                })
              }
              placeholder={t("admin.bookingOpeningImmediate")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              {t("admin.bookingOpeningHint")}
            </p>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={loading}>
              {loading ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </VerifiedForm>
      </div>
    </div>
  );
}

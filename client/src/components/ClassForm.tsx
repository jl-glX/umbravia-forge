import { useState, useEffect } from "react";
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
  const { createClass, updateClass } = useAdminClasses();
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
    scheduledAt: activitySession
      ? new Date(activitySession.scheduledAt).toISOString().slice(0, 16)
      : "",
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
      if (!formData.scheduledAt) {
        setError(t("admin.dateRequired"));
        setLoading(false);
        return;
      }

      const scheduledAt = new Date(formData.scheduledAt).getTime();

      if (activitySession) {
        await updateClass(activitySession.id, {
          name: formData.name,
          description: formData.description,
          trainerId: formData.trainerId,
          trainerName: formData.trainerName,
          maxCapacity: Number(formData.maxCapacity),
          scheduledAt,
        });
      } else {
        await createClass({
          name: formData.name,
          description: formData.description,
          trainerId: formData.trainerId,
          trainerName: formData.trainerName,
          maxCapacity: Number(formData.maxCapacity),
          scheduledAt,
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("common.dateTime")} *
              </label>
              <input
                type="datetime-local"
                required
                value={formData.scheduledAt}
                onChange={(e) =>
                  setFormData({ ...formData, scheduledAt: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
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

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={onClose} disabled={loading}>
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

import { useState } from "react";
import { CheckSquare2, Trash2, Edit2, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { useAdminClasses, type AdminClass } from "../hooks/useAdminClasses";
import { useUsers } from "../hooks/useUsers";
import { ClassForm } from "./ClassForm";
import { formatDate } from "../lib/dateUtils";
import { useTranslation } from "react-i18next";
import { localizeClass } from "../lib/classLocalization";
import { ConfirmDialog } from "./ui/confirm-dialog";

export function ClassManagement() {
  const { t } = useTranslation();
  const {
    classes,
    loading,
    error,
    deleteClass,
    deleteMultipleClasses,
    refreshClasses,
  } = useAdminClasses();
  const { users } = useUsers();
  const [showForm, setShowForm] = useState(false);
  const [editingClass, setEditingClass] = useState<AdminClass | null>(null);
  const [filterTrainer, setFilterTrainer] = useState<string>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [deleteRequest, setDeleteRequest] = useState<{
    ids: string[];
    label?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  const trainers = users.filter((u) => u.role === "trainer");
  const filteredClasses =
    filterTrainer === "all"
      ? classes
      : classes.filter((c) => c.trainerId === filterTrainer);

  const confirmDelete = async () => {
    if (!deleteRequest) return;
    setDeleting(true);
    setActionNotice("");
    try {
      if (deleteRequest.ids.length === 1) {
        await deleteClass(deleteRequest.ids[0]);
        setSelectedClassIds((current) =>
          current.filter((id) => id !== deleteRequest.ids[0]),
        );
        setActionNotice(t("admin.classDeleted"));
      } else {
        const result = await deleteMultipleClasses(deleteRequest.ids);
        setSelectedClassIds(result.failed.map((item) => item.id));
        setActionNotice(
          result.failed.length
            ? t("admin.classesDeletePartial", {
                deleted: result.deletedIds.length,
                protected: result.failed.length,
              })
            : t("admin.classesDeleted", { count: result.deletedIds.length }),
        );
      }
      setDeleteRequest(null);
    } catch (err) {
      setActionNotice(
        err instanceof Error && err.message.includes("related activity exists")
          ? t("admin.classDeletionProtected")
          : err instanceof Error
            ? err.message
            : t("common.unknownError"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const selectableClasses = filteredClasses.filter(
    (activitySession) =>
      activitySession.bookedCount === 0 && activitySession.waitlistCount === 0,
  );

  const toggleSelectionMode = () => {
    setSelectionMode((current) => !current);
    setSelectedClassIds([]);
    setActionNotice("");
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingClass(null);
  };

  const handleFormSuccess = () => {
    refreshClasses();
    handleFormClose();
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-600">
        {t("common.loadingClasses")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-600">
        {t("common.errorPrefix", { error })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actionNotice && (
        <div
          role="status"
          className="rounded-xl border border-brand-path/25 bg-brand-path/10 px-4 py-3 text-sm text-brand-slate"
        >
          {actionNotice}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center">
          <label className="text-sm font-medium text-gray-700">
            {t("admin.filterTrainer")}
          </label>
          <select
            value={filterTrainer}
            onChange={(e) => setFilterTrainer(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">{t("admin.allTrainers")}</option>
            {trainers.map((trainer) => (
              <option key={trainer.id} value={trainer.id}>
                {trainer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {selectionMode && selectedClassIds.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeleteRequest({ ids: selectedClassIds })}
            >
              <Trash2 aria-hidden="true" />
              {t("admin.deleteSelectedClasses", {
                count: selectedClassIds.length,
              })}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={toggleSelectionMode}>
            {selectionMode ? (
              <X aria-hidden="true" />
            ) : (
              <CheckSquare2 aria-hidden="true" />
            )}
            {selectionMode
              ? t("admin.cancelClassSelection")
              : t("admin.selectClasses")}
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus size={16} className="mr-1" />
            {t("admin.newClass")}
          </Button>
        </div>
      </div>

      {selectionMode && selectableClasses.length > 0 && (
        <label className="flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-brand-slate">
          <input
            type="checkbox"
            checked={
              selectableClasses.length > 0 &&
              selectableClasses.every((activitySession) =>
                selectedClassIds.includes(activitySession.id),
              )
            }
            onChange={(event) =>
              setSelectedClassIds(
                event.target.checked
                  ? selectableClasses.map(
                      (activitySession) => activitySession.id,
                    )
                  : [],
              )
            }
          />
          {t("admin.selectAllDeletableClasses")}
        </label>
      )}

      {showForm && (
        <ClassForm
          activitySession={editingClass}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}

      {filteredClasses.length === 0 ? (
        <div className="text-center py-8 text-gray-600">
          {t("admin.noClasses")}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredClasses.map((activitySession) => (
            <div
              key={activitySession.id}
              className={`rounded-2xl border bg-white p-4 transition ${
                selectedClassIds.includes(activitySession.id)
                  ? "border-brand-path ring-2 ring-brand-path/15"
                  : "border-gray-200 hover:border-brand-steel/50"
              }`}
            >
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                {selectionMode && (
                  <label className="flex items-start gap-2 text-sm text-brand-slate">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedClassIds.includes(activitySession.id)}
                      disabled={
                        activitySession.bookedCount > 0 ||
                        activitySession.waitlistCount > 0
                      }
                      aria-label={t("admin.selectClass", {
                        name: activitySession.name,
                      })}
                      onChange={() =>
                        setSelectedClassIds((current) =>
                          current.includes(activitySession.id)
                            ? current.filter((id) => id !== activitySession.id)
                            : [...current, activitySession.id],
                        )
                      }
                    />
                    {(activitySession.bookedCount > 0 ||
                      activitySession.waitlistCount > 0) && (
                      <span className="text-xs text-amber-700">
                        {t("admin.classHasActivity")}
                      </span>
                    )}
                  </label>
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">
                    {
                      localizeClass(
                        activitySession.name,
                        activitySession.description,
                        t,
                      ).name
                    }
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {
                      localizeClass(
                        activitySession.name,
                        activitySession.description,
                        t,
                      ).description
                    }
                  </p>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-gray-600">{t("common.trainer")}</p>
                      <p className="font-medium text-gray-900">
                        {activitySession.trainerName}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t("common.dateTime")}</p>
                      <p className="font-medium text-gray-900">
                        {formatDate(activitySession.scheduledAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t("common.capacity")}</p>
                      <p className="font-medium text-gray-900">
                        {activitySession.bookedCount}/
                        {activitySession.maxCapacity}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t("common.waitlist")}</p>
                      <p className="font-medium text-gray-900">
                        {activitySession.waitlistCount}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end sm:justify-start">
                  {!selectionMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingClass(activitySession);
                        setShowForm(true);
                      }}
                    >
                      <Edit2 size={16} />
                    </Button>
                  )}
                  {!selectionMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDeleteRequest({
                          ids: [activitySession.id],
                          label: localizeClass(
                            activitySession.name,
                            activitySession.description,
                            t,
                          ).name,
                        })
                      }
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteRequest)}
        title={
          deleteRequest?.ids.length === 1
            ? t("admin.deleteClassTitle")
            : t("admin.deleteClassesTitle", {
                count: deleteRequest?.ids.length ?? 0,
              })
        }
        description={
          deleteRequest?.ids.length === 1
            ? t("admin.deleteClassDescription", {
                name: deleteRequest.label ?? "",
              })
            : t("admin.deleteClassesDescription", {
                count: deleteRequest?.ids.length ?? 0,
              })
        }
        confirmLabel={deleting ? t("common.loading") : t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={deleting}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

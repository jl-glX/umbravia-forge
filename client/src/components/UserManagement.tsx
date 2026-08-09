import { useState } from "react";
import { Trash2, Edit2, Plus } from "lucide-react";
import { Button } from "./ui/button";
import {
  isUserRole,
  useUsers,
  UserActionError,
  type User,
  type UserRole,
} from "../hooks/useUsers";
import { UserForm } from "./UserForm";
import { formatDate } from "../lib/dateUtils";
import { useTranslation } from "react-i18next";

export function UserManagement() {
  const { t } = useTranslation();
  const {
    users,
    loading,
    error,
    deleteUser,
    deleteMultipleUsers,
    updateUserRole,
    refreshUsers,
  } = useUsers();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState<"all" | UserRole>("all");
  const [actionError, setActionError] = useState("");

  const reportActionError = (error: unknown) => {
    setActionError(
      error instanceof UserActionError &&
        error.code === "USER_DELETION_REQUIRES_REVIEW"
        ? t("admin.deletionReviewRequired")
        : error instanceof Error
          ? error.message
          : t("common.unknownError"),
    );
  };

  const filteredUsers =
    filterRole === "all" ? users : users.filter((u) => u.role === filterRole);

  const handleSelectUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  };

  const handleSelectAll = () => {
    setSelectedUsers(
      selectedUsers.length === filteredUsers.length
        ? []
        : filteredUsers.map((u) => u.id),
    );
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm(t("admin.deleteUserConfirm"))) {
      setActionError("");
      try {
        await deleteUser(userId);
      } catch (err) {
        reportActionError(err);
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedUsers.length === 0) return;
    if (
      confirm(t("admin.deleteUsersConfirm", { count: selectedUsers.length }))
    ) {
      setActionError("");
      try {
        await deleteMultipleUsers(selectedUsers);
        setSelectedUsers([]);
      } catch (err) {
        reportActionError(err);
      }
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setActionError("");
    try {
      await updateUserRole(userId, newRole);
    } catch (err) {
      reportActionError(err);
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingUser(null);
  };

  const handleFormSuccess = () => {
    refreshUsers();
    handleFormClose();
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-600">
        {t("common.loading")}
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
      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {actionError}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center">
          <label className="text-sm font-medium text-gray-700">
            {t("admin.filterRole")}
          </label>
          <select
            value={filterRole}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "all" || isUserRole(value)) {
                setFilterRole(value);
              }
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">{t("admin.allRoles")}</option>
            <option value="member">{t("admin.members")}</option>
            <option value="trainer">{t("admin.trainers")}</option>
            <option value="admin">{t("admin.admins")}</option>
          </select>
        </div>

        <div className="flex gap-2">
          {selectedUsers.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
            >
              {t("admin.deleteSelected", { count: selectedUsers.length })}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus size={16} className="mr-1" />
            {t("admin.newUser")}
          </Button>
        </div>
      </div>

      {showForm && (
        <UserForm
          user={editingUser}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}

      {filteredUsers.length === 0 ? (
        <div className="text-center py-8 text-gray-600">
          {t("admin.noUsers")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  <input
                    type="checkbox"
                    checked={
                      selectedUsers.length === filteredUsers.length &&
                      filteredUsers.length > 0
                    }
                    onChange={handleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  {t("common.name")}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  {t("common.email")}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  {t("common.role")}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  {t("common.created")}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-900">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => handleSelectUser(user.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => {
                        if (isUserRole(e.target.value)) {
                          void handleRoleChange(user.id, e.target.value);
                        }
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="member">{t("roles.member")}</option>
                      <option value="trainer">{t("roles.trainer")}</option>
                      <option value="admin">{t("roles.admin")}</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingUser(user);
                        setShowForm(true);
                      }}
                    >
                      <Edit2 size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteUser(user.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

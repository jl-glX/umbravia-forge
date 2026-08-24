import { useState } from "react";
import { Trash2, Edit2, Plus, XCircle } from "lucide-react";
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
import { ConfirmDialog } from "./ui/confirm-dialog";

export function UserManagement() {
  const { t } = useTranslation();
  const {
    users,
    invitations,
    loading,
    error,
    deleteUser,
    deleteMultipleUsers,
    updateUserRole,
    revokeInvitation,
    refreshUsers,
  } = useUsers();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState<"all" | UserRole>("all");
  const [actionError, setActionError] = useState("");
  const [deleteRequest, setDeleteRequest] = useState<{
    ids: string[];
    label?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState("");

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

  const confirmDelete = async () => {
    if (!deleteRequest) return;
    setActionError("");
    setDeleting(true);
    try {
      if (deleteRequest.ids.length === 1) {
        await deleteUser(deleteRequest.ids[0]);
        setSelectedUsers((current) =>
          current.filter((id) => id !== deleteRequest.ids[0]),
        );
      } else {
        await deleteMultipleUsers(deleteRequest.ids);
        setSelectedUsers([]);
      }
      setDeleteRequest(null);
    } catch (err) {
      reportActionError(err);
    } finally {
      setDeleting(false);
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
    void refreshUsers();
    handleFormClose();
  };

  const handleRevokeInvitation = async (id: string) => {
    setActionError("");
    setRevokingInvitationId(id);
    try {
      await revokeInvitation(id);
    } catch (error) {
      reportActionError(error);
    } finally {
      setRevokingInvitationId("");
    }
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
          <label
            htmlFor="user-role-filter"
            className="text-sm font-medium text-gray-700"
          >
            {t("admin.filterRole")}
          </label>
          <select
            id="user-role-filter"
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
              onClick={() => setDeleteRequest({ ids: selectedUsers })}
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
                    aria-label={t("admin.selectAllUsers")}
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
                      aria-label={t("admin.selectUser", { name: user.name })}
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => handleSelectUser(user.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`${t("common.role")}: ${user.name}`}
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
                      onClick={() =>
                        setDeleteRequest({ ids: [user.id], label: user.name })
                      }
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
      <section className="space-y-3 border-t pt-5">
        <div>
          <h3 className="font-semibold text-gray-900">
            {t("admin.pendingInvitations")}
          </h3>
          <p className="text-sm text-gray-600">
            {t("admin.pendingInvitationsDescription")}
          </p>
        </div>
        {invitations.filter((item) => item.status === "pending").length ===
        0 ? (
          <p className="text-sm text-gray-600">
            {t("admin.noPendingInvitations")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">{t("common.name")}</th>
                  <th className="px-4 py-3 text-left">{t("common.email")}</th>
                  <th className="px-4 py-3 text-left">{t("common.role")}</th>
                  <th className="px-4 py-3 text-left">
                    {t("admin.invitationExpires")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invitations
                  .filter((item) => item.status === "pending")
                  .map((invitation) => (
                    <tr key={invitation.id}>
                      <td className="px-4 py-3">{invitation.invitedName}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {invitation.invitedEmail}
                      </td>
                      <td className="px-4 py-3">
                        {t(`roles.${invitation.role}`)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(invitation.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokingInvitationId === invitation.id}
                          onClick={() =>
                            void handleRevokeInvitation(invitation.id)
                          }
                        >
                          <XCircle size={16} className="mr-1" />
                          {t("admin.revokeInvitation")}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(deleteRequest)}
        title={
          deleteRequest?.ids.length === 1
            ? t("admin.deleteUserTitle")
            : t("admin.deleteUsersTitle", {
                count: deleteRequest?.ids.length ?? 0,
              })
        }
        description={
          deleteRequest?.ids.length === 1
            ? t("admin.deleteUserDescription", {
                name: deleteRequest.label ?? "",
              })
            : t("admin.deleteUsersDescription", {
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

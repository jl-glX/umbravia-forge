import { useState } from "react";
import { Trash2, Edit2, Plus, XCircle } from "lucide-react";
import { Button } from "./ui/button";
import {
  useUsers,
  UserActionError,
  type User,
  type WorkforceRole,
} from "../hooks/useUsers";
import { UserForm } from "./UserForm";
import { formatDate } from "../lib/dateUtils";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { useCurrentUser } from "../hooks/useCurrentUser";

const classPermissions = [
  "classes.create",
  "classes.update",
  "classes.delete",
] as const;

export function UserManagement() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isFacilityOwner = currentUser?.facility?.role === "owner";
  const {
    users,
    invitations,
    memberAffiliationPolicy,
    loading,
    error,
    deleteUser,
    deleteMultipleUsers,
    updateWorkforceRoles,
    updateClassPermissions,
    updateMemberAffiliationPolicy,
    revokeInvitation,
    refreshUsers,
  } = useUsers();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [invitationRole, setInvitationRole] = useState<"worker" | "member">(
    "worker",
  );
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState<"all" | WorkforceRole>("all");
  const [actionError, setActionError] = useState("");
  const [deleteRequest, setDeleteRequest] = useState<{
    ids: string[];
    label?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState("");
  const [savingMemberPolicy, setSavingMemberPolicy] = useState(false);

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

  const workforceUsers = users.filter((user) => user.facilityRole !== "member");
  const filteredUsers =
    filterRole === "all"
      ? workforceUsers
      : workforceUsers.filter((user) => user.roles.includes(filterRole));

  const handleSelectUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  };

  const handleSelectAll = () => {
    const selectableUsers = filteredUsers.filter(
      (user) => user.facilityRole !== "owner",
    );
    setSelectedUsers(
      selectedUsers.length === selectableUsers.length
        ? []
        : selectableUsers.map((user) => user.id),
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

  const handleWorkforceRoleChange = async (
    user: User,
    role: WorkforceRole,
    checked: boolean,
  ) => {
    const current = user.roles.filter(
      (item): item is WorkforceRole => item !== "member",
    );
    const next = checked
      ? Array.from(new Set([...current, role]))
      : current.filter((item) => item !== role);
    if (next.length === 0) return;
    setActionError("");
    try {
      await updateWorkforceRoles(user.id, next);
    } catch (err) {
      reportActionError(err);
    }
  };

  const handleClassPermissionChange = async (
    user: User,
    permission: (typeof classPermissions)[number],
    effect: "inherit" | "allow" | "deny",
  ) => {
    const next = { ...user.classPermissions };
    if (effect === "inherit") delete next[permission];
    else next[permission] = effect;
    setActionError("");
    try {
      await updateClassPermissions(user.id, next);
    } catch (error) {
      reportActionError(error);
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingUser(null);
    setInvitationRole("worker");
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

  const saveMemberAffiliationPolicy = async (
    allowAllStaff: boolean,
    specificallyAllowedUserIds: string[],
  ) => {
    setActionError("");
    setSavingMemberPolicy(true);
    try {
      await updateMemberAffiliationPolicy(
        allowAllStaff,
        specificallyAllowedUserIds,
      );
    } catch (error) {
      reportActionError(error);
    } finally {
      setSavingMemberPolicy(false);
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
              if (value === "all" || value === "trainer" || value === "admin") {
                setFilterRole(value);
              }
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">{t("admin.allRoles")}</option>
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
          <Button
            size="sm"
            onClick={() => {
              setInvitationRole("worker");
              setShowForm(true);
            }}
          >
            <Plus size={16} className="mr-1" />
            {t("admin.newUser")}
          </Button>
        </div>
      </div>

      {showForm && (
        <UserForm
          user={editingUser}
          invitationRole={invitationRole}
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
                      selectedUsers.length ===
                        filteredUsers.filter(
                          (user) => user.facilityRole !== "owner",
                        ).length && selectedUsers.length > 0
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
                      disabled={user.facilityRole === "owner"}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {user.roles.map((role) => (
                          <span
                            key={role}
                            className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                          >
                            {t(`roles.${role}`)}
                          </span>
                        ))}
                        {user.facilityRole === "owner" && (
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
                            {t("roles.owner")}
                          </span>
                        )}
                      </div>
                      {isFacilityOwner && user.role !== "member" && (
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                          {(["trainer", "admin"] as const).map((role) => {
                            const checked = user.roles.includes(role);
                            const onlyRole =
                              user.roles.filter((item) => item !== "member")
                                .length === 1 && checked;
                            return (
                              <label
                                key={role}
                                className="flex items-center gap-1"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={onlyRole}
                                  onChange={(event) =>
                                    void handleWorkforceRoleChange(
                                      user,
                                      role,
                                      event.target.checked,
                                    )
                                  }
                                />
                                {t(`roles.${role}`)}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {isFacilityOwner &&
                      user.facilityRole !== "owner" &&
                      user.roles.includes("admin") && (
                        <div className="mb-2 flex flex-wrap justify-end gap-2">
                          {classPermissions.map((permission) => (
                            <label
                              key={permission}
                              className="text-left text-xs"
                            >
                              <span className="block text-slate-500">
                                {t(`admin.classPermissions.${permission}`)}
                              </span>
                              <select
                                value={
                                  user.classPermissions[permission] ?? "inherit"
                                }
                                onChange={(event) =>
                                  void handleClassPermissionChange(
                                    user,
                                    permission,
                                    event.target.value as
                                      "inherit" | "allow" | "deny",
                                  )
                                }
                                className="mt-1 rounded border border-slate-300 px-2 py-1"
                              >
                                {(["inherit", "allow", "deny"] as const).map(
                                  (effect) => (
                                    <option key={effect} value={effect}>
                                      {t(`admin.permissionEffects.${effect}`)}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                    {user.facilityRole !== "owner" && (
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
                    )}
                    {user.facilityRole !== "owner" && (
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
                    )}
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
        {invitations.filter(
          (item) => item.status === "pending" && item.role !== "member",
        ).length === 0 ? (
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
                  .filter(
                    (item) =>
                      item.status === "pending" && item.role !== "member",
                  )
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
      {isFacilityOwner && memberAffiliationPolicy && (
        <section className="space-y-4 border-t pt-5">
          <div>
            <h3 className="font-semibold text-gray-900">
              {t("admin.staffMemberPolicyTitle")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("admin.staffMemberPolicyDescription")}
            </p>
          </div>
          <fieldset disabled={savingMemberPolicy} className="space-y-2">
            <legend className="text-sm font-semibold text-gray-800">
              {t("admin.staffMemberPolicyQuestion")}
            </legend>
            {([true, false] as const).map((allowed) => (
              <label key={String(allowed)} className="mr-5 inline-flex gap-2">
                <input
                  type="radio"
                  name="allow-staff-member-affiliations"
                  checked={memberAffiliationPolicy.allowAllStaff === allowed}
                  onChange={() =>
                    void saveMemberAffiliationPolicy(
                      allowed,
                      memberAffiliationPolicy.staff
                        .filter((person) => person.specificallyAllowed)
                        .map((person) => person.userId),
                    )
                  }
                />
                {allowed ? t("common.yes") : t("common.no")}
              </label>
            ))}
          </fieldset>
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer font-semibold text-slate-900">
              {t("admin.specificStaffMemberPermissions")}
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              {t("admin.specificStaffMemberPermissionsHelp")}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {memberAffiliationPolicy.staff.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t("admin.noEligibleStaffForMemberAffiliation")}
                </p>
              ) : (
                memberAffiliationPolicy.staff.map((person) => (
                  <label
                    key={person.userId}
                    className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={person.specificallyAllowed}
                      disabled={savingMemberPolicy}
                      onChange={(event) => {
                        const selected = memberAffiliationPolicy.staff
                          .filter((candidate) =>
                            candidate.userId === person.userId
                              ? event.target.checked
                              : candidate.specificallyAllowed,
                          )
                          .map((candidate) => candidate.userId);
                        void saveMemberAffiliationPolicy(
                          memberAffiliationPolicy.allowAllStaff,
                          selected,
                        );
                      }}
                    />
                    <span>
                      <span className="block font-medium text-slate-900">
                        {person.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {person.email}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </details>
        </section>
      )}
      <section className="space-y-3 border-t pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">
              {t("admin.memberAffiliations")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("admin.memberAffiliationsDescription")}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingUser(null);
              setInvitationRole("member");
              setShowForm(true);
            }}
          >
            <Plus size={16} className="mr-1" />
            {t("admin.affiliateMember")}
          </Button>
        </div>
        {users.every((user) => !user.roles.includes("member")) &&
        invitations.every(
          (item) => item.status !== "pending" || item.role !== "member",
        ) ? (
          <p className="text-sm text-gray-600">
            {t("admin.noMemberAffiliations")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">{t("common.name")}</th>
                  <th className="px-4 py-3 text-left">{t("common.email")}</th>
                  <th className="px-4 py-3 text-left">
                    {t("admin.affiliationStatus")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users
                  .filter((user) => user.roles.includes("member"))
                  .map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3">{user.name}</td>
                      <td className="px-4 py-3 text-gray-600">{user.email}</td>
                      <td className="px-4 py-3 text-emerald-700">
                        {t("admin.affiliationActive")}
                      </td>
                      <td />
                    </tr>
                  ))}
                {invitations
                  .filter(
                    (item) =>
                      item.status === "pending" && item.role === "member",
                  )
                  .map((invitation) => (
                    <tr key={invitation.id}>
                      <td className="px-4 py-3">{invitation.invitedName}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {invitation.invitedEmail}
                      </td>
                      <td className="px-4 py-3 text-amber-700">
                        {t("admin.affiliationPending")}
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

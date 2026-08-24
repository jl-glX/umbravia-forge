import { useState } from "react";
import { Button } from "./ui/button";
import {
  isUserRole,
  useUsers,
  type User,
  type UserUpdate,
} from "../hooks/useUsers";
import { useTranslation } from "react-i18next";
import { VerifiedForm } from "./VerifiedForm";
import { PasswordInput } from "./PasswordInput";
import { isPasswordWithinHashLimit } from "../lib/passwordPolicy";

interface UserFormProps {
  user?: User | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function UserForm({ user, onClose, onSuccess }: UserFormProps) {
  const { t, i18n } = useTranslation();
  const { inviteUser, updateUser } = useUsers();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: user?.email || "",
    name: user?.name || "",
    password: "",
    role: (user?.role || "trainer") as "member" | "trainer" | "admin",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (
        user &&
        formData.password &&
        (formData.password.length < 12 ||
          !isPasswordWithinHashLimit(formData.password) ||
          !/[a-z]/.test(formData.password) ||
          !/[A-Z]/.test(formData.password) ||
          !/[0-9]/.test(formData.password))
      ) {
        setError(t("auth.passwordPolicy"));
        return;
      }

      if (user) {
        const updates: UserUpdate = {
          email: formData.email,
          name: formData.name,
          role: formData.role,
        };
        if (formData.password) {
          updates.password = formData.password;
        }
        await updateUser(user.id, updates);
      } else {
        if (formData.role === "member") {
          setError(t("admin.workerRoleRequired"));
          return;
        }
        const resolved = i18n.resolvedLanguage ?? i18n.language;
        const locale = resolved.toLowerCase().startsWith("de-ch")
          ? "de-CH"
          : resolved.toLowerCase().startsWith("de")
            ? "de"
            : resolved.toLowerCase().startsWith("en")
              ? "en"
              : "es";
        const invitation = await inviteUser({
          email: formData.email,
          name: formData.name,
          role: formData.role,
          locale,
        });
        if (!invitation.deliveryQueued) {
          setError(t("admin.invitationEmailNotQueued"));
          return;
        }
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknownError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">
          {user ? t("admin.editUser") : t("admin.inviteUser")}
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <VerifiedForm onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="managed-user-email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t("common.email")}
            </label>
            <input
              type="email"
              id="managed-user-email"
              required
              maxLength={254}
              value={formData.email}
              disabled={Boolean(user)}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:text-gray-500"
            />
            {user && (
              <p className="mt-1 text-xs text-gray-500">
                {t("admin.emailChangeRequiresVerification")}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="managed-user-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t("common.name")}
            </label>
            <input
              type="text"
              id="managed-user-name"
              required
              maxLength={100}
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          {user ? (
            <div>
              <label
                htmlFor="managed-user-password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {user ? t("admin.passwordOptional") : t("common.password")}
              </label>
              <PasswordInput
                id="managed-user-password"
                required={false}
                value={formData.password}
                minLength={formData.password ? 12 : undefined}
                maxLength={128}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              {t("admin.invitationSecurityNotice")}
            </p>
          )}

          <div>
            <label
              htmlFor="managed-user-role"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t("common.role")}
            </label>
            <select
              id="managed-user-role"
              value={formData.role}
              onChange={(e) => {
                if (isUserRole(e.target.value)) {
                  setFormData({ ...formData, role: e.target.value });
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {user ? (
                <option value="member">{t("roles.member")}</option>
              ) : null}
              <option value="trainer">{t("roles.trainer")}</option>
              <option value="admin">{t("roles.admin")}</option>
            </select>
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
            <Button type="submit" disabled={loading}>
              {loading
                ? t("common.saving")
                : user
                  ? t("common.save")
                  : t("admin.sendInvitation")}
            </Button>
          </div>
        </VerifiedForm>
      </div>
    </div>
  );
}

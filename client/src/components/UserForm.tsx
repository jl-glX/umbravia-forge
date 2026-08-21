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
  const { t } = useTranslation();
  const { createUser, updateUser } = useUsers();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: user?.email || "",
    name: user?.name || "",
    password: "",
    role: (user?.role || "member") as "member" | "trainer" | "admin",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (
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
        if (!formData.password) {
          setError(t("admin.passwordRequired"));
          setLoading(false);
          return;
        }
        await createUser(formData);
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
          {user ? t("admin.editUser") : t("admin.createUser")}
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
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
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

          <div>
            <label
              htmlFor="managed-user-password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {user ? t("admin.passwordOptional") : t("common.password")}
            </label>
            <PasswordInput
              id="managed-user-password"
              required={!user}
              value={formData.password}
              minLength={formData.password ? 12 : undefined}
              maxLength={128}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

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
              <option value="member">{t("roles.member")}</option>
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
              {loading ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </VerifiedForm>
      </div>
    </div>
  );
}

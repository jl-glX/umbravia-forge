import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { TFunction } from "i18next";
import { UserRoundPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { isUserRole, useUsers, type User } from "../hooks/useUsers";
import { VerifiedForm } from "./VerifiedForm";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  formatManagedUserFormError,
  submitManagedUserForm,
  type ManagedUserFormDraft,
} from "../lib/managed-user-form";

interface UserFormProps {
  user?: User | null;
  invitationRole?: "member" | "worker";
  onClose: () => void;
  onSuccess: () => void;
}

export function ManagedUserFormDialogFrame({
  titleId,
  descriptionId,
  title,
  description,
  loading,
  error,
  cancelLabel,
  onClose,
  dialogRef,
  children,
}: {
  titleId: string;
  descriptionId: string;
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  cancelLabel: string;
  onClose: () => void;
  dialogRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-night/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={loading}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/70 bg-white shadow-2xl shadow-brand-night/30 sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="h-1.5 bg-gradient-to-r from-brand-ember via-brand-steel to-brand-path" />
        <div className="p-5 sm:p-7">
          <button
            type="button"
            className="absolute right-4 top-5 rounded-full p-2 text-brand-steel transition hover:bg-slate-100 hover:text-brand-night focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-path"
            aria-label={cancelLabel}
            onClick={onClose}
            disabled={loading}
          >
            <X aria-hidden="true" size={18} />
          </button>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-path/10 text-brand-path">
            <UserRoundPlus aria-hidden="true" size={24} />
          </div>
          <h2
            id={titleId}
            className="mt-5 pr-10 text-xl font-bold text-brand-night sm:text-2xl"
          >
            {title}
          </h2>
          <p
            id={descriptionId}
            className="mt-2 max-w-lg text-sm leading-6 text-brand-slate"
          >
            {description}
          </p>
          {error ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </div>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </div>
  );
}

export function ManagedUserFormFields({
  user,
  invitationRole,
  isFacilityOwner,
  loading,
  draft,
  t,
  onChange,
}: {
  user?: User | null;
  invitationRole: "member" | "worker";
  isFacilityOwner: boolean;
  loading: boolean;
  draft: ManagedUserFormDraft;
  t: TFunction;
  onChange: <Key extends keyof ManagedUserFormDraft>(
    field: Key,
    value: ManagedUserFormDraft[Key],
  ) => void;
}) {
  const selectableRoles = isFacilityOwner
    ? (["trainer", "admin"] as const)
    : (["trainer"] as const);

  return (
    <div className="space-y-5">
      <fieldset
        disabled={loading}
        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
      >
        <legend className="px-2 text-sm font-bold text-brand-night">
          {t("common.name")} · {t("common.email")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="managed-user-name"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {t("common.name")}
            </label>
            <input
              type="text"
              id="managed-user-name"
              required
              maxLength={100}
              autoComplete="name"
              value={draft.name}
              onChange={(event) => onChange("name", event.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-path"
            />
          </div>
          <div>
            <label
              htmlFor="managed-user-email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {t("common.email")}
            </label>
            <input
              type="email"
              id="managed-user-email"
              required
              maxLength={254}
              autoComplete="email"
              value={draft.email}
              disabled={Boolean(user) || loading}
              aria-describedby={
                user ? "managed-user-email-verification-note" : undefined
              }
              onChange={(event) => onChange("email", event.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm disabled:bg-gray-100 disabled:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-path"
            />
            {user ? (
              <p
                id="managed-user-email-verification-note"
                className="mt-1.5 text-xs leading-5 text-gray-500"
              >
                {t("admin.emailChangeRequiresVerification")}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      {!user && invitationRole === "worker" ? (
        <fieldset
          disabled={loading}
          className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <legend className="px-2 text-sm font-bold text-brand-night">
            {t("common.role")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {selectableRoles.map((role) => (
              <label
                key={role}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-sm transition ${
                  draft.role === role
                    ? "border-brand-path bg-brand-path/5 text-brand-night ring-1 ring-brand-path"
                    : "border-slate-200 text-slate-700 hover:border-brand-steel"
                }`}
              >
                <input
                  type="radio"
                  name="managed-user-role"
                  value={role}
                  checked={draft.role === role}
                  onChange={(event) => {
                    if (isUserRole(event.target.value)) {
                      onChange("role", event.target.value);
                    }
                  }}
                />
                <span className="font-semibold">{t(`roles.${role}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

export function UserForm({
  user,
  invitationRole = "worker",
  onClose,
  onSuccess,
}: UserFormProps) {
  const { t, i18n } = useTranslation();
  const currentUser = useCurrentUser();
  const isFacilityOwner = currentUser?.facility?.role === "owner";
  const { inviteUser, updateUser } = useUsers();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedUserFormDraft>({
    email: user?.email || "",
    name: user?.name || "",
    role: (user?.role ||
      (invitationRole === "member" ? "member" : "trainer")) as
      "member" | "trainer" | "admin",
  });
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeHandlerRef = useRef(onClose);
  const loadingRef = useRef(loading);

  useEffect(() => {
    closeHandlerRef.current = onClose;
    loadingRef.current = loading;
  }, [loading, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("#managed-user-name:not([disabled])")
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loadingRef.current) {
        closeHandlerRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const outcome = await submitManagedUserForm({
        user,
        draft,
        interfaceLocale: i18n.resolvedLanguage ?? i18n.language,
        inviteUser,
        updateUser,
      });
      if (outcome === "invitation-email-not-queued") {
        setError(t("admin.invitationEmailNotQueued"));
        return;
      }
      onSuccess();
    } catch (cause) {
      setError(formatManagedUserFormError(cause, t, user ? "edit" : "invite"));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const title = user
    ? t("admin.editUser")
    : t(
        invitationRole === "member"
          ? "admin.affiliateMember"
          : "admin.inviteUser",
      );
  const description = user
    ? t("admin.emailChangeRequiresVerification")
    : t(
        invitationRole === "member"
          ? "admin.memberAffiliationSecurityNotice"
          : "admin.invitationSecurityNotice",
      );
  const requestClose = () => {
    if (!loadingRef.current) onClose();
  };

  return (
    <ManagedUserFormDialogFrame
      titleId={titleId}
      descriptionId={descriptionId}
      title={title}
      description={description}
      loading={loading}
      error={error}
      cancelLabel={t("common.cancel")}
      onClose={requestClose}
      dialogRef={dialogRef}
    >
      <VerifiedForm
        onSubmit={handleSubmit}
        className="space-y-5"
        aria-busy={loading}
      >
        <ManagedUserFormFields
          user={user}
          invitationRole={invitationRole}
          isFacilityOwner={isFacilityOwner}
          loading={loading}
          draft={draft}
          t={t}
          onChange={(field, value) =>
            setDraft((current) => ({ ...current, [field]: value }))
          }
        />
        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={loading}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={loading}>
            {loading
              ? t("common.saving")
              : user
                ? t("common.save")
                : t(
                    invitationRole === "member"
                      ? "admin.sendAffiliation"
                      : "admin.sendInvitation",
                  )}
          </Button>
        </div>
      </VerifiedForm>
    </ManagedUserFormDialogFrame>
  );
}

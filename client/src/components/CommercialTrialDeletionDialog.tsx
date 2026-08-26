import { useEffect, useId, type FormEvent } from "react";
import {
  AlertTriangle,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CommercialTrialAdministratorAccount } from "../lib/umf-support";
import { PasswordInput } from "./PasswordInput";
import { VerifiedForm } from "./VerifiedForm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface CommercialTrialDeletionDialogProps {
  account: CommercialTrialAdministratorAccount;
  mfaEnabled: boolean | null;
  securityLoading: boolean;
  password: string;
  totpCode: string;
  error: string;
  busy: boolean;
  onPasswordChange: (value: string) => void;
  onTotpCodeChange: (value: string) => void;
  onConfirm: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

export function CommercialTrialDeletionDialog({
  account,
  mfaEnabled,
  securityLoading,
  password,
  totpCode,
  error,
  busy,
  onPasswordChange,
  onTotpCodeChange,
  onConfirm,
  onCancel,
}: CommercialTrialDeletionDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const trial = account.trial;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onCancel]);

  if (!trial) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl shadow-slate-950/30"
      >
        <div className="h-1.5 bg-gradient-to-r from-red-700 via-orange-500 to-amber-400" />
        <div className="p-6 sm:p-8">
          <button
            type="button"
            className="absolute right-5 top-6 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            aria-label={t("common.cancel")}
            onClick={onCancel}
            disabled={busy}
          >
            <X aria-hidden="true" size={19} />
          </button>

          <span className="grid size-12 place-items-center rounded-2xl bg-red-50 text-red-700">
            <AlertTriangle aria-hidden="true" size={25} />
          </span>
          <h2
            id={titleId}
            className="mt-5 pr-10 text-2xl font-black text-slate-950"
          >
            {t("umfSupport.commercialTrials.deleteDialog.title", {
              facility: trial.facilityName,
            })}
          </h2>
          <p
            id={descriptionId}
            className="mt-3 text-sm leading-6 text-slate-700"
          >
            {t("umfSupport.commercialTrials.deleteDialog.description", {
              facility: trial.facilityName,
              email: account.email,
            })}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-950">
              <strong className="block">
                {t("umfSupport.commercialTrials.deleteDialog.removedTitle")}
              </strong>
              {t("umfSupport.commercialTrials.deleteDialog.removedBody")}
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
              <strong className="block">
                {t("umfSupport.commercialTrials.deleteDialog.retainedTitle")}
              </strong>
              {t("umfSupport.commercialTrials.deleteDialog.retainedBody", {
                email: account.email,
              })}
            </div>
          </div>

          {securityLoading ? (
            <p className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {t("umfSupport.commercialTrials.deleteDialog.checkingSecurity")}
            </p>
          ) : mfaEnabled === false ? (
            <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <strong className="block">
                    {t(
                      "umfSupport.commercialTrials.deleteDialog.mfaRequiredTitle",
                    )}
                  </strong>
                  <p className="mt-1">
                    {t(
                      "umfSupport.commercialTrials.deleteDialog.mfaRequiredBody",
                    )}
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="mt-4 border-amber-500"
                  >
                    <Link to="/umf-support/account">
                      {t(
                        "umfSupport.commercialTrials.deleteDialog.openSecurity",
                      )}
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : mfaEnabled ? (
            <VerifiedForm className="mt-6 space-y-4" onSubmit={onConfirm}>
              <div>
                <Label
                  htmlFor="support-trial-delete-password"
                  className="flex items-center gap-2"
                >
                  <LockKeyhole size={17} aria-hidden="true" />
                  {t("umfSupport.commercialTrials.deleteDialog.password")}
                </Label>
                <PasswordInput
                  id="support-trial-delete-password"
                  autoComplete="current-password"
                  autoFocus
                  maxLength={128}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  className="mt-2"
                  required
                />
              </div>
              <div>
                <Label htmlFor="support-trial-delete-totp">
                  {t("umfSupport.commercialTrials.deleteDialog.totp")}
                </Label>
                <Input
                  id="support-trial-delete-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) =>
                    onTotpCodeChange(event.target.value.replace(/\D/gu, ""))
                  }
                  className="mt-2 font-mono tracking-[0.25em]"
                  required
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {t("umfSupport.commercialTrials.deleteDialog.securityHelp")}
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy || !password || totpCode.length !== 6}
                >
                  <Trash2 size={17} aria-hidden="true" />
                  {t("umfSupport.commercialTrials.deleteDialog.confirm")}
                </Button>
              </div>
            </VerifiedForm>
          ) : error ? (
            <p
              role="alert"
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

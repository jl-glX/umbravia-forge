import {
  Fingerprint,
  KeyRound,
  LifeBuoy,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthShell } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { CaptchaWidget } from "../components/CaptchaWidget";
import { PasswordInput } from "../components/PasswordInput";
import { useEffect, useState, type FormEvent } from "react";
import { isPasswordWithinHashLimit } from "../lib/passwordPolicy";

type RecoveryMethod = {
  id: "password" | "email" | "code" | "passkey" | "support";
  status: "available" | "planned";
  entryPoint: "/login" | "/recover-account" | null;
  requiresCompletedVerification: true;
  canCancelPendingDeletion: boolean;
};

type RecoveryLookupMethod = "email" | "username" | "public_id";

const methodIcons = {
  password: KeyRound,
  email: Mail,
  code: KeyRound,
  passkey: Fingerprint,
  support: LifeBuoy,
};

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export function RecoverAccountPage() {
  const { t } = useTranslation();
  const [methods, setMethods] = useState<RecoveryMethod[]>([]);
  const [lookupMethods, setLookupMethods] = useState<RecoveryLookupMethod[]>([
    "email",
    "username",
    "public_id",
  ]);
  const [lookupMethod, setLookupMethod] =
    useState<RecoveryLookupMethod>("email");
  const [step, setStep] = useState<"request" | "reset" | "complete">("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/recovery/capabilities`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Recovery capabilities unavailable");
        return (await response.json()) as {
          methods: RecoveryMethod[];
          lookupMethods?: RecoveryLookupMethod[];
        };
      })
      .then((payload) => {
        setMethods(payload.methods);
        if (payload.lookupMethods?.length) {
          setLookupMethods(payload.lookupMethods);
          setLookupMethod((current) =>
            payload.lookupMethods!.includes(current)
              ? current
              : payload.lookupMethods![0],
          );
        }
      })
      .catch(() => setMethods([]));
  }, []);

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (!captchaToken) {
      setError(t("recovery.errors.verificationRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/recovery/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: lookupMethod,
          identifier,
          captchaToken,
        }),
      });
      if (!response.ok) throw new Error("request_failed");
      setCaptchaToken("");
      setStep("reset");
    } catch {
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
      setError(t("recovery.errors.requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t("recovery.errors.passwordMismatch"));
      return;
    }
    if (
      newPassword.length < 12 ||
      !isPasswordWithinHashLimit(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      setError(t("auth.passwordPolicy"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE}/api/auth/recovery/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: lookupMethod,
            identifier,
            code,
            newPassword,
          }),
        },
      );
      if (!response.ok) throw new Error("reset_failed");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setStep("complete");
    } catch {
      setError(t("recovery.errors.resetFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("recovery.eyebrow")}
      title={t("recovery.title")}
      description={t("recovery.description")}
    >
      {step === "request" && (
        <form className="space-y-4" onSubmit={requestRecovery}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-900">
              {t("recovery.lookupMethod")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {lookupMethods.map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant={lookupMethod === method ? "default" : "outline"}
                  aria-pressed={lookupMethod === method}
                  onClick={() => {
                    setLookupMethod(method);
                    setIdentifier("");
                    setError("");
                  }}
                >
                  {t(`recovery.lookup.${method}.option`)}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="recovery-identifier">
              {t(`recovery.lookup.${lookupMethod}.label`)}
            </Label>
            <Input
              id="recovery-identifier"
              type={lookupMethod === "email" ? "email" : "text"}
              autoComplete={
                lookupMethod === "email"
                  ? "email"
                  : lookupMethod === "username"
                    ? "username"
                    : "off"
              }
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={t(`recovery.lookup.${lookupMethod}.placeholder`)}
              required
              maxLength={254}
            />
            <p className="text-xs leading-5 text-slate-500">
              {t(`recovery.lookup.${lookupMethod}.help`)}
            </p>
          </div>
          <CaptchaWidget
            action="recovery"
            onToken={setCaptchaToken}
            resetSignal={captchaReset}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("recovery.sending") : t("recovery.sendCode")}
          </Button>
        </form>
      )}

      {step === "reset" && (
        <form className="space-y-4" onSubmit={resetPassword}>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
            {t("recovery.codeSent")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-code">{t("recovery.code")}</Label>
            <Input
              id="recovery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
              pattern="\d{6}"
              maxLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-password">
              {t("recovery.newPassword")}
            </Label>
            <PasswordInput
              id="recovery-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              maxLength={256}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-password-confirm">
              {t("recovery.confirmPassword")}
            </Label>
            <PasswordInput
              id="recovery-password-confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={12}
              maxLength={256}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("recovery.resetting") : t("recovery.resetPassword")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setError("");
              setCode("");
              setCaptchaReset((value) => value + 1);
              setStep("request");
            }}
          >
            {t("recovery.requestAnotherCode")}
          </Button>
        </form>
      )}

      {step === "complete" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            <div className="flex gap-2 font-semibold">
              <ShieldCheck size={18} /> {t("recovery.completeTitle")}
            </div>
            <p className="mt-1">{t("recovery.completeDescription")}</p>
          </div>
          <Button asChild className="w-full">
            <Link to="/login">{t("recovery.returnToLogin")}</Link>
          </Button>
        </div>
      )}

      {step !== "complete" && methods.length > 0 && (
        <details className="mt-5 rounded-2xl border border-slate-200 p-4">
          <summary className="cursor-pointer font-semibold text-slate-900">
            {t("recovery.methodsTitle")}
          </summary>
          <div className="mt-3 space-y-3">
            {methods.map(({ id, status }) => {
              const Icon = methodIcons[id];
              return (
                <article key={id} className="flex items-start gap-3 text-sm">
                  <Icon className="mt-0.5 shrink-0 text-blue-600" size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-bold text-slate-950">
                        {t(`recovery.methods.${id}.title`)}
                      </h2>
                      <span className="text-xs font-semibold text-slate-500">
                        {status === "available"
                          ? t("recovery.available")
                          : t("recovery.planned")}
                      </span>
                    </div>
                    <p className="mt-1 leading-6 text-slate-600">
                      {t(`recovery.methods.${id}.description`)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </details>
      )}

      {step !== "complete" && (
        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          <div className="flex gap-2 font-semibold">
            <ShieldCheck size={18} /> {t("recovery.securityTitle")}
          </div>
          <p className="mt-1">{t("recovery.securityNotice")}</p>
        </div>
      )}

      {step !== "complete" && (
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link to="/login">{t("recovery.returnToLogin")}</Link>
        </Button>
      )}
    </AuthShell>
  );
}

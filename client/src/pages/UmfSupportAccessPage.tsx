import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  KeyRound,
  LogIn,
  UserPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CaptchaWidget } from "../components/CaptchaWidget";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PasswordInput } from "../components/PasswordInput";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../hooks/useAuth";
import {
  activateAccount,
  bootstrapHeadIfAvailable,
  fetchDistribution,
  requestAccess,
  type UmfSupportDistribution,
} from "../lib/umf-support";
import { authFetch } from "../lib/api";
import { isPasswordWithinHashLimit } from "../lib/passwordPolicy";

type Mode = "login" | "request" | "activate";

export function UmfSupportAccessPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [countryCode, setCountryCode] = useState("ES");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [distribution, setDistribution] =
    useState<UmfSupportDistribution | null>(null);

  const finishSupportLogin = async () => {
    await bootstrapHeadIfAvailable();
    await refreshUser();
    navigate("/umf-support", { replace: true });
  };

  useEffect(() => {
    void fetchDistribution()
      .then(setDistribution)
      .catch(() => setDistribution(null));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      if (mode === "login") {
        if (mfaRequired) {
          const response = await authFetch("/api/auth/mfa/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: mfaCode }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            code?: string;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.code ?? payload.error ?? "MFA_FAILED");
          }
          await finishSupportLogin();
          return;
        }
        const response = await authFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: email,
            password,
            accessPortal: "support",
            rememberDevice: false,
            captchaToken,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
          mfaRequired?: boolean;
        };
        if (!response.ok) {
          throw new Error(payload.code ?? payload.error ?? "LOGIN_FAILED");
        }
        if (payload.mfaRequired) {
          setMfaRequired(true);
          setPassword("");
          setCaptchaToken("");
          return;
        }
        await finishSupportLogin();
      } else if (mode === "request") {
        if (password !== confirmPassword) {
          throw new Error("UMF_SUPPORT_PASSWORD_MISMATCH");
        }
        if (
          password.length < 12 ||
          !isPasswordWithinHashLimit(password) ||
          !/[a-z]/.test(password) ||
          !/[A-Z]/.test(password) ||
          !/[0-9]/.test(password)
        ) {
          throw new Error("UMF_SUPPORT_PASSWORD_POLICY");
        }
        await requestAccess({
          email,
          name,
          lastName,
          password,
          locale: i18n.resolvedLanguage ?? "es",
          captchaToken,
        });
        setNotice(t("umfSupportAccess.requestAccepted"));
        setMode("activate");
        setPassword("");
        setConfirmPassword("");
        setCaptchaToken("");
        setCaptchaResetSignal((value) => value + 1);
      } else {
        await activateAccount({
          email,
          code,
          password,
          countryCode,
          acceptedTerms,
          acceptedPrivacy,
          captchaToken,
        });
        await refreshUser();
        navigate("/umf-support", { replace: true });
      }
    } catch (cause) {
      if (!(mode === "login" && mfaRequired)) {
        setCaptchaToken("");
        setCaptchaResetSignal((value) => value + 1);
      }
      const errorKey = cause instanceof Error ? cause.message : "";
      const translatedErrors: Record<string, string> = {
        UMF_SUPPORT_PASSWORD_MISMATCH: t("umfSupportAccess.passwordMismatch"),
        UMF_SUPPORT_PASSWORD_POLICY: t("auth.passwordPolicy"),
        UMF_SUPPORT_ACTIVATION_INVALID: t("umfSupportAccess.activationInvalid"),
      };
      setError(
        translatedErrors[errorKey] ||
          (cause instanceof Error
            ? cause.message
            : t("umfSupportAccess.error")),
      );
    } finally {
      setWorking(false);
    }
  };

  const selectMode = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    setCode("");
    setMfaRequired(false);
    setMfaCode("");
    setAcceptedTerms(false);
    setAcceptedPrivacy(false);
    setCaptchaToken("");
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:py-14">
      <div className="mx-auto max-w-md">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <img
              src="/brand/umf-support-wordmark.png"
              alt="UMF Support"
              className="h-auto w-44"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t("umfSupportAccess.corporateProgram")}
            </p>
          </div>
          <LanguageSwitcher />
        </header>

        <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t(`umfSupportAccess.${mode}.eyebrow`)}
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {t(`umfSupportAccess.${mode}.title`)}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t(`umfSupportAccess.${mode}.description`)}
            </p>
          </div>

          <div className="p-6">
            <div className="mb-6 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {(["login", "request", "activate"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectMode(item)}
                  className={`rounded-md px-2 py-2 text-xs font-semibold transition ${mode === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {t(`umfSupportAccess.tabs.${item}`)}
                </button>
              ))}
            </div>

            {error && (
              <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {notice && (
              <p className="mb-5 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 shrink-0" size={16} /> {notice}
              </p>
            )}

            <form className="space-y-4" onSubmit={submit}>
              {mode === "request" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="umf-name">{t("common.name")}</Label>
                    <Input
                      id="umf-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={100}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="umf-last-name">
                      {t("umfSupportAccess.lastName")}
                    </Label>
                    <Input
                      id="umf-last-name"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      maxLength={100}
                      required
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="umf-email">{t("common.email")}</Label>
                <Input
                  id="umf-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  required
                />
              </div>
              {mode === "activate" && (
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="umf-code">
                      {t("umfSupportAccess.activationCode")}
                    </Label>
                    <Input
                      id="umf-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="umf-country-code">
                      {t("umfSupportAccess.countryCode")}
                    </Label>
                    <Input
                      id="umf-country-code"
                      value={countryCode}
                      onChange={(event) =>
                        setCountryCode(event.target.value.toUpperCase())
                      }
                      minLength={2}
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      autoComplete="country"
                      required
                    />
                  </div>
                </div>
              )}
              {mode === "login" && mfaRequired ? (
                <div className="space-y-1.5">
                  <Label htmlFor="umf-mfa-code">
                    {t("umfSupportAccess.mfaCode")}
                  </Label>
                  <Input
                    id="umf-mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    maxLength={8}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="umf-password">{t("common.password")}</Label>
                  <PasswordInput
                    id="umf-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={
                      mode === "request" ? "new-password" : "current-password"
                    }
                    minLength={mode === "login" ? 1 : 12}
                    maxLength={128}
                    required
                  />
                  {mode === "request" && (
                    <p className="text-xs leading-5 text-slate-500">
                      {t("auth.passwordPolicy")}
                    </p>
                  )}
                </div>
              )}
              {mode === "request" && (
                <div className="space-y-1.5">
                  <Label htmlFor="umf-confirm-password">
                    {t("auth.confirmPassword")}
                  </Label>
                  <PasswordInput
                    id="umf-confirm-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </div>
              )}
              {mode === "activate" && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acceptedTerms}
                      onChange={(event) =>
                        setAcceptedTerms(event.target.checked)
                      }
                      required
                    />
                    <span>
                      {t("umfSupportAccess.acceptTerms")}{" "}
                      <Link to="/terms-and-conditions" className="underline">
                        {t("umfSupportAccess.terms")}
                      </Link>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acceptedPrivacy}
                      onChange={(event) =>
                        setAcceptedPrivacy(event.target.checked)
                      }
                      required
                    />
                    <span>
                      {t("umfSupportAccess.acceptPrivacy")}{" "}
                      <Link to="/privacy" className="underline">
                        {t("umfSupportAccess.privacy")}
                      </Link>
                    </span>
                  </label>
                </div>
              )}
              {(mode === "request" ||
                mode === "activate" ||
                (mode === "login" && !mfaRequired)) &&
                !captchaToken && (
                  <CaptchaWidget
                    action={mode === "login" ? "login" : "signup"}
                    onToken={setCaptchaToken}
                    resetSignal={captchaResetSignal}
                  />
                )}
              <Button
                type="submit"
                disabled={
                  working ||
                  ((mode === "request" ||
                    mode === "activate" ||
                    (mode === "login" && !mfaRequired)) &&
                    !captchaToken) ||
                  (mode === "activate" && (!acceptedTerms || !acceptedPrivacy))
                }
                className="h-11 w-full rounded-lg bg-slate-900 hover:bg-slate-800"
              >
                {mode === "login" ? (
                  <LogIn />
                ) : mode === "request" ? (
                  <UserPlus />
                ) : (
                  <KeyRound />
                )}
                {t(`umfSupportAccess.${mode}.action`)}
              </Button>
            </form>
          </div>
        </section>

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          {t("umfSupportAccess.restrictedNotice")} ·{" "}
          <Link to="/privacy" className="underline hover:text-slate-800">
            {t("umfSupportAccess.privacy")}
          </Link>
        </p>
        {distribution?.available && distribution.url && (
          <a
            href={distribution.url}
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Download size={16} /> {t("umfSupportAccess.downloadWindowsTest")}
          </a>
        )}
      </div>
    </main>
  );
}

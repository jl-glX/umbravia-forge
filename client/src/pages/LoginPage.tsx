import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { AuthShell } from "../components/AuthShell";
import { AuthAccessMenu } from "../components/AuthAccessMenu";
import { PasswordInput } from "../components/PasswordInput";
import {
  ArrowRight,
  ChevronDown,
  Fingerprint,
  Info,
  KeyRound,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import { SavedAccountSelector } from "../components/SavedAccountSelector";
import {
  forgetAccount,
  getSavedAccounts,
  rememberAccount,
  type SavedAccount,
} from "../lib/saved-accounts";
import { CaptchaWidget } from "../components/CaptchaWidget";
import {
  clearAppNavigationHistory,
  getSessionStorage,
} from "../lib/app-navigation-history";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithPasskey, verifyMfa, isLoading, error, clearError } =
    useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [accessPortal, setAccessPortal] = useState<"member" | "staff">(
    "member",
  );
  const [validationError, setValidationError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [showAlternativeSignIn, setShowAlternativeSignIn] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState(getSavedAccounts);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const { t } = useTranslation();
  const displayedError =
    error === "INVALID_CREDENTIALS" ? t("auth.invalidCredentials") : error;
  const demoAccount =
    accessPortal === "member"
      ? {
          role: t("roles.member"),
          description: t("auth.demoMemberDescription"),
          email: "juan@example.com",
          password: "UmbraviaForgeMember123",
          icon: UserRound,
        }
      : {
          role: t("roles.admin"),
          description: t("auth.demoAdminDescription"),
          email: "admin@umbravia-forge.com",
          password: "UmbraviaForgeAdmin123",
          icon: ShieldCheck,
        };

  const selectDemoAccount = (demoEmail: string, demoPassword: string) => {
    setIdentifier(demoEmail);
    setPassword(demoPassword);
    setValidationError("");
    clearError();
  };

  const selectSavedAccount = (account: SavedAccount) => {
    setAccessPortal(account.accessPortal);
    setIdentifier(account.identifier);
    setPassword("");
    setMfaRequired(false);
    setMfaCode("");
    setValidationError("");
    clearError();
  };

  const rememberSignedInAccount = (
    user: NonNullable<Awaited<ReturnType<typeof login>>["user"]>,
  ) => {
    setSavedAccounts(rememberAccount(user, identifier));
  };

  const startAppSession = (userId: string) => {
    const storage = getSessionStorage();
    if (storage) clearAppNavigationHistory(storage, userId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");

    if (!identifier || !password) {
      setValidationError(t("auth.credentialsRequired"));
      return;
    }
    if (!captchaToken) {
      setValidationError(t("auth.verificationRequired"));
      return;
    }
    try {
      const result = await login(
        identifier,
        password,
        accessPortal,
        rememberDevice,
        captchaToken,
      );
      if (result.mfaRequired) {
        setMfaRequired(true);
        if (mfaCode.trim()) {
          const verifiedUser = await verifyMfa(mfaCode.trim());
          startAppSession(verifiedUser.id);
          navigateForAccountStatus(verifiedUser.accountStatus);
        }
        return;
      }
      if (result.user) rememberSignedInAccount(result.user);
      if (result.user?.accountStatus !== "active") {
        navigate(
          result.user?.accountStatus === "pending_verification"
            ? "/verify-email"
            : "/recover-account",
        );
        return;
      }
      if (result.user) startAppSession(result.user.id);
      navigate("/", { replace: true });
    } catch (err) {
      setCaptchaToken("");
      setCaptchaResetSignal((value) => value + 1);
      console.error("Login error:", err);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const verifiedUser = await verifyMfa(mfaCode);
      setSavedAccounts(rememberAccount(verifiedUser, identifier));
      if (verifiedUser.accountStatus !== "active") {
        navigate(
          verifiedUser.accountStatus === "pending_verification"
            ? "/verify-email"
            : "/recover-account",
        );
        return;
      }
      startAppSession(verifiedUser.id);
      navigate("/", { replace: true });
    } catch (err) {
      console.error("MFA verification error:", err);
    }
  };

  const navigateForAccountStatus = (
    accountStatus: "pending_verification" | "active" | "security_review",
  ) =>
    navigate(
      accountStatus !== "active"
        ? accountStatus === "pending_verification"
          ? "/verify-email"
          : "/recover-account"
        : "/",
      { replace: true },
    );

  const handlePasskeyLogin = async () => {
    setValidationError("");
    if (!identifier) {
      setValidationError(t("auth.passkeyIdentifierRequired"));
      return;
    }
    if (!captchaToken) {
      setValidationError(t("auth.verificationRequired"));
      return;
    }
    let platformAuthenticatorAvailable = true;
    try {
      platformAuthenticatorAvailable = await platformAuthenticatorIsAvailable();
      const signedInUser = await loginWithPasskey(
        identifier,
        accessPortal,
        rememberDevice,
        captchaToken,
      );
      setSavedAccounts(rememberAccount(signedInUser, identifier));
      startAppSession(signedInUser.id);
      navigateForAccountStatus(signedInUser.accountStatus);
    } catch (err) {
      setCaptchaToken("");
      setCaptchaResetSignal((value) => value + 1);
      const errorCode = err instanceof Error ? err.message : "";
      if (errorCode === "PASSKEY_NOT_CONFIGURED") {
        setValidationError(
          t("auth.passkeyNotConfigured", { identifier: identifier.trim() }),
        );
      } else if (!platformAuthenticatorAvailable) {
        setValidationError(t("auth.passkeyDeviceUnavailable"));
      } else if (errorCode === "PASSKEY_CHALLENGE_INVALID") {
        setValidationError(t("auth.passkeyChallengeInvalid"));
      } else {
        setValidationError(t("auth.passkeyVerificationFailed"));
      }
      console.error("Passkey login error:", err);
    }
  };

  return (
    <AuthShell
      contentSurface={captchaToken || mfaRequired ? "card" : "integrated"}
      eyebrow={
        accessPortal === "member"
          ? t("auth.welcomeBack")
          : t("auth.staffEyebrow")
      }
      title={
        accessPortal === "member"
          ? t("auth.memberSignInTitle")
          : t("auth.staffSignInTitle")
      }
      description={
        accessPortal === "member"
          ? t("auth.memberSignInDescription")
          : t("auth.staffSignInDescription")
      }
      utilityMenu={
        <AuthAccessMenu
          accessPortal={accessPortal}
          onAccessPortalChange={(portal) => {
            setAccessPortal(portal);
            setIdentifier("");
            setPassword("");
            setMfaRequired(false);
            setMfaCode("");
            setShowAlternativeSignIn(false);
            setValidationError("");
            clearError();
          }}
        />
      }
    >
      {!mfaRequired && (
        <SavedAccountSelector
          accounts={savedAccounts.filter(
            (account) => account.accessPortal === accessPortal,
          )}
          onSelect={selectSavedAccount}
          onRemove={(accountId) => setSavedAccounts(forgetAccount(accountId))}
          onUseAnother={() => {
            setIdentifier("");
            setPassword("");
            clearError();
          }}
        />
      )}
      {(validationError || displayedError) && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3.5">
          <p className="text-sm text-red-600">
            {validationError || displayedError}
          </p>
        </div>
      )}

      {mfaRequired ? (
        <form onSubmit={handleMfaSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mfa-code">{t("auth.verificationCode")}</Label>
            <Input
              id="mfa-code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123456"
              autoFocus
            />
            <p className="text-xs text-slate-500">
              {t("auth.verificationHelp")}
            </p>
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-xl bg-blue-600"
            disabled={isLoading}
          >
            {t("auth.verifyIdentity")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMfaRequired(false);
              setMfaCode("");
            }}
          >
            {t("auth.useDifferentAccount")}
          </Button>

          {browserSupportsWebAuthn() && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-xl border-slate-300"
              disabled={isLoading}
              onClick={handlePasskeyLogin}
            >
              <Fingerprint /> {t("auth.signInWithPasskey")}
            </Button>
          )}
          {browserSupportsWebAuthn() && (
            <p className="text-center text-xs leading-relaxed text-slate-500">
              {t("auth.passkeyHelp")}
            </p>
          )}
        </form>
      ) : (
        <>
          {!captchaToken && (
            <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="mb-3 text-sm font-medium text-blue-950">
                {t("auth.verificationRequired")}
              </p>
              <CaptchaWidget
                action="login"
                onToken={setCaptchaToken}
                resetSignal={captchaResetSignal}
              />
            </div>
          )}
          {captchaToken ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="identifier" className="text-slate-700">
                  {accessPortal === "member"
                    ? t("auth.emailAddress")
                    : t("auth.centerIdentifier")}
                </Label>
                <Input
                  id="identifier"
                  type={accessPortal === "member" ? "email" : "text"}
                  autoComplete="username"
                  placeholder={
                    accessPortal === "member"
                      ? "juan@example.com"
                      : "centro@umbravia-forge.com / +34 953 000 000"
                  }
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3 focus-visible:bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700">
                  {t("common.password")}
                </Label>
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  maxLength={256}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3 focus-visible:bg-white"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <span className="block font-semibold">
                    {t("auth.rememberDevice")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {t("auth.rememberDeviceHelp")}
                  </span>
                </span>
              </label>

              <Button
                type="submit"
                className="h-11 w-full rounded-xl bg-blue-600 shadow-md shadow-blue-600/15 hover:bg-blue-700"
                disabled={isLoading}
              >
                {isLoading ? (
                  t("auth.signingIn")
                ) : (
                  <>
                    <span>{t("auth.signIn")}</span>
                    <ArrowRight />
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full rounded-xl text-slate-700"
                aria-expanded={showAlternativeSignIn}
                aria-controls="alternative-sign-in"
                onClick={() => setShowAlternativeSignIn((current) => !current)}
              >
                {showAlternativeSignIn
                  ? t("auth.hideAlternativeSignIn")
                  : t("auth.alternativeSignIn")}
                <ChevronDown
                  className={`transition ${showAlternativeSignIn ? "rotate-180" : ""}`}
                />
              </Button>

              {showAlternativeSignIn && (
                <div
                  id="alternative-sign-in"
                  className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="space-y-2">
                    <Label
                      htmlFor="alternative-code"
                      className="flex items-center gap-2 text-slate-700"
                    >
                      <KeyRound size={16} /> {t("auth.verificationCode")}
                    </Label>
                    <Input
                      id="alternative-code"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                      placeholder={t("auth.verificationCodePlaceholder")}
                      disabled={isLoading}
                      className="h-11 rounded-xl border-slate-200 bg-white px-3"
                    />
                    <p className="text-xs leading-relaxed text-slate-500">
                      {t("auth.alternativeCodeHelp")}
                    </p>
                  </div>

                  {browserSupportsWebAuthn() && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full rounded-xl border-slate-300 bg-white"
                      disabled={isLoading}
                      onClick={handlePasskeyLogin}
                    >
                      <Fingerprint /> {t("auth.signInWithPasskey")}
                    </Button>
                  )}
                </div>
              )}
            </form>
          ) : null}
        </>
      )}

      {accessPortal === "member" && (
        <div className="mt-6 space-y-2 text-center">
          <Link
            to="/recover-account"
            className="block text-sm font-semibold text-blue-600 hover:underline"
          >
            {t("auth.cannotAccess")}
          </Link>
          <p className="text-sm text-gray-600">
            {t("auth.noAccount")}{" "}
            <Link
              to="/signup"
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t("auth.signUp")}
            </Link>
          </p>
        </div>
      )}

      {!mfaRequired && import.meta.env.DEV && (
        <section
          aria-labelledby="demo-accounts-title"
          className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4"
        >
          <div className="flex gap-3">
            <Info className="mt-0.5 shrink-0 text-blue-600" size={17} />
            <div>
              <p
                id="demo-accounts-title"
                className="text-xs font-semibold text-blue-900"
              >
                {t("auth.demoAccess")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-blue-800">
                {t("auth.demoInstructions")}
              </p>
            </div>
          </div>

          <div className="mt-3">
            {(() => {
              const Icon = demoAccount.icon;
              return (
                <button
                  type="button"
                  onClick={() =>
                    selectDemoAccount(demoAccount.email, demoAccount.password)
                  }
                  className="w-full rounded-xl border border-blue-200 bg-white p-3 text-left transition hover:border-blue-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Icon size={16} className="text-blue-600" />
                    {demoAccount.role}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {demoAccount.description}
                  </span>
                  <span className="mt-2 block text-[11px] font-medium text-blue-700">
                    {t("auth.useDemoAccount")}
                  </span>
                </button>
              );
            })()}
          </div>
        </section>
      )}
    </AuthShell>
  );
}

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { AuthShell } from "../components/AuthShell";
import { PasswordInput } from "../components/PasswordInput";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isPasswordWithinHashLimit } from "../lib/passwordPolicy";
import { CaptchaWidget } from "../components/CaptchaWidget";

export function SignupPage() {
  const navigate = useNavigate();
  const { signup, isLoading, error } = useAuth();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    lastName: "",
    password: "",
    confirmPassword: "",
    countryCode: "ES",
    locale: "es" as "es" | "en" | "de" | "de-CH",
    acceptedTerms: false,
    acceptedPrivacy: false,
    captchaToken: "",
    accountType: "member" as "member" | "administrator",
    facilityName: "",
    facilityType: "traditional_gym",
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [validationError, setValidationError] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const { t, i18n } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const continueToPreferences = () => {
    setValidationError("");
    if (
      !formData.email ||
      !formData.name ||
      !formData.lastName ||
      !formData.password ||
      !formData.confirmPassword ||
      (formData.accountType === "administrator" && !formData.facilityName)
    ) {
      setValidationError(t("auth.allRequired"));
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setValidationError(t("auth.passwordMismatch"));
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");

    if (
      !formData.countryCode ||
      !formData.locale ||
      !formData.acceptedTerms ||
      !formData.acceptedPrivacy ||
      !formData.captchaToken
    ) {
      setValidationError(t("auth.allRequired"));
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setValidationError(t("auth.passwordMismatch"));
      return;
    }

    if (
      formData.password.length < 12 ||
      !isPasswordWithinHashLimit(formData.password) ||
      !/[a-z]/.test(formData.password) ||
      !/[A-Z]/.test(formData.password) ||
      !/[0-9]/.test(formData.password)
    ) {
      setValidationError(t("auth.passwordPolicy"));
      return;
    }

    try {
      const verification = await signup({
        email: formData.email,
        name: formData.name,
        lastName: formData.lastName,
        password: formData.password,
        countryCode: formData.countryCode,
        locale: formData.locale,
        acceptedTerms: formData.acceptedTerms,
        acceptedPrivacy: formData.acceptedPrivacy,
        captchaToken: formData.captchaToken,
        accountType: formData.accountType,
        facilityName:
          formData.accountType === "administrator"
            ? formData.facilityName
            : undefined,
        facilityType:
          formData.accountType === "administrator"
            ? formData.facilityType
            : undefined,
      });
      await i18n.changeLanguage(formData.locale);
      if (verification.verificationRequired) {
        navigate("/verify-email", {
          state: { demoVerificationCode: verification.demoVerificationCode },
        });
      } else {
        navigate("/classes");
      }
    } catch (err) {
      setFormData((current) => ({ ...current, captchaToken: "" }));
      setCaptchaResetSignal((value) => value + 1);
      console.error("Signup error:", err);
    }
  };

  return (
    <AuthShell
      eyebrow={t("auth.join")}
      title={t("auth.createTitle")}
      description={t("auth.createDescription")}
    >
      {(error || validationError) && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3.5">
          <p className="text-sm text-red-600">{error || validationError}</p>
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p className="mb-3 text-sm font-medium text-blue-950">
          {t("auth.verificationRequired")}
        </p>
        <CaptchaWidget
          action="signup"
          onToken={(captchaToken) =>
            setFormData((current) => ({ ...current, captchaToken }))
          }
          resetSignal={captchaResetSignal}
        />
      </div>

      {formData.captchaToken ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700">
            <span>{t("auth.signupStep", { step, total: 2 })}</span>
            <span className="h-1 flex-1 rounded-full bg-slate-100">
              <span
                className="block h-1 rounded-full bg-blue-600"
                style={{ width: `${step * 50}%` }}
              />
            </span>
          </div>
          {step === 1 ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">
                  {t("auth.accountType")}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["member", "administrator"] as const).map((accountType) => (
                    <label
                      key={accountType}
                      className={`rounded-xl border p-3 text-sm ${
                        formData.accountType === accountType
                          ? "border-blue-500 bg-blue-50 text-blue-950"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <input
                        className="mr-2"
                        type="radio"
                        name="accountType"
                        value={accountType}
                        checked={formData.accountType === accountType}
                        onChange={() =>
                          setFormData((current) => ({
                            ...current,
                            accountType,
                          }))
                        }
                      />
                      {t(`auth.accountTypes.${accountType}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              {formData.accountType === "administrator" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="facilityName">
                      {t("auth.facilityName")}
                    </Label>
                    <Input
                      id="facilityName"
                      name="facilityName"
                      value={formData.facilityName}
                      onChange={handleChange}
                      maxLength={120}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="facilityType">
                      {t("auth.facilityType")}
                    </Label>
                    <select
                      id="facilityType"
                      value={formData.facilityType}
                      onChange={(event) =>
                        setFormData((current) => ({
                          ...current,
                          facilityType: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"
                    >
                      {[
                        "traditional_gym",
                        "crossfit",
                        "hyrox",
                        "functional_training",
                        "personal_training",
                        "powerlifting",
                        "strongman",
                        "bodybuilding",
                        "martial_arts",
                        "yoga",
                        "pilates",
                        "indoor_cycling",
                        "multidisciplinary",
                        "custom",
                      ].map((facilityType) => (
                        <option key={facilityType} value={facilityType}>
                          {t(`commercial.facilityTypes.${facilityType}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                    {t("auth.administratorTrialNotice")}
                  </p>
                </>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-700">
                  {t("auth.emailAddress")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="your@email.com"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3 focus-visible:bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-slate-700">
                  {t("auth.lastName")}
                </Label>
                <Input
                  id="lastName"
                  type="text"
                  name="lastName"
                  autoComplete="family-name"
                  value={formData.lastName}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-700">
                  {t("auth.fullName")}
                </Label>
                <Input
                  id="name"
                  type="text"
                  name="name"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={handleChange}
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
                  name="password"
                  placeholder="••••••••"
                  value={formData.password}
                  maxLength={256}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3 focus-visible:bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-700">
                  {t("auth.confirmPassword")}
                </Label>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  maxLength={256}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3 focus-visible:bg-white"
                />
              </div>

              <Button
                type="button"
                className="h-11 w-full rounded-xl bg-blue-600 shadow-md shadow-blue-600/15 hover:bg-blue-700"
                disabled={isLoading}
                onClick={continueToPreferences}
              >
                <span>{t("common.continue")}</span>
                <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="countryCode">{t("auth.country")}</Label>
                <select
                  id="countryCode"
                  value={formData.countryCode}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      countryCode: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"
                >
                  {[
                    "ES",
                    "DE",
                    "CH",
                    "AT",
                    "NL",
                    "PT",
                    "FR",
                    "IT",
                    "GB",
                    "US",
                  ].map((country) => (
                    <option key={country} value={country}>
                      {t(`auth.countries.${country}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="locale">{t("auth.preferredLanguage")}</Label>
                <select
                  id="locale"
                  value={formData.locale}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      locale: event.target.value as typeof current.locale,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="de-CH">Deutsch (Schweiz)</option>
                </select>
              </div>
              <label className="flex gap-3 rounded-xl border border-slate-200 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={formData.acceptedTerms}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      acceptedTerms: event.target.checked,
                    }))
                  }
                />
                <span>
                  {t("auth.acceptTermsPrefix")}{" "}
                  <Link
                    className="font-semibold text-blue-700"
                    to="/terms-and-conditions"
                  >
                    {t("legal.footer.terms")}
                  </Link>
                </span>
              </label>
              <label className="flex gap-3 rounded-xl border border-slate-200 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={formData.acceptedPrivacy}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      acceptedPrivacy: event.target.checked,
                    }))
                  }
                />
                <span>{t("auth.acceptPrivacy")}</span>
              </label>
              <p className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                {t("auth.emailVerificationPending")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  {t("common.back")}
                </Button>
                <Button type="submit" className="flex-1" disabled={isLoading}>
                  {isLoading
                    ? t("auth.creatingAccount")
                    : t("auth.createAccount")}
                </Button>
              </div>
            </>
          )}
        </form>
      ) : null}

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          {t("auth.hasAccount")}{" "}
          <Link
            to="/login"
            className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

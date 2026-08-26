import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeEuro,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Database,
  Globe2,
  LoaderCircle,
  MapPin,
  Palette,
  RefreshCw,
  Save,
  Share2,
  Timer,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import {
  commercialFacilityTypes,
  type CommercialFacilityType,
  type CommercialConversionDraft,
  type CommercialTrialSetup,
  type ConversionDecision,
  type ConversionOrigin,
  type CommercialTrialOverview,
} from "../lib/commercial";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const emptyForm = {
  facilityName: "",
  facilityType: "traditional_gym" as CommercialFacilityType,
  subdomain: "",
  classTypes: "",
  scheduleNotes: "",
  locale: "es" as "es" | "en" | "de" | "de-CH",
  currency: "EUR",
  usesBookings: true,
  usesWaitlist: true,
  publicDescription: "",
  addressLine: "",
  city: "",
  postalCode: "",
  country: "",
  websiteUrl: "",
  instagramUrl: "",
  facebookUrl: "",
  tiktokUrl: "",
  youtubeUrl: "",
  linkedinUrl: "",
  pricingDescription: "",
  bonusesDescription: "",
  publicPageEnabled: false,
  logoDataUrl: "",
  accentColor: "#2563eb",
};

const wizardSteps = [
  "identity",
  "branding",
  "location",
  "address",
  "socials",
  "operations",
  "offers",
  "review",
] as const;
type WizardStep = (typeof wizardSteps)[number];
const wizardStepIcons = {
  identity: Building2,
  branding: Palette,
  location: MapPin,
  operations: Activity,
  address: Globe2,
  socials: Share2,
  offers: BadgeEuro,
  review: ClipboardCheck,
} satisfies Record<WizardStep, typeof Building2>;

function suggestSubdomain(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

type CommercialTrialErrorBody = {
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
};

class CommercialTrialRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function CommercialTrialPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<CommercialTrialOverview | null>(
    null,
  );
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(0);
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [tenantBaseDomain, setTenantBaseDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversionDraft, setConversionDraft] =
    useState<CommercialConversionDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const formatRequestError = useCallback(
    (cause: unknown) => {
      if (cause instanceof CommercialTrialRequestError) {
        if (cause.code === "COMMERCIAL_TRIALS_DISABLED")
          return t("commercial.trial.errors.provisioningDisabled");
        if (cause.code === "COMMERCIAL_TRIAL_EDIT_COOLDOWN")
          return t("commercial.trial.errors.editCooldown", {
            count: Math.max(1, Math.ceil((cause.retryAfterSeconds ?? 60) / 60)),
          });
        if (cause.code === "COMMERCIAL_TRIAL_NOT_EDITABLE")
          return t("commercial.trial.errors.notEditable");
        if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_INVALID")
          return t("commercial.trial.errors.subdomainInvalid");
        if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_UNAVAILABLE")
          return t("commercial.trial.errors.subdomainUnavailable");
        if (cause.code === "COMMERCIAL_TRIAL_SUBDOMAIN_LOCKED")
          return t("commercial.trial.errors.subdomainLocked");
      }
      return cause instanceof Error ? cause.message : String(cause);
    },
    [t],
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await authFetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
      const body = (await response.json()) as CommercialTrialErrorBody;
      if (!response.ok)
        throw new CommercialTrialRequestError(
          body.error ?? t("commercial.trial.requestFailed"),
          body.code,
          body.retryAfterSeconds,
        );
      return body as T;
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      const setup = await request<CommercialTrialSetup>(
        "/api/commercial/trial/setup",
      );
      setTenantBaseDomain(setup.tenantBaseDomain);
      const result = await request<CommercialTrialOverview | null>(
        "/api/commercial/trial",
      );
      setOverview(result);
      if (result?.trial.realDataDeclaration === "yes") {
        setConversionDraft(
          await request<CommercialConversionDraft>(
            "/api/commercial/trial/conversion-draft",
          ),
        );
      } else {
        setConversionDraft(null);
      }
      if (result) {
        const trial = result.trial;
        setForm({
          facilityName: trial.facilityName,
          facilityType: trial.facilityType,
          subdomain: trial.subdomain,
          classTypes: trial.classTypes.join(", "),
          scheduleNotes: trial.scheduleNotes,
          locale: trial.locale,
          currency: trial.currency,
          usesBookings: trial.usesBookings,
          usesWaitlist: trial.usesWaitlist,
          publicDescription: trial.publicDescription,
          addressLine: trial.addressLine,
          city: trial.city,
          postalCode: trial.postalCode,
          country: trial.country,
          websiteUrl: trial.websiteUrl,
          instagramUrl: trial.instagramUrl,
          facebookUrl: trial.facebookUrl,
          tiktokUrl: trial.tiktokUrl,
          youtubeUrl: trial.youtubeUrl,
          linkedinUrl: trial.linkedinUrl,
          pricingDescription: trial.pricingDescription,
          bonusesDescription: trial.bonusesDescription,
          publicPageEnabled: trial.publicPageEnabled,
          logoDataUrl: result.branding.logoDataUrl,
          accentColor: result.branding.accentColor,
        });
        setSubdomainTouched(true);
      }
      setError("");
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setLoading(false);
    }
  }, [formatRequestError, request]);

  useEffect(() => void load(), [load]);

  const persistForm = async (publicPageEnabled = form.publicPageEnabled) => {
    setSaving(true);
    try {
      const { subdomain, ...configuration } = form;
      const payload = {
        ...configuration,
        publicPageEnabled,
        ...(!overview || overview.trial.status === "trial_active"
          ? { subdomain }
          : {}),
        classTypes: form.classTypes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const previousTenantOrigin = overview?.environment.tenantOrigin;
      const result = await request<CommercialTrialOverview>(
        "/api/commercial/trial",
        {
          method: overview ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setOverview(result);
      setForm((current) => ({ ...current, publicPageEnabled }));
      setTenantBaseDomain(result.environment.tenantBaseDomain);
      setError("");
      if (
        previousTenantOrigin === window.location.origin &&
        result.environment.tenantOrigin &&
        result.environment.tenantOrigin !== window.location.origin
      ) {
        window.location.assign(
          `${result.environment.tenantOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
      }
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await persistForm();
  };

  const deletePublicProfile = async () => {
    if (
      !overview ||
      !window.confirm(t("commercial.trial.fields.deletePublicPageConfirm"))
    )
      return;
    setSaving(true);
    try {
      await request<CommercialTrialOverview>("/api/commercial/trial", {
        method: "PATCH",
        body: JSON.stringify({
          publicDescription: "",
          addressLine: "",
          city: "",
          postalCode: "",
          country: "",
          websiteUrl: "",
          instagramUrl: "",
          facebookUrl: "",
          tiktokUrl: "",
          youtubeUrl: "",
          linkedinUrl: "",
          pricingDescription: "",
          bonusesDescription: "",
          publicPageEnabled: false,
        }),
      });
      await load();
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setSaving(false);
    }
  };

  const restoreConfiguration = async () => {
    setSaving(true);
    try {
      await request("/api/commercial/trial/restore-configuration", {
        method: "POST",
        body: "{}",
      });
      await load();
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setSaving(false);
    }
  };

  const declareData = async (decision: "yes" | "no" | "assistance") => {
    setSaving(true);
    try {
      const result = await request<CommercialTrialOverview>(
        "/api/commercial/trial/real-data-declaration",
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      setOverview(result);
      if (decision === "yes") {
        setConversionDraft(
          await request<CommercialConversionDraft>(
            "/api/commercial/trial/conversion-draft",
          ),
        );
      }
      setError("");
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setSaving(false);
    }
  };

  const classifyItem = async (
    category: string,
    origin: ConversionOrigin,
    decision: ConversionDecision,
  ) => {
    try {
      setConversionDraft(
        await request<CommercialConversionDraft>(
          "/api/commercial/trial/conversion-draft",
          {
            method: "PATCH",
            body: JSON.stringify({ category, origin, decision }),
          },
        ),
      );
      setError("");
    } catch (cause) {
      setError(formatRequestError(cause));
    }
  };

  const closeTrial = async () => {
    setSaving(true);
    try {
      setOverview(
        await request<CommercialTrialOverview>("/api/commercial/trial/close", {
          method: "POST",
          body: "{}",
        }),
      );
      setError("");
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setSaving(false);
    }
  };

  const canConfigure =
    !overview ||
    overview.trial.status === "trial_active" ||
    overview.trial.status === "trial_expired" ||
    overview.trial.status === "trial_converted";
  const canEditSubdomain =
    !overview || overview.trial.status === "trial_active";
  const activeStep = wizardSteps[step];
  const ActiveStepIcon = wizardStepIcons[activeStep];

  const updateFacilityName = (facilityName: string) => {
    setForm((current) => ({
      ...current,
      facilityName,
      ...(!subdomainTouched
        ? { subdomain: suggestSubdomain(facilityName) }
        : {}),
    }));
  };

  const advanceStep = () => {
    if (!formRef.current?.reportValidity()) return;
    setStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  };

  const selectLogo = (file: File | undefined) => {
    if (!file) return;
    if (
      file.size > 512 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setError(t("commercial.trial.errors.logoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setForm((current) => ({
        ...current,
        logoDataUrl: reader.result as string,
      }));
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const configurationWizard = canConfigure ? (
    <Card className="mt-8 overflow-hidden border-slate-200 shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-br from-slate-950 to-blue-950 px-6 py-7 text-white md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
              {t("commercial.trial.wizard.eyebrow")}
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {t(`commercial.trial.wizard.steps.${activeStep}.title`)}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {t(`commercial.trial.wizard.steps.${activeStep}.description`)}
            </p>
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-semibold">
            {t("commercial.trial.wizard.progress", {
              current: step + 1,
              total: wizardSteps.length,
            })}
          </span>
        </div>
        <div
          className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-label={t("commercial.trial.wizard.progressLabel")}
          aria-valuemin={1}
          aria-valuemax={wizardSteps.length}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-400 transition-[width]"
            style={{ width: `${((step + 1) / wizardSteps.length) * 100}%` }}
          />
        </div>
        <ol className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-8">
          {wizardSteps.map((wizardStep, index) => {
            const StepIcon = wizardStepIcons[wizardStep];
            const isCurrent = index === step;
            const isComplete = index < step;
            return (
              <li key={wizardStep}>
                <button
                  type="button"
                  onClick={() => index <= step && setStep(index)}
                  disabled={index > step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold transition-colors ${
                    isCurrent
                      ? "bg-white text-slate-950"
                      : isComplete
                        ? "text-emerald-300 hover:bg-white/10"
                        : "text-slate-500"
                  }`}
                >
                  {isComplete ? (
                    <Check className="size-4 shrink-0" />
                  ) : (
                    <StepIcon className="size-4 shrink-0" />
                  )}
                  <span className="hidden sm:inline">
                    {t(`commercial.trial.wizard.steps.${wizardStep}.label`)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <form ref={formRef} onSubmit={submit} className="p-6 md:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
            <ActiveStepIcon className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              {t("commercial.trial.wizard.sectionLabel", { count: step + 1 })}
            </p>
            <p className="font-bold text-slate-950">
              {t(`commercial.trial.wizard.steps.${activeStep}.label`)}
            </p>
          </div>
        </div>

        {activeStep === "identity" && (
          <fieldset className="grid gap-5 md:grid-cols-2">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.identity.label")}
            </legend>
            <div className="md:col-span-2">
              <Label htmlFor="facilityName">
                {t("commercial.trial.fields.name")}
              </Label>
              <Input
                id="facilityName"
                required
                minLength={2}
                maxLength={120}
                autoComplete="organization"
                value={form.facilityName}
                onChange={(event) => updateFacilityName(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="publicDescription">
                {t("commercial.trial.fields.publicDescription")}
              </Label>
              <textarea
                id="publicDescription"
                maxLength={2000}
                className="mt-2 min-h-28 w-full rounded-md border border-slate-200 p-3"
                value={form.publicDescription}
                onChange={(event) =>
                  setForm({ ...form, publicDescription: event.target.value })
                }
                placeholder={t("commercial.trial.fields.publicDescriptionHelp")}
              />
            </div>
            <div>
              <Label htmlFor="facilityType">
                {t("commercial.trial.fields.type")}
              </Label>
              <select
                id="facilityType"
                className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3"
                value={form.facilityType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    facilityType: event.target.value as CommercialFacilityType,
                  })
                }
              >
                {commercialFacilityTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`commercial.facilityTypes.${type}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="locale">
                {t("commercial.trial.fields.language")}
              </Label>
              <select
                id="locale"
                className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3"
                value={form.locale}
                onChange={(event) =>
                  setForm({
                    ...form,
                    locale: event.target.value as typeof form.locale,
                  })
                }
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="de-CH">Deutsch (CH)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="currency">
                {t("commercial.trial.fields.currency")}
              </Label>
              <Input
                id="currency"
                required
                maxLength={3}
                pattern="[A-Za-z]{3}"
                value={form.currency}
                onChange={(event) =>
                  setForm({
                    ...form,
                    currency: event.target.value.toUpperCase(),
                  })
                }
              />
            </div>
          </fieldset>
        )}

        {activeStep === "branding" && (
          <fieldset className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.branding.label")}
            </legend>
            <div className="space-y-5">
              <div>
                <Label htmlFor="centreLogo">
                  {t("commercial.trial.fields.logo")}
                </Label>
                <Input
                  id="centreLogo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => selectLogo(event.target.files?.[0])}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {t("commercial.trial.fields.logoHelp")}
                </p>
              </div>
              <div>
                <Label htmlFor="accentColor">
                  {t("commercial.trial.fields.accentColor")}
                </Label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="accentColor"
                    type="color"
                    value={form.accentColor}
                    onChange={(event) =>
                      setForm({ ...form, accentColor: event.target.value })
                    }
                    className="h-11 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                  />
                  <Input
                    aria-label={t("commercial.trial.fields.accentColor")}
                    value={form.accentColor}
                    pattern="#[0-9a-fA-F]{6}"
                    maxLength={7}
                    onChange={(event) =>
                      setForm({ ...form, accentColor: event.target.value })
                    }
                    className="max-w-36 font-mono"
                  />
                </div>
              </div>
            </div>
            <div
              className="flex min-h-52 items-center justify-center rounded-3xl border border-slate-200 p-6"
              style={{ backgroundColor: `${form.accentColor}18` }}
            >
              {form.logoDataUrl ? (
                <img
                  src={form.logoDataUrl}
                  alt={t("commercial.trial.fields.logoPreview")}
                  className="max-h-36 max-w-full object-contain"
                />
              ) : (
                <div className="text-center">
                  <div
                    className="mx-auto grid size-20 place-items-center rounded-3xl text-3xl font-black text-white"
                    style={{ backgroundColor: form.accentColor }}
                  >
                    {form.facilityName.trim().charAt(0).toUpperCase() || "U"}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-600">
                    {t("commercial.trial.fields.logoPreview")}
                  </p>
                </div>
              )}
            </div>
          </fieldset>
        )}

        {activeStep === "location" && (
          <fieldset className="grid gap-5 md:grid-cols-2">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.location.label")}
            </legend>
            <div className="md:col-span-2">
              <Label htmlFor="addressLine">
                {t("commercial.trial.fields.addressLine")}
              </Label>
              <Input
                id="addressLine"
                maxLength={240}
                autoComplete="street-address"
                value={form.addressLine}
                onChange={(event) =>
                  setForm({ ...form, addressLine: event.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="city">{t("commercial.trial.fields.city")}</Label>
              <Input
                id="city"
                maxLength={120}
                autoComplete="address-level2"
                value={form.city}
                onChange={(event) =>
                  setForm({ ...form, city: event.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="postalCode">
                {t("commercial.trial.fields.postalCode")}
              </Label>
              <Input
                id="postalCode"
                maxLength={24}
                autoComplete="postal-code"
                value={form.postalCode}
                onChange={(event) =>
                  setForm({ ...form, postalCode: event.target.value })
                }
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="country">
                {t("commercial.trial.fields.country")}
              </Label>
              <Input
                id="country"
                maxLength={120}
                autoComplete="country-name"
                value={form.country}
                onChange={(event) =>
                  setForm({ ...form, country: event.target.value })
                }
              />
            </div>
            <p className="md:col-span-2 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {t("commercial.trial.fields.locationHelp")}
            </p>
          </fieldset>
        )}

        {activeStep === "operations" && (
          <fieldset className="space-y-6">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.operations.label")}
            </legend>
            <div>
              <Label htmlFor="classTypes">
                {t("commercial.trial.fields.classTypes")}
              </Label>
              <Input
                id="classTypes"
                maxLength={1618}
                value={form.classTypes}
                onChange={(event) =>
                  setForm({ ...form, classTypes: event.target.value })
                }
                placeholder={t("commercial.trial.fields.classTypesHelp")}
              />
            </div>
            <div>
              <Label htmlFor="scheduleNotes">
                {t("commercial.trial.fields.schedule")}
              </Label>
              <textarea
                id="scheduleNotes"
                maxLength={2000}
                className="mt-2 min-h-32 w-full rounded-md border border-slate-200 p-3"
                value={form.scheduleNotes}
                onChange={(event) =>
                  setForm({ ...form, scheduleNotes: event.target.value })
                }
                placeholder={t("commercial.trial.fields.scheduleHelp")}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(["usesBookings", "usesWaitlist"] as const).map((field) => (
                <label
                  key={field}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                    form[field]
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form[field]}
                    onChange={(event) =>
                      setForm({ ...form, [field]: event.target.checked })
                    }
                  />
                  <span>
                    <strong className="block text-sm text-slate-950">
                      {t(`commercial.trial.fields.${field}`)}
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      {t(`commercial.trial.fields.${field}Help`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {activeStep === "address" && (
          <fieldset>
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.address.label")}
            </legend>
            {canEditSubdomain ? (
              <>
                <Label htmlFor="subdomain">
                  {t("commercial.trial.fields.subdomain")}
                </Label>
                <div className="mt-2 flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                  <input
                    id="subdomain"
                    required
                    minLength={1}
                    maxLength={63}
                    pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
                    value={form.subdomain}
                    onChange={(event) => {
                      setSubdomainTouched(true);
                      setForm({
                        ...form,
                        subdomain: event.target.value.toLowerCase(),
                      });
                    }}
                    className="min-w-0 flex-1 px-4 py-3 font-mono text-sm outline-none"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {tenantBaseDomain && (
                    <span className="flex shrink-0 items-center border-l border-slate-300 bg-slate-100 px-4 font-mono text-sm font-semibold text-slate-600">
                      .{tenantBaseDomain}
                    </span>
                  )}
                </div>
                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                    {t("commercial.trial.fields.addressPreview")}
                  </p>
                  <p className="mt-2 break-all font-mono text-sm font-semibold text-blue-950 sm:text-base">
                    https://
                    {form.subdomain ||
                      t("commercial.trial.fields.subdomainPlaceholder")}
                    {tenantBaseDomain ? `.${tenantBaseDomain}` : ""}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-blue-900">
                    {t(
                      overview?.environment.routing === "tenant_subdomain"
                        ? "commercial.trial.fields.subdomainHelpActive"
                        : "commercial.trial.fields.subdomainHelpReserved",
                    )}
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-950">
                  {t("commercial.trial.fields.subdomainLockedLabel")}
                </p>
                <p className="mt-2 break-all font-mono text-sm text-blue-700">
                  https://{form.subdomain}
                  {tenantBaseDomain ? `.${tenantBaseDomain}` : ""}
                </p>
              </div>
            )}
          </fieldset>
        )}

        {activeStep === "socials" && (
          <fieldset className="grid gap-5 md:grid-cols-2">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.socials.label")}
            </legend>
            {(
              [
                "websiteUrl",
                "instagramUrl",
                "facebookUrl",
                "tiktokUrl",
                "youtubeUrl",
                "linkedinUrl",
              ] as const
            ).map((field, index) => (
              <div key={field} className={index === 0 ? "md:col-span-2" : ""}>
                <Label htmlFor={field}>
                  {t(`commercial.trial.fields.${field}`)}
                </Label>
                <Input
                  id={field}
                  type="url"
                  maxLength={500}
                  placeholder="https://"
                  value={form[field]}
                  onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                  }
                />
              </div>
            ))}
            <p className="md:col-span-2 text-sm leading-6 text-slate-600">
              {t("commercial.trial.fields.socialsHelp")}
            </p>
          </fieldset>
        )}

        {activeStep === "offers" && (
          <fieldset className="space-y-6">
            <legend className="sr-only">
              {t("commercial.trial.wizard.steps.offers.label")}
            </legend>
            <div>
              <Label htmlFor="pricingDescription">
                {t("commercial.trial.fields.pricingDescription")}
              </Label>
              <textarea
                id="pricingDescription"
                maxLength={4000}
                className="mt-2 min-h-36 w-full rounded-md border border-slate-200 p-3"
                value={form.pricingDescription}
                onChange={(event) =>
                  setForm({ ...form, pricingDescription: event.target.value })
                }
                placeholder={t(
                  "commercial.trial.fields.pricingDescriptionHelp",
                )}
              />
            </div>
            <div>
              <Label htmlFor="bonusesDescription">
                {t("commercial.trial.fields.bonusesDescription")}
              </Label>
              <textarea
                id="bonusesDescription"
                maxLength={4000}
                className="mt-2 min-h-28 w-full rounded-md border border-slate-200 p-3"
                value={form.bonusesDescription}
                onChange={(event) =>
                  setForm({ ...form, bonusesDescription: event.target.value })
                }
                placeholder={t(
                  "commercial.trial.fields.bonusesDescriptionHelp",
                )}
              />
            </div>
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              {t("commercial.trial.fields.offersHelp")}
            </p>
          </fieldset>
        )}

        {activeStep === "review" && (
          <div className="space-y-4">
            {(
              [
                "identity",
                "branding",
                "location",
                "address",
                "socials",
                "operations",
                "offers",
              ] as const
            ).map((reviewStep) => (
              <section
                key={reviewStep}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-bold text-slate-950">
                    {t(`commercial.trial.wizard.steps.${reviewStep}.label`)}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep(wizardSteps.indexOf(reviewStep))}
                  >
                    {t("commercial.trial.wizard.edit")}
                  </Button>
                </div>
                {reviewStep === "identity" && (
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.name")}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {form.facilityName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.type")}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {t(`commercial.facilityTypes.${form.facilityType}`)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.language")}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {form.locale}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.currency")}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {form.currency}
                      </dd>
                    </div>
                  </dl>
                )}
                {reviewStep === "operations" && (
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.classTypes")}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {form.classTypes ||
                          t("commercial.trial.wizard.notProvided")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.schedule")}
                      </dt>
                      <dd className="whitespace-pre-wrap font-semibold text-slate-900">
                        {form.scheduleNotes ||
                          t("commercial.trial.wizard.notProvided")}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["usesBookings", "usesWaitlist"] as const).map(
                        (field) => (
                          <span
                            key={field}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${form[field] ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
                          >
                            {t(`commercial.trial.fields.${field}`)}:{" "}
                            {t(
                              form[field]
                                ? "commercial.trial.dataReview.yes"
                                : "commercial.trial.dataReview.no",
                            )}
                          </span>
                        ),
                      )}
                    </div>
                  </dl>
                )}
                {reviewStep === "branding" && (
                  <div className="mt-4 flex items-center gap-4">
                    {form.logoDataUrl ? (
                      <img
                        src={form.logoDataUrl}
                        alt=""
                        className="size-14 rounded-xl object-contain"
                      />
                    ) : (
                      <div
                        className="grid size-14 place-items-center rounded-xl font-black text-white"
                        style={{ backgroundColor: form.accentColor }}
                      >
                        {form.facilityName.trim().charAt(0).toUpperCase() ||
                          "U"}
                      </div>
                    )}
                    <span className="font-mono text-sm font-semibold text-slate-700">
                      {form.accentColor}
                    </span>
                  </div>
                )}
                {reviewStep === "location" && (
                  <p className="mt-4 text-sm font-semibold leading-6 text-slate-900">
                    {[
                      form.addressLine,
                      form.city,
                      form.postalCode,
                      form.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || t("commercial.trial.wizard.notProvided")}
                  </p>
                )}
                {reviewStep === "address" && (
                  <p className="mt-4 break-all font-mono text-sm font-semibold text-blue-700">
                    https://{form.subdomain}
                    {tenantBaseDomain ? `.${tenantBaseDomain}` : ""}
                  </p>
                )}
                {reviewStep === "socials" && (
                  <ul className="mt-4 space-y-1 text-sm text-slate-700">
                    {(
                      [
                        "websiteUrl",
                        "instagramUrl",
                        "facebookUrl",
                        "tiktokUrl",
                        "youtubeUrl",
                        "linkedinUrl",
                      ] as const
                    )
                      .filter((field) => form[field])
                      .map((field) => (
                        <li key={field} className="break-all">
                          {t(`commercial.trial.fields.${field}`)}: {form[field]}
                        </li>
                      ))}
                    {!form.websiteUrl &&
                      !form.instagramUrl &&
                      !form.facebookUrl &&
                      !form.tiktokUrl &&
                      !form.youtubeUrl &&
                      !form.linkedinUrl && (
                        <li>{t("commercial.trial.wizard.notProvided")}</li>
                      )}
                  </ul>
                )}
                {reviewStep === "offers" && (
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.pricingDescription")}
                      </dt>
                      <dd className="whitespace-pre-wrap font-semibold text-slate-900">
                        {form.pricingDescription ||
                          t("commercial.trial.wizard.notProvided")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">
                        {t("commercial.trial.fields.bonusesDescription")}
                      </dt>
                      <dd className="whitespace-pre-wrap font-semibold text-slate-900">
                        {form.bonusesDescription ||
                          t("commercial.trial.wizard.notProvided")}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
            ))}
            <section
              className={`rounded-2xl border p-5 ${form.publicPageEnabled ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}
            >
              <strong className="block text-slate-950">
                {t("commercial.trial.fields.publicPageEnabled")}
              </strong>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {t("commercial.trial.fields.publicPageEnabledHelp")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={saving}
                  variant={form.publicPageEnabled ? "outline" : "default"}
                  onClick={() => void persistForm(!form.publicPageEnabled)}
                >
                  {form.publicPageEnabled
                    ? t("commercial.trial.fields.unpublishPage")
                    : t("commercial.trial.fields.publishPage")}
                </Button>
                {overview && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void deletePublicProfile()}
                  >
                    <Trash2 /> {t("commercial.trial.fields.deletePublicPage")}
                  </Button>
                )}
              </div>
            </section>
            <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              {t(
                overview?.trial.status === "trial_active"
                  ? "commercial.trial.editPolicy.trial"
                  : "commercial.trial.editPolicy.afterTrial",
              )}
            </p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0 || saving}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft /> {t("commercial.trial.wizard.back")}
          </Button>
          {activeStep === "review" ? (
            <Button type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              {overview
                ? t("commercial.trial.save")
                : t("commercial.trial.create")}
            </Button>
          ) : (
            <Button type="button" onClick={advanceStep} disabled={saving}>
              {t("commercial.trial.wizard.next")} <ChevronRight />
            </Button>
          )}
        </div>
      </form>
    </Card>
  ) : null;

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <LoaderCircle className="animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
          {t("commercial.trial.eyebrow")}
        </p>
        <h1 className="mt-2 text-4xl font-black text-slate-950">
          {overview
            ? t("commercial.trial.editTitle")
            : t("commercial.trial.createTitle")}
        </h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          {t("commercial.trial.description")}
        </p>
        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">
                {t("commercial.trial.errors.title")}
              </p>
              <p className="mt-1 text-sm leading-6">{error}</p>
            </div>
          </div>
        )}
        {overview && (
          <Card className="mt-8 border-blue-200 bg-blue-50 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <Timer className="mt-1 shrink-0 text-blue-700" />
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-blue-700">
                  {t("commercial.trial.duration.label")}
                </p>
                <p className="mt-1 text-3xl font-black text-blue-950">
                  {t("commercial.trial.duration.remaining", {
                    count: overview.trial.notice.remainingDays,
                  })}
                </p>
                <p className="mt-2 text-sm leading-6 text-blue-900">
                  {t("commercial.trial.duration.transparent")}
                </p>
              </div>
            </div>
          </Card>
        )}
        {configurationWizard}
        {overview && (
          <Card className="mt-8 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Database className="text-violet-700" />
                  <h2 className="text-xl font-bold text-slate-950">
                    {t("commercial.trial.environment.title")}
                  </h2>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {t("commercial.trial.environment.sharedNotice")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={saving || overview.trial.status !== "trial_active"}
                onClick={() => void restoreConfiguration()}
              >
                <RefreshCw /> {t("commercial.trial.environment.restore")}
              </Button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Object.entries(overview.environment.counts).map(
                ([name, value]) => (
                  <div key={name} className="rounded-xl bg-slate-50 p-4">
                    <p className="text-2xl font-black text-slate-950">
                      {value}
                    </p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t(`commercial.trial.environment.counts.${name}`)}
                    </p>
                  </div>
                ),
              )}
            </div>
            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              {t("commercial.trial.environment.restoreLimit")}
            </p>
          </Card>
        )}
        {conversionDraft && (
          <Card className="mt-8 p-6 md:p-8">
            <h2 className="text-xl font-bold text-slate-950">
              {t("commercial.trial.conversionDraft.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t("commercial.trial.conversionDraft.description")}
            </p>
            <div className="mt-5 space-y-3">
              {conversionDraft.items.map((item) => (
                <div
                  key={item.category}
                  className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_12rem_10rem] md:items-center"
                >
                  <strong className="text-sm text-slate-900">
                    {t(
                      `commercial.trial.conversionDraft.categories.${item.category}`,
                    )}
                  </strong>
                  <select
                    aria-label={t("commercial.trial.conversionDraft.origin")}
                    className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={item.origin}
                    onChange={(event) =>
                      void classifyItem(
                        item.category,
                        event.target.value as ConversionOrigin,
                        item.decision,
                      )
                    }
                  >
                    {(
                      [
                        "demo_seed",
                        "user_created",
                        "imported",
                        "converted",
                      ] as const
                    ).map((origin) => (
                      <option key={origin} value={origin}>
                        {t(
                          `commercial.trial.conversionDraft.origins.${origin}`,
                        )}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("commercial.trial.conversionDraft.decision")}
                    className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={item.decision}
                    onChange={(event) =>
                      void classifyItem(
                        item.category,
                        item.origin,
                        event.target.value as ConversionDecision,
                      )
                    }
                  >
                    {(["pending", "keep", "discard"] as const).map(
                      (decision) => (
                        <option key={decision} value={decision}>
                          {t(
                            `commercial.trial.conversionDraft.decisions.${decision}`,
                          )}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              {t("commercial.trial.conversionDraft.limit")}
            </p>
          </Card>
        )}
        {overview && (
          <Card className="mt-8 p-6 md:p-8">
            <div className="flex items-center gap-3">
              <CircleHelp className="text-blue-700" />
              <h2 className="text-xl font-bold text-slate-950">
                {t("commercial.trial.dataReview.title")}
              </h2>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              {t("commercial.trial.dataReview.description")}
            </p>
            {overview.trial.realDataDeclaration === "undeclared" ? (
              <div className="mt-5 flex flex-wrap gap-3">
                {(["yes", "no", "assistance"] as const).map((decision) => (
                  <Button
                    key={decision}
                    type="button"
                    variant={decision === "yes" ? "default" : "outline"}
                    disabled={saving}
                    onClick={() => void declareData(decision)}
                  >
                    {t(`commercial.trial.dataReview.${decision}`)}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {t(
                  `commercial.trial.dataReview.states.${overview.trial.realDataDeclaration}`,
                )}
              </div>
            )}
            {overview.trial.realDataDeclaration === "no" &&
              overview.trial.status !== "trial_closed" && (
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-5"
                  disabled={saving}
                  onClick={() => void closeTrial()}
                >
                  <Trash2 /> {t("commercial.trial.dataReview.close")}
                </Button>
              )}
          </Card>
        )}
      </div>
    </main>
  );
}

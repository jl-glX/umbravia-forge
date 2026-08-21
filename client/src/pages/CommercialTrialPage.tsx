import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CircleHelp,
  Database,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import {
  commercialFacilityTypes,
  type CommercialFacilityType,
  type CommercialConversionDraft,
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
  approximateMembers: "",
  trainerCount: "",
  spaceCount: "",
  usualCapacity: "",
  classTypes: "",
  scheduleNotes: "",
  locale: "es" as "es" | "en" | "de" | "de-CH",
  currency: "EUR",
  usesBookings: true,
  usesWaitlist: true,
};

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
  const [loading, setLoading] = useState(true);
  const [conversionDraft, setConversionDraft] =
    useState<CommercialConversionDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
          approximateMembers: trial.approximateMembers?.toString() ?? "",
          trainerCount: trial.trainerCount?.toString() ?? "",
          spaceCount: trial.spaceCount?.toString() ?? "",
          usualCapacity: trial.usualCapacity?.toString() ?? "",
          classTypes: trial.classTypes.join(", "),
          scheduleNotes: trial.scheduleNotes,
          locale: trial.locale,
          currency: trial.currency,
          usesBookings: trial.usesBookings,
          usesWaitlist: trial.usesWaitlist,
        });
      }
      setError("");
    } catch (cause) {
      setError(formatRequestError(cause));
    } finally {
      setLoading(false);
    }
  }, [formatRequestError, request]);

  useEffect(() => void load(), [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const numberOrNull = (value: string) =>
        value === "" ? null : Number(value);
      const payload = {
        ...form,
        approximateMembers: numberOrNull(form.approximateMembers),
        trainerCount: numberOrNull(form.trainerCount),
        spaceCount: numberOrNull(form.spaceCount),
        usualCapacity: numberOrNull(form.usualCapacity),
        classTypes: form.classTypes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      setOverview(
        await request<CommercialTrialOverview>("/api/commercial/trial", {
          method: overview ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }),
      );
      setError("");
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
        {(!overview ||
          overview.trial.status === "trial_active" ||
          overview.trial.status === "trial_expired" ||
          overview.trial.status === "trial_converted") && (
          <Card className="mt-8 p-6 md:p-8">
            <form onSubmit={submit} className="space-y-6">
              <div className="flex items-center gap-3">
                <Building2 className="text-blue-700" />
                <h2 className="text-xl font-bold">
                  {t("commercial.trial.centreData")}
                </h2>
              </div>
              <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                {t(
                  overview?.trial.status === "trial_active"
                    ? "commercial.trial.editPolicy.trial"
                    : "commercial.trial.editPolicy.afterTrial",
                )}
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <Label htmlFor="facilityName">
                    {t("commercial.trial.fields.name")}
                  </Label>
                  <Input
                    id="facilityName"
                    required
                    minLength={2}
                    maxLength={120}
                    value={form.facilityName}
                    onChange={(e) =>
                      setForm({ ...form, facilityName: e.target.value })
                    }
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
                    onChange={(e) =>
                      setForm({
                        ...form,
                        facilityType: e.target.value as CommercialFacilityType,
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
                {(
                  [
                    "approximateMembers",
                    "trainerCount",
                    "spaceCount",
                    "usualCapacity",
                  ] as const
                ).map((field) => (
                  <div key={field}>
                    <Label htmlFor={field}>
                      {t(`commercial.trial.fields.${field}`)}
                    </Label>
                    <Input
                      id={field}
                      type="number"
                      min={field === "usualCapacity" ? "1" : "0"}
                      max={
                        field === "approximateMembers"
                          ? "1000000"
                          : field === "trainerCount"
                            ? "100000"
                            : field === "spaceCount"
                              ? "10000"
                              : "100000"
                      }
                      value={form[field]}
                      onChange={(e) =>
                        setForm({ ...form, [field]: e.target.value })
                      }
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <Label htmlFor="classTypes">
                    {t("commercial.trial.fields.classTypes")}
                  </Label>
                  <Input
                    id="classTypes"
                    maxLength={1618}
                    value={form.classTypes}
                    onChange={(e) =>
                      setForm({ ...form, classTypes: e.target.value })
                    }
                    placeholder={t("commercial.trial.fields.classTypesHelp")}
                  />
                </div>
                <div>
                  <Label htmlFor="currency">
                    {t("commercial.trial.fields.currency")}
                  </Label>
                  <Input
                    id="currency"
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    value={form.currency}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="locale">
                    {t("commercial.trial.fields.language")}
                  </Label>
                  <select
                    id="locale"
                    className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3"
                    value={form.locale}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        locale: e.target.value as typeof form.locale,
                      })
                    }
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="de-CH">Deutsch (CH)</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="scheduleNotes">
                    {t("commercial.trial.fields.schedule")}
                  </Label>
                  <textarea
                    id="scheduleNotes"
                    maxLength={2000}
                    className="mt-2 min-h-24 w-full rounded-md border border-slate-200 p-3"
                    value={form.scheduleNotes}
                    onChange={(e) =>
                      setForm({ ...form, scheduleNotes: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-5">
                {(["usesBookings", "usesWaitlist"] as const).map((field) => (
                  <label
                    key={field}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <input
                      type="checkbox"
                      checked={form[field]}
                      onChange={(e) =>
                        setForm({ ...form, [field]: e.target.checked })
                      }
                    />
                    {t(`commercial.trial.fields.${field}`)}
                  </label>
                ))}
              </div>
              {overview && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                  <Sparkles className="mb-2" />
                  {t("commercial.trial.provisionalAddress")}:{" "}
                  <strong>{overview.trial.subdomain}</strong>
                </div>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                {overview
                  ? t("commercial.trial.save")
                  : t("commercial.trial.create")}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}

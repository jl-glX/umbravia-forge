import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Languages,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";

interface StaffMemberAffiliationPolicy {
  allowAllStaff: boolean;
  staff: Array<{
    userId: string;
    name: string;
    email: string;
    role: "admin" | "trainer";
    specificallyAllowed: boolean;
    memberAffiliation: boolean;
  }>;
}

export function AccountPreferencesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFacilityOwner = user?.facility?.role === "owner";
  const [policy, setPolicy] = useState<StaffMemberAffiliationPolicy | null>(
    null,
  );
  const [loadingPolicy, setLoadingPolicy] = useState(isFacilityOwner);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isFacilityOwner) return;
    void authFetch("/api/users/member-affiliation-policy")
      .then(async (response) => {
        if (!response.ok) throw new Error("Preference unavailable");
        setPolicy((await response.json()) as StaffMemberAffiliationPolicy);
      })
      .catch(() => setError(t("accountPreferences.loadError")))
      .finally(() => setLoadingPolicy(false));
  }, [isFacilityOwner, t]);

  const savePolicy = async (
    allowAllStaff: boolean,
    specificallyAllowedUserIds: string[],
  ) => {
    setSavingPolicy(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch("/api/users/member-affiliation-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowAllStaff,
          specificallyAllowedUserIds,
        }),
      });
      if (!response.ok) throw new Error("Preference update failed");
      setPolicy((await response.json()) as StaffMemberAffiliationPolicy);
      setNotice(t("accountPreferences.saved"));
    } catch {
      setError(t("accountPreferences.saveError"));
    } finally {
      setSavingPolicy(false);
    }
  };

  const selectedStaffIds = () =>
    policy?.staff
      .filter((person) => person.specificallyAllowed)
      .map((person) => person.userId) ?? [];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link
          to="/account"
          className="inline-flex items-center gap-2 font-semibold text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {t("accountPreferences.back")}
        </Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
            {t("accountPreferences.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">
            {t("accountPreferences.title")}
          </h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            {t("accountPreferences.description")}
          </p>
        </header>

        {error && (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
            {notice}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <Languages aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  {t("accountPreferences.languageTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("accountPreferences.languageDescription")}
                </p>
                <div className="mt-4 w-fit rounded-xl border border-slate-200 p-1">
                  <LanguageSwitcher />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <ShieldCheck aria-hidden="true" />
              </span>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-950">
                  {t("accountPreferences.privacyTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("accountPreferences.privacyDescription")}
                </p>
                <Link
                  to="/account/data"
                  className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800"
                >
                  {t("accountPreferences.manageData")}
                </Link>
              </div>
            </div>
          </section>
        </div>

        {isFacilityOwner && (
          <section className="mt-6 rounded-3xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <Users aria-hidden="true" />
              </span>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-950">
                  {t("accountPreferences.staffMembersTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("accountPreferences.staffMembersDescription")}
                </p>

                {loadingPolicy ? (
                  <p className="mt-5 text-sm text-slate-500">
                    {t("common.loading")}
                  </p>
                ) : policy ? (
                  <div className="mt-5 space-y-5">
                    <fieldset disabled={savingPolicy}>
                      <legend className="font-semibold text-slate-900">
                        {t("accountPreferences.staffMembersQuestion")}
                      </legend>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {([true, false] as const).map((allowed) => (
                          <label
                            key={String(allowed)}
                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                              policy.allowAllStaff === allowed
                                ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name="account-staff-member-affiliations"
                              className="mt-1 h-4 w-4 accent-blue-600"
                              checked={policy.allowAllStaff === allowed}
                              onChange={() =>
                                void savePolicy(allowed, selectedStaffIds())
                              }
                            />
                            <span>
                              <span className="block font-semibold text-slate-950">
                                {allowed
                                  ? t("accountPreferences.yes")
                                  : t("accountPreferences.no")}
                              </span>
                              <span className="mt-1 block text-sm leading-5 text-slate-600">
                                {allowed
                                  ? t("accountPreferences.allowAllDescription")
                                  : t(
                                      "accountPreferences.allowSpecificDescription",
                                    )}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {policy.allowAllStaff ? (
                      <div
                        aria-disabled="true"
                        className="rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 text-slate-500"
                      >
                        <span className="block font-semibold">
                          {t("accountPreferences.specificPermissions")}
                        </span>
                        <span className="mt-1 block text-sm leading-5">
                          {t("accountPreferences.specificNotNeeded")}
                        </span>
                      </div>
                    ) : (
                      <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold text-slate-950 [&::-webkit-details-marker]:hidden">
                          <span>
                            {t("accountPreferences.specificPermissions")}
                            {policy.staff.length > 0 && (
                              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                                {t("accountPreferences.specificSelected", {
                                  count: selectedStaffIds().length,
                                })}
                              </span>
                            )}
                          </span>
                          <ChevronDown
                            size={20}
                            className="transition-transform group-open:rotate-180"
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="border-t border-slate-200 px-5 py-4">
                          <p className="text-sm leading-6 text-slate-600">
                            {t("accountPreferences.specificPermissionsHelp")}
                          </p>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {policy.staff.length === 0 ? (
                              <p className="text-sm text-slate-500">
                                {t("accountPreferences.noEligibleStaff")}
                              </p>
                            ) : (
                              policy.staff.map((person) => (
                                <label
                                  key={person.userId}
                                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={person.specificallyAllowed}
                                    className="mt-1 h-4 w-4 accent-blue-600"
                                    disabled={savingPolicy}
                                    onChange={(event) => {
                                      const selected = policy.staff
                                        .filter((candidate) =>
                                          candidate.userId === person.userId
                                            ? event.target.checked
                                            : candidate.specificallyAllowed,
                                        )
                                        .map((candidate) => candidate.userId);
                                      void savePolicy(
                                        policy.allowAllStaff,
                                        selected,
                                      );
                                    }}
                                  />
                                  <span>
                                    <span className="block font-medium text-slate-950">
                                      {person.name}
                                    </span>
                                    <span className="block text-xs text-slate-500">
                                      {person.email}
                                    </span>
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                      </details>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

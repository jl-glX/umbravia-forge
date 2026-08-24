import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Languages, ShieldCheck, Users } from "lucide-react";
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
      <div className="mx-auto max-w-5xl">
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

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-3">
            <Languages className="mt-1 shrink-0 text-blue-700" />
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

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 shrink-0 text-blue-700" />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-950">
                {t("accountPreferences.privacyTitle")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {t("accountPreferences.privacyDescription")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to="/privacy"
                  className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50"
                >
                  {t("accountPreferences.openPrivacy")}
                </Link>
                <Link
                  to="/account/delete-data"
                  className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50"
                >
                  {t("accountPreferences.manageData")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {isFacilityOwner && (
          <section className="mt-6 rounded-3xl border border-blue-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-3">
              <Users className="mt-1 shrink-0 text-blue-700" />
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
                      <div className="mt-3 flex gap-6">
                        {([true, false] as const).map((allowed) => (
                          <label
                            key={String(allowed)}
                            className="inline-flex items-center gap-2"
                          >
                            <input
                              type="radio"
                              name="account-staff-member-affiliations"
                              checked={policy.allowAllStaff === allowed}
                              onChange={() =>
                                void savePolicy(allowed, selectedStaffIds())
                              }
                            />
                            {allowed ? t("common.yes") : t("common.no")}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <summary className="cursor-pointer font-semibold text-slate-950">
                        {t("accountPreferences.specificPermissions")}
                      </summary>
                      <p className="mt-2 text-sm text-slate-600">
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
                              className="flex items-start gap-2 rounded-xl bg-white p-3 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={person.specificallyAllowed}
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
                    </details>
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

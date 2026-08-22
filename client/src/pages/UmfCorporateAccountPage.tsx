import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountSecurityPage } from "./AccountSecurityPage";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button } from "../components/ui/button";
import {
  fetchSupportSession,
  logoutSupport,
  type UmfSupportSessionUser,
} from "../lib/umf-support";

export function UmfCorporateAccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState<UmfSupportSessionUser | null | undefined>();

  const refresh = useCallback(async () => {
    setUser(await fetchSupportSession());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setUser(null));
  }, [refresh]);

  if (user === undefined) {
    return <p className="p-8 text-slate-600">{t("common.loading")}</p>;
  }
  if (!user) return <Navigate to="/umf-support/access" replace />;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-300 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[112rem] items-center gap-4 px-4 py-3 sm:px-6">
          {user.accessApproved ? (
            <Link
              to="/umf-support"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              <ArrowLeft size={17} /> {t("umfCorporateAccount.back")}
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">
              {t("umfCorporateAccount.title")}
            </p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <LanguageSwitcher />
          <Button
            variant="ghost"
            className="text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() =>
              void logoutSupport().then(() => navigate("/umf-support/access"))
            }
          >
            <LogOut size={17} /> {t("umfSupport.logout")}
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-[96rem] px-4 pt-8 sm:px-6">
        {!user.accessApproved ? (
          <div className="mb-5 rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <h1 className="text-xl font-black text-slate-950">
              {t("umfCorporateAccount.pendingApprovalTitle")}
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              {t("umfCorporateAccount.pendingApprovalBody")}
            </p>
          </div>
        ) : null}
        <div className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-1 shrink-0 text-cyan-800" />
            <div>
              <h1 className="text-2xl font-black text-slate-950">
                {t("umfCorporateAccount.heading")}
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                {t("umfCorporateAccount.boundary")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <AccountSecurityPage
        apiBase="/api/umf-support/account/security"
        accountUser={user}
        onAccountRefresh={refresh}
        corporate
      />
    </main>
  );
}

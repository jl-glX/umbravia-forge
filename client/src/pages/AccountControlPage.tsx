import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  CalendarDays,
  CreditCard,
  Download,
  KeyRound,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Timer,
  Trash2,
  UserRound,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { ProfilePhotoSettings } from "../components/ProfilePhotoSettings";
import { DelegationManager } from "../components/DelegationManager";
import { AccountSupportIdentifier } from "../components/AccountSupportIdentifier";
import { authFetch } from "../lib/api";
import { getAccessRole } from "../context/auth-context";

interface AccountManagerOverview {
  accountStatus: "pending_verification" | "active" | "security_review";
  security: {
    mfaEnabled: boolean;
    passkeyCount: number;
    activeSessionCount: number;
    recoveryCodesRemaining: number;
  };
  lifecycle: {
    currentState: string;
    inactivityMonths: number | null;
    lastMeaningfulActivityAt: number;
    deletionRequest: { graceEndsAt: number } | null;
    deletionExecutionEnabled: false;
  };
  recovery: {
    availableMethods: string[];
    plannedMethods: string[];
  };
  continuity: {
    status: "draft_available";
    executionEnabled: false;
    representations: Array<{ status: string }>;
  };
}

interface AccountShortcut {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

function ShortcutCard({
  shortcut,
  actionLabel,
}: {
  shortcut: AccountShortcut;
  actionLabel: string;
}) {
  const Icon = shortcut.icon;

  return (
    <Link
      to={shortcut.to}
      className="group flex min-h-64 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
    >
      <span className="inline-flex w-fit rounded-2xl bg-blue-50 p-3 text-blue-700">
        <Icon />
      </span>
      <h3 className="mt-4 text-lg font-bold text-slate-950">
        {shortcut.title}
      </h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-slate-600">
        {shortcut.description}
      </p>
      <span className="mt-5 inline-flex items-center gap-2 font-semibold text-blue-700">
        {actionLabel}
        <ArrowRight
          size={18}
          className="transition-transform group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}

export function AccountControlPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [overview, setOverview] = useState<AccountManagerOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const accessRole = getAccessRole(user);

  useEffect(() => {
    let active = true;
    authFetch("/api/account/manager")
      .then(async (response) => {
        if (!response.ok) throw new Error("Account overview unavailable");
        return (await response.json()) as AccountManagerOverview;
      })
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch(() => {
        if (active) setOverviewError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const personalLinks: AccountShortcut[] = [
    {
      to: "/account/security",
      icon: ShieldCheck,
      title: t("accountControl.security"),
      description: t("accountControl.securityDescription"),
    },
    {
      to: "/account/lifecycle",
      icon: Trash2,
      title: t("accountControl.lifecycle"),
      description: t("accountControl.lifecycleDescription"),
    },
    {
      to: "/account/continuity",
      icon: UserRoundCog,
      title: t("accountControl.continuity"),
      description: t("accountControl.continuityDescription"),
    },
    {
      to: "/downloads",
      icon: Download,
      title: t("accountControl.downloads"),
      description: t("accountControl.downloadsDescription"),
    },
  ];

  const memberLinks: AccountShortcut[] = [
    {
      to: "/my-bookings",
      icon: CalendarDays,
      title: t("accountControl.bookings"),
      description: t("accountControl.bookingsDescription"),
    },
    {
      to: "/my-payments",
      icon: ShoppingBag,
      title: t("accountControl.payments"),
      description: t("accountControl.paymentsDescription"),
    },
    {
      to: "/workout-timer",
      icon: Timer,
      title: t("accountControl.timer"),
      description: t("accountControl.timerDescription"),
    },
    {
      to: "/activity-dashboard",
      icon: BarChart3,
      title: t("accountControl.memberAnalytics"),
      description: t("accountControl.memberAnalyticsDescription"),
    },
  ];

  const trainerLinks: AccountShortcut[] = [
    {
      to: "/trainer-dashboard",
      icon: LayoutDashboard,
      title: t("accountControl.trainerDashboard"),
      description: t("accountControl.trainerDashboardDescription"),
    },
    {
      to: "/trainer-analytics",
      icon: BarChart3,
      title: t("accountControl.trainerAnalytics"),
      description: t("accountControl.trainerAnalyticsDescription"),
    },
  ];

  const adminLinks: AccountShortcut[] = [
    {
      to: "/admin-dashboard",
      icon: LayoutDashboard,
      title: t("accountControl.adminDashboard"),
      description: t("accountControl.adminDashboardDescription"),
    },
    {
      to: "/billing",
      icon: CreditCard,
      title: t("accountControl.billing"),
      description: t("accountControl.billingDescription"),
    },
    {
      to: "/admin-analytics",
      icon: BarChart3,
      title: t("accountControl.adminAnalytics"),
      description: t("accountControl.adminAnalyticsDescription"),
    },
  ];

  const roleLinks =
    accessRole === "member"
      ? memberLinks
      : accessRole === "trainer"
        ? trainerLinks
        : adminLinks;
  const roleSectionKey =
    accessRole === "member"
      ? "member"
      : accessRole === "trainer"
        ? "trainer"
        : "admin";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[96rem]">
        <header className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {user?.avatarDataUrl ? (
              <img
                src={user.avatarDataUrl}
                alt={user.name}
                className="h-24 w-24 rounded-full border-4 border-white/15 object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
                <UserRound size={40} />
              </span>
            )}
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
                {t("accountControl.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">
                {user?.name}
              </h1>
              <p className="mt-2 text-slate-300">
                {user?.email} · {accessRole && t(`roles.${accessRole}`)}
              </p>
            </div>
          </div>
        </header>

        <AccountSupportIdentifier />

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            {overviewError ? (
              <CircleAlert className="mt-1 shrink-0 text-amber-600" />
            ) : overview ? (
              <CircleCheck className="mt-1 shrink-0 text-emerald-600" />
            ) : (
              <LoaderCircle className="mt-1 shrink-0 animate-spin text-blue-600" />
            )}
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">
                {t("accountControl.managerEyebrow")}
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-950">
                {t("accountControl.managerTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {overviewError
                  ? t("accountControl.managerError")
                  : overview
                    ? t("accountControl.managerDescription")
                    : t("accountControl.managerLoading")}
              </p>
            </div>
          </div>

          {overview && (
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-950">
                  {t("accountControl.managerSecurity")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {t("accountControl.managerSecuritySummary", {
                    mfa: overview.security.mfaEnabled
                      ? t("accountControl.managerMfaEnabled")
                      : t("accountControl.managerMfaDisabled"),
                    passkeys: overview.security.passkeyCount,
                    sessions: overview.security.activeSessionCount,
                  })}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-950">
                  {t("accountControl.managerRecovery")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {t("accountControl.managerRecoverySummary", {
                    available: overview.recovery.availableMethods.length,
                    planned: overview.recovery.plannedMethods.length,
                  })}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-950">
                  {t("accountControl.managerLifecycle")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {overview.lifecycle.deletionRequest
                    ? t("accountControl.managerDeletionPending")
                    : overview.lifecycle.inactivityMonths
                      ? t("accountControl.managerInactivityEnabled", {
                          months: overview.lifecycle.inactivityMonths,
                        })
                      : t("accountControl.managerInactivityDisabled")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("accountControl.managerLifecycleState", {
                    state: t(
                      `accountLifecycle.states.${overview.lifecycle.currentState}`,
                    ),
                  })}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-950">
                  {t("accountControl.managerContinuity")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {t("accountControl.managerContinuityDrafts", {
                    count: overview.continuity.representations.filter((item) =>
                      ["draft", "pending_review"].includes(item.status),
                    ).length,
                  })}
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">
            {t("accountControl.personalSection")}
          </p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">
            {t("accountControl.personalSectionTitle")}
          </h2>
          <p className="mt-2 max-w-3xl text-slate-600">
            {t("accountControl.personalSectionDescription")}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {personalLinks.map((shortcut) => (
              <ShortcutCard
                key={shortcut.to}
                shortcut={shortcut}
                actionLabel={t("accountControl.open")}
              />
            ))}
            <div className="flex min-h-64 flex-col rounded-3xl border border-dashed border-slate-300 bg-white/60 p-6">
              <span className="inline-flex w-fit rounded-2xl bg-slate-100 p-3 text-slate-600">
                <Bell />
              </span>
              <h3 className="mt-4 text-lg font-bold text-slate-950">
                {t("accountControl.notifications")}
              </h3>
              <p className="mt-1 flex-1 text-sm leading-6 text-slate-600">
                {t("accountControl.notificationsDescription")}
              </p>
              <span className="mt-5 font-semibold text-slate-500">
                {t("accountControl.comingSoon")}
              </span>
            </div>
            <div className="flex min-h-64 flex-col rounded-3xl border border-dashed border-slate-300 bg-white/60 p-6">
              <span className="inline-flex w-fit rounded-2xl bg-slate-100 p-3 text-slate-600">
                <Settings2 />
              </span>
              <h3 className="mt-4 text-lg font-bold text-slate-950">
                {t("accountControl.preferences")}
              </h3>
              <p className="mt-1 flex-1 text-sm leading-6 text-slate-600">
                {t("accountControl.preferencesDescription")}
              </p>
              <span className="mt-5 font-semibold text-slate-500">
                {t("accountControl.comingSoon")}
              </span>
            </div>
          </div>
        </section>

        <section className="my-10">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">
            {t(`accountControl.${roleSectionKey}Section`)}
          </p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">
            {t(`accountControl.${roleSectionKey}SectionTitle`)}
          </h2>
          <p className="mt-2 max-w-3xl text-slate-600">
            {t(`accountControl.${roleSectionKey}SectionDescription`)}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roleLinks.map((shortcut) => (
              <ShortcutCard
                key={shortcut.to}
                shortcut={shortcut}
                actionLabel={t("accountControl.open")}
              />
            ))}
          </div>
          {accessRole !== "member" && (
            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm leading-6 text-blue-950">
              {t("accountControl.linkedMemberNotice")}
            </div>
          )}
        </section>

        <ProfilePhotoSettings />

        {accessRole === "member" && (
          <>
            <DelegationManager />
            <section className="mt-6 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 shrink-0" size={19} />
                <p>{t("accountControl.delegationSecurity")}</p>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

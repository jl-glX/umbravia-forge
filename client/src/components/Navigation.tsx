import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  CreditCard,
  LifeBuoy,
  Settings,
  Shield,
  Building2,
  ShoppingBag,
  Timer,
  X,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./BrandLogo";
import { BrandLockup } from "./BrandLockup";
import { useFacilityProfile } from "../hooks/useFacilityProfile";
import { AccountMenu } from "./AccountMenu";
import { BrandGlyph } from "./BrandGlyph";

export function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { profile } = useFacilityProfile();

  const isActive = (path: string) => location.pathname === path;

  const activeClass =
    "bg-brand-ember/10 text-brand-ember shadow-sm ring-1 ring-brand-ember/20";
  const inactiveClass =
    "text-slate-600 hover:bg-slate-100 hover:text-slate-950";
  const navLinkClass =
    "flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-all 2xl:gap-2 2xl:px-3";
  const analyticsPath =
    user?.role === "admin"
      ? "/admin-analytics"
      : user?.role === "trainer"
        ? "/trainer-analytics"
        : "/activity-dashboard";
  const historyIndex =
    typeof window.history.state?.idx === "number"
      ? window.history.state.idx
      : 0;
  const canGoBack = historyIndex > 0;
  const isHome = location.pathname === "/";
  const navigationButtonClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-path/35 hover:bg-brand-path/10 hover:text-brand-path disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600";

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 shadow-xs backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[112rem] px-2 sm:px-4 lg:px-6 2xl:px-8">
        <div className="flex min-h-18 min-w-0 items-center gap-2 lg:gap-3 2xl:gap-5">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-bold text-xl tracking-tight text-slate-950"
          >
            <BrandLogo className="h-10 w-10 rounded-xl shadow-lg shadow-slate-950/15 sm:hidden" />
            <BrandLockup className="hidden h-11 w-auto max-w-44 sm:block 2xl:max-w-52" />
          </Link>

          <div
            className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2 sm:pl-4"
            aria-label={t("navigationControls.label")}
          >
            <button
              type="button"
              className={navigationButtonClass}
              onClick={() => navigate(-1)}
              disabled={!canGoBack}
              aria-label={t("navigationControls.back")}
              title={t("navigationControls.back")}
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={navigationButtonClass}
              onClick={() => navigate("/")}
              disabled={isHome}
              aria-label={t("navigationControls.exit")}
              title={t("navigationControls.exit")}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="hidden shrink-0 items-center gap-2 border-l border-slate-200 pl-4 2xl:flex">
            {profile.logoDataUrl ? (
              <img
                src={profile.logoDataUrl}
                alt={profile.name}
                className="h-8 w-8 rounded-lg object-contain"
              />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: profile.accentColor }}
              >
                <Building2 size={16} />
              </span>
            )}
            <span className="max-w-32 truncate text-sm font-semibold text-slate-700 min-[1700px]:max-w-40">
              {profile.name}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-3 xl:gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link
              to="/"
              className={`${navLinkClass} ${
                isActive("/") ? activeClass : inactiveClass
              }`}
            >
              <BrandGlyph kind="guidance" size={20} />
              <span>{t("nav.home")}</span>
            </Link>

            <Link
              to="/classes"
              className={`${navLinkClass} ${
                isActive("/classes") ? activeClass : inactiveClass
              }`}
            >
              <BrandGlyph kind="structure" size={20} />
              <span>{t("nav.classes")}</span>
            </Link>

            <Link
              to="/community"
              className={`${navLinkClass} ${
                isActive("/community") ? activeClass : inactiveClass
              }`}
            >
              <BrandGlyph kind="community" size={20} />
              <span>{t("nav.community")}</span>
            </Link>

            <Link
              to="/support"
              className={`${navLinkClass} ${
                isActive("/support") ? activeClass : inactiveClass
              }`}
            >
              <LifeBuoy size={20} />
              <span>{t("nav.support")}</span>
            </Link>

            {user?.role === "admin" ? (
              <Link
                to="/billing"
                className={`${navLinkClass} ${
                  isActive("/billing") ? activeClass : inactiveClass
                }`}
              >
                <CreditCard size={20} />
                <span>{t("nav.billing")}</span>
              </Link>
            ) : (
              <Link
                to="/my-bookings"
                className={`${navLinkClass} ${
                  isActive("/my-bookings") ? activeClass : inactiveClass
                }`}
              >
                <Bookmark size={20} />
                <span>{t("nav.bookings")}</span>
              </Link>
            )}

            {user?.role === "trainer" && (
              <Link
                to="/trainer-dashboard"
                className={`${navLinkClass} ${
                  isActive("/trainer-dashboard") ? activeClass : inactiveClass
                }`}
              >
                <Settings size={20} />
                <span>{t("nav.dashboard")}</span>
              </Link>
            )}

            {user?.role === "member" && (
              <>
                <Link
                  to="/workout-timer"
                  className={`${navLinkClass} ${
                    isActive("/workout-timer") ? activeClass : inactiveClass
                  }`}
                >
                  <Timer size={20} />
                  <span>{t("nav.timer")}</span>
                </Link>
                <Link
                  to="/my-payments"
                  className={`${navLinkClass} ${
                    isActive("/my-payments") ? activeClass : inactiveClass
                  }`}
                >
                  <ShoppingBag size={20} />
                  <span>{t("nav.paymentsAndOrders")}</span>
                </Link>
              </>
            )}

            {user?.role === "admin" && (
              <>
                <Link
                  to="/admin/commercial-trial"
                  className={`${navLinkClass} ${
                    isActive("/admin/commercial-trial")
                      ? activeClass
                      : inactiveClass
                  }`}
                >
                  <BrandGlyph kind="evolution" size={20} />
                  <span>{t("nav.commercialTrial")}</span>
                </Link>
                <Link
                  to="/admin-dashboard"
                  className={`${navLinkClass} ${
                    isActive("/admin-dashboard") ? activeClass : inactiveClass
                  }`}
                >
                  <Shield size={20} />
                  <span>{t("nav.admin")}</span>
                </Link>
              </>
            )}

            <Link
              to={analyticsPath}
              className={`${navLinkClass} ${
                isActive(analyticsPath) ? activeClass : inactiveClass
              }`}
            >
              <BrandGlyph kind="analytics" size={20} />
              <span>{t("nav.analytics")}</span>
            </Link>
          </div>

          <div className="shrink-0 border-l border-slate-200 pl-2 sm:pl-4">
            <AccountMenu />
          </div>
        </div>
      </div>
    </nav>
  );
}

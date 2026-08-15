import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  LifeBuoy,
  LogOut,
  SquareTerminal,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { LanguageSwitcher } from "./LanguageSwitcher";
import {
  clearAppNavigationHistory,
  getSessionStorage,
} from "../lib/app-navigation-history";
import { getAccessRole } from "../context/auth-context";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const accessRole = getAccessRole(user);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const handleLogout = async () => {
    setIsOpen(false);
    const storage = getSessionStorage();
    if (storage && user) clearAppNavigationHistory(storage, user.id);
    await logout();
    navigate("/login", { replace: true });
  };

  const roleClass =
    accessRole === "admin"
      ? "bg-purple-100 text-purple-800"
      : accessRole === "trainer"
        ? "bg-blue-100 text-blue-800"
        : "bg-slate-100 text-slate-700";

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t("accountMenu.open")}
        title={t("accountMenu.open")}
        onClick={() => setIsOpen((current) => !current)}
        className="flex items-center gap-1 rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {user?.avatarDataUrl ? (
          <img
            src={user.avatarDataUrl}
            alt={user.name}
            className="h-10 w-10 rounded-full border-2 border-white object-cover shadow ring-1 ring-slate-200"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 ring-1 ring-slate-200">
            <UserRound size={20} />
          </span>
        )}
        <ChevronDown
          size={15}
          className={`hidden transition sm:block ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-3 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/20"
        >
          <div className="flex items-start justify-between gap-4 px-2 pb-2">
            <p className="truncate text-xs font-medium text-slate-500">
              {user?.email}
            </p>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-col items-center px-4 pb-4 text-center">
            {user?.avatarDataUrl ? (
              <img
                src={user.avatarDataUrl}
                alt={user.name}
                className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-lg ring-1 ring-slate-200"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                <UserRound size={34} />
              </span>
            )}
            <p className="mt-3 text-xl font-bold text-slate-950">
              {user?.name}
            </p>
            <span
              className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${roleClass}`}
            >
              {accessRole ? t(`roles.${accessRole}`) : ""}
            </span>
          </div>

          <Link
            role="menuitem"
            to="/account"
            onClick={() => setIsOpen(false)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Settings size={18} />
            {t("accountMenu.manage")}
          </Link>

          {user?.corporateConsole?.enabled && (
            <Link
              role="menuitem"
              to="/admin/manager-console"
              onClick={() => setIsOpen(false)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              <SquareTerminal size={18} />
              {t("accountMenu.managerConsole")}
            </Link>
          )}

          <Link
            role="menuitem"
            to="/support"
            onClick={() => setIsOpen(false)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <LifeBuoy size={18} />
            {t("accountMenu.support")}
          </Link>

          <div className="my-3 border-t border-slate-100" />

          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("language.label")}
            </p>
            <LanguageSwitcher />
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <LogOut size={19} />
            {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  FileText,
  MessageSquareText,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface AuthAccessMenuProps {
  accessPortal: "member" | "staff";
  onAccessPortalChange: (portal: "member" | "staff") => void;
}

export function AuthAccessMenu({
  accessPortal,
  onAccessPortalChange,
}: AuthAccessMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const selectPortal = (portal: "member" | "staff") => {
    onAccessPortalChange(portal);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t("auth.accessMenu.label")}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {accessPortal === "staff" ? (
          <ShieldCheck size={17} />
        ) : (
          <UserRound size={17} />
        )}
        <span className="hidden sm:inline">{t("auth.accessMenu.label")}</span>
        <ChevronDown
          size={16}
          className={`transition ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 max-h-[calc(100vh-6rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/15"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              selectPortal(accessPortal === "member" ? "staff" : "member")
            }
            className="flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {accessPortal === "member" ? (
              <ShieldCheck
                className="mt-0.5 shrink-0 text-blue-600"
                size={19}
              />
            ) : (
              <UserRound className="mt-0.5 shrink-0 text-blue-600" size={19} />
            )}
            <span>
              <span className="block text-sm font-semibold text-slate-950">
                {accessPortal === "member"
                  ? t("auth.accessMenu.staffLogin")
                  : t("auth.accessMenu.memberLogin")}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                {accessPortal === "member"
                  ? t("auth.accessMenu.staffDescription")
                  : t("auth.accessMenu.memberDescription")}
              </span>
            </span>
          </button>

          <div className="my-2 border-t border-slate-100" />
          <Link
            role="menuitem"
            to="/commercial"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
          >
            <ShieldCheck size={17} />
            {t("commercial.public.menuLink")}
          </Link>
          {[
            ["/legal-notice", t("legal.footer.notice")],
            ["/privacy", t("legal.footer.privacy")],
            ["/terms-and-conditions", t("legal.footer.terms")],
            ["/conditions-of-use", t("legal.footer.use")],
          ].map(([to, label]) => (
            <Link
              key={to}
              role="menuitem"
              to={to}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
            >
              <FileText size={17} />
              {label}
            </Link>
          ))}
          <Link
            role="menuitem"
            to="/feedback"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
          >
            <MessageSquareText size={17} />
            {t("feedback.footer")}
          </Link>
        </div>
      )}
    </div>
  );
}

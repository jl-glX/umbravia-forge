import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface LegalFooterProps {
  variant?: "dark" | "light";
}

export function LegalFooter({ variant = "dark" }: LegalFooterProps) {
  const { t } = useTranslation();
  const isDark = variant === "dark";

  return (
    <footer
      className={`border-t px-4 py-7 text-sm ${
        isDark
          ? "border-white/10 bg-slate-950 text-slate-400"
          : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      <div className="mx-auto flex max-w-[96rem] flex-col items-center justify-between gap-4 sm:flex-row">
        <p>
          © {new Date().getFullYear()} Umbravia Forge. {t("home.rights")}
        </p>
        <nav
          aria-label={t("legal.footer.navigation")}
          className="flex flex-wrap justify-center gap-x-5 gap-y-2"
        >
          <Link
            className="transition-colors hover:text-blue-500"
            to="/legal-notice"
          >
            {t("legal.footer.notice")}
          </Link>
          <Link className="transition-colors hover:text-blue-500" to="/privacy">
            {t("legal.footer.privacy")}
          </Link>
          <Link
            className="transition-colors hover:text-blue-500"
            to="/terms-and-conditions"
          >
            {t("legal.footer.terms")}
          </Link>
          <Link
            className="transition-colors hover:text-blue-500"
            to="/conditions-of-use"
          >
            {t("legal.footer.use")}
          </Link>
          <Link
            className="transition-colors hover:text-blue-500"
            to="/feedback"
          >
            {t("feedback.footer")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

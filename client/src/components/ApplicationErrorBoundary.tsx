import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ApplicationErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  failed: boolean;
}

function ApplicationErrorFallback() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 text-slate-950">
      <section
        role="alert"
        className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/10"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <TriangleAlert size={28} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold">
          {t("releaseRecovery.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t("releaseRecovery.description")}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <RefreshCw size={18} aria-hidden="true" />
          {t("releaseRecovery.reload")}
        </button>
      </section>
    </main>
  );
}

export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  state: ApplicationErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ApplicationErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application rendering failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <ApplicationErrorFallback />;
    return this.props.children;
  }
}

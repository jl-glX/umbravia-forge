import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  MailCheck,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { authFetch } from "../lib/api";

interface EmailManagerStatus {
  generatedAt: number;
  readiness: {
    healthy: boolean;
    outbound: { state: string; mode: string; tls: string };
    queueProtection: { state: string };
    inbound: { state: string; provider: string };
    capabilities: Record<string, boolean>;
    confirmations: string[];
    alerts: string[];
  };
  queue: {
    byStatus: Record<string, number>;
    oldestPendingAt: number | null;
    recentFailures: Array<{
      id: string;
      kind: string;
      attempts: number;
      errorCode: string;
      updatedAt: number;
    }>;
  };
  ownership: {
    scheduledBy: "resource";
    alertsDistributedBy: "coordinator";
    secretValuesExposed: false;
    configurationMutationEnabled: false;
  };
}

function total(status: EmailManagerStatus | null, ...states: string[]) {
  return states.reduce(
    (sum, state) => sum + (status?.queue.byStatus[state] ?? 0),
    0,
  );
}

export function EmailManagerPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EmailManagerStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"audit" | "maintenance" | null>(null);
  const requestSequence = useRef(0);

  const loadStatus = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const response = await authFetch("/api/admin/email-manager");
      if (!response.ok) throw new Error(t("emailManager.loadError"));
      const result = (await response.json()) as EmailManagerStatus;
      if (requestSequence.current === requestId) {
        setStatus(result);
        setError("");
      }
    } catch (loadError) {
      if (requestSequence.current === requestId) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("emailManager.loadError"),
        );
      }
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runAction = async (action: "audit" | "maintenance") => {
    setBusy(action);
    setError("");
    try {
      const response = await authFetch(`/api/admin/email-manager/${action}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(t("emailManager.actionError"));
      await loadStatus();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t("emailManager.actionError"),
      );
    } finally {
      setBusy(null);
    }
  };

  const cards = [
    {
      label: t("emailManager.outbound"),
      value: status?.readiness.outbound.state ?? "-",
      icon: MailCheck,
    },
    {
      label: t("emailManager.inbound"),
      value: status?.readiness.inbound.state ?? "-",
      icon: Inbox,
    },
    {
      label: t("emailManager.pending"),
      value: String(total(status, "queued", "retry", "processing")),
      icon: RefreshCw,
    },
    {
      label: t("emailManager.failed"),
      value: String(total(status, "failed")),
      icon: AlertTriangle,
    },
  ];

  return (
    <main className="min-h-[calc(100vh-4.5rem)] bg-slate-50 px-4 py-10 text-slate-950 sm:px-6">
      <section className="mx-auto w-full max-w-[96rem]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-600">
              {t("emailManager.eyebrow")}
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">
              {t("emailManager.title")}
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-slate-600">
              {t("emailManager.description")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void runAction("audit")}
            >
              <CheckCircle2 size={17} />
              {t("emailManager.audit")}
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => void runAction("maintenance")}
            >
              <Wrench size={17} />
              {t("emailManager.maintenance")}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {!status ? (
          <p className="mt-10 text-slate-500">{t("common.loading")}</p>
        ) : (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map(({ icon: Icon, label, value }) => (
                <article
                  key={label}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <Icon className="text-blue-600" size={22} />
                  <p className="mt-4 text-sm font-medium text-slate-500">
                    {label}
                  </p>
                  <p className="mt-1 text-2xl font-bold">{value}</p>
                </article>
              ))}
            </div>

            <div
              className={`mt-4 rounded-2xl border p-5 ${
                status.readiness.healthy
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              <p className="font-bold">
                {status.readiness.healthy
                  ? t("emailManager.ready")
                  : t("emailManager.attention")}
              </p>
              <p className="mt-1 text-sm leading-6">
                {t("emailManager.coordinationNotice")}
              </p>
            </div>

            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-bold">
                {t("emailManager.recentFailures")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {t("emailManager.privacyNotice")}
              </p>
              {status.queue.recentFailures.length === 0 ? (
                <p className="mt-6 text-slate-500">
                  {t("emailManager.noFailures")}
                </p>
              ) : (
                <div className="mt-6 grid gap-3">
                  {status.queue.recentFailures.map((failure) => (
                    <article
                      key={failure.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <p className="font-semibold">{failure.kind}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {failure.errorCode} · {failure.attempts}{" "}
                        {t("emailManager.attempts")}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

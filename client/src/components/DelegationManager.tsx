import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, Copy, KeyRound, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import { resolveIntlLocale } from "../i18n/supported-locales";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Duration = "24h" | "7d" | "30d" | "indefinite";

interface Delegation {
  id: string;
  tokenPreview: string;
  duration: Duration;
  expiresAt: number | null;
  redeemedAt: number | null;
  revokedAt: number | null;
  direction: "granted" | "received";
  active: boolean;
  otherUser: {
    id: string;
    name: string;
    email: string;
    avatarDataUrl: string;
  } | null;
}

export function DelegationManager() {
  const { t, i18n } = useTranslation();
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [duration, setDuration] = useState<Duration>("7d");
  const [redeemToken, setRedeemToken] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [showAllReceived, setShowAllReceived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await authFetch(`${API_BASE}/api/account/delegations`);
    if (!response.ok) throw new Error(t("delegations.loadFailed"));
    const data = (await response.json()) as { delegations: Delegation[] };
    setDelegations(data.delegations);
  }, [t]);

  useEffect(() => {
    load()
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const createToken = async () => {
    setError("");
    const response = await authFetch(
      `${API_BASE}/api/account/delegations/tokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      token?: string;
      code?: string;
    };
    if (!response.ok || !body.token) {
      setError(t(`delegations.errors.${body.code ?? "unknown"}`));
      return;
    }
    setNewToken(body.token);
    setCopied(false);
    await load();
  };

  const redeem = async () => {
    setError("");
    const response = await authFetch(
      `${API_BASE}/api/account/delegations/redeem`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: redeemToken.trim() }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    if (!response.ok) {
      setError(t(`delegations.errors.${body.code ?? "unknown"}`));
      return;
    }
    setRedeemToken("");
    await load();
  };

  const revoke = async (id: string) => {
    const response = await authFetch(
      `${API_BASE}/api/account/delegations/${id}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError(t("delegations.revokeFailed"));
      return;
    }
    await load();
  };

  const clearHistory = async () => {
    setClearingHistory(true);
    setError("");
    try {
      const response = await authFetch(
        `${API_BASE}/api/account/delegations/history`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(t("delegations.clearHistoryFailed"));
        return;
      }
      const data = (await response.json()) as { delegations: Delegation[] };
      setDelegations(data.delegations);
    } finally {
      setClearingHistory(false);
    }
  };

  const formatExpiry = (expiresAt: number | null) =>
    expiresAt
      ? new Intl.DateTimeFormat(resolveIntlLocale(i18n.language), {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(expiresAt)
      : t("delegations.indefinite");

  const activeReceived = delegations.filter(
    (delegation) => delegation.direction === "received" && delegation.active,
  );
  const visibleReceived = showAllReceived
    ? activeReceived
    : activeReceived.slice(0, 2);
  const historyDelegations = delegations.filter(
    (delegation) => delegation.direction !== "received" || !delegation.active,
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl bg-blue-50 p-3 text-blue-700">
          <Users />
        </span>
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            {t("delegations.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {t("delegations.description")}
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-950">
            {t("delegations.createTitle")}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t("delegations.createHelp")}
          </p>
          <label className="mt-4 block text-sm font-semibold text-slate-700">
            {t("delegations.duration")}
            <select
              value={duration}
              onChange={(event) => setDuration(event.target.value as Duration)}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
            >
              {(["24h", "7d", "30d", "indefinite"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`delegations.durations.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="mt-4 rounded-xl"
            onClick={() => void createToken()}
          >
            <KeyRound /> {t("delegations.create")}
          </Button>

          {newToken && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                {t("delegations.tokenShownOnce")}
              </p>
              <code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs text-slate-900">
                {newToken}
              </code>
              <Button
                variant="outline"
                className="mt-3 bg-white"
                onClick={() => {
                  void navigator.clipboard.writeText(newToken);
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? t("delegations.copied") : t("delegations.copy")}
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-950">
            {t("delegations.redeemTitle")}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t("delegations.redeemHelp")}
          </p>
          <Input
            value={redeemToken}
            onChange={(event) => setRedeemToken(event.target.value)}
            placeholder="hfd_..."
            className="mt-4 h-11 rounded-xl"
          />
          <Button
            variant="outline"
            className="mt-4 rounded-xl"
            disabled={!redeemToken.trim()}
            onClick={() => void redeem()}
          >
            {t("delegations.redeem")}
          </Button>

          {activeReceived.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h4 className="text-sm font-bold text-slate-900">
                {t("delegations.acceptedActive")}
              </h4>
              <div className="mt-3 space-y-2">
                {visibleReceived.map((delegation) => (
                  <div
                    key={delegation.id}
                    className="rounded-xl bg-emerald-50 px-3 py-2.5"
                  >
                    <p className="truncate text-sm font-semibold text-emerald-950">
                      {delegation.otherUser?.name ??
                        t("delegations.unknownOwner")}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-700">
                      {formatExpiry(delegation.expiresAt)}
                    </p>
                  </div>
                ))}
              </div>
              {activeReceived.length > 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowAllReceived((current) => !current)}
                >
                  {showAllReceived
                    ? t("delegations.showLess")
                    : t("delegations.showMore", {
                        count: activeReceived.length - 2,
                      })}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-950">
              {t("delegations.activeTitle")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("delegations.historyCleanupNotice")}
            </p>
          </div>
          {historyDelegations.some((delegation) => !delegation.active) && (
            <Button
              variant="ghost"
              className="text-slate-600"
              disabled={clearingHistory}
              onClick={() => void clearHistory()}
            >
              <Trash2 />
              {t("delegations.clearHistory")}
            </Button>
          )}
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>
        ) : historyDelegations.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            {activeReceived.length > 0
              ? t("delegations.historyEmpty")
              : t("delegations.empty")}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {historyDelegations.map((delegation) => (
              <div
                key={delegation.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center"
              >
                <span className="rounded-xl bg-slate-50 p-2 text-slate-600">
                  <Clock3 size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {delegation.otherUser?.name ??
                      t("delegations.awaitingRedemption")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t(`delegations.directions.${delegation.direction}`)} ·{" "}
                    {formatExpiry(delegation.expiresAt)} · …
                    {delegation.tokenPreview}
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                    delegation.active
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {delegation.active
                    ? t("delegations.active")
                    : t("delegations.inactive")}
                </span>
                {delegation.direction === "granted" && delegation.active && (
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => void revoke(delegation.id)}
                  >
                    <Trash2 /> {t("delegations.revoke")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

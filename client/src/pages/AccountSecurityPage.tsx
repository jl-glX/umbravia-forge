import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Laptop,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PasswordInput } from "../components/PasswordInput";
import { ProfilePhotoSettings } from "../components/ProfilePhotoSettings";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
} from "@simplewebauthn/browser";

type RegistrationOptions = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface SecurityOverview {
  mfa: {
    enabled: boolean;
    enabledAt: number | null;
    recoveryCodesRemaining: number;
  };
  passkeys: { enabled: boolean; count: number };
  sessionIdleTimeoutMinutes: number;
  sessions: Array<{
    id: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    userAgent: string;
    remembered: number;
    current: boolean;
    idleExpiresAt: number;
  }>;
  events: Array<{ id: string; type: string; createdAt: number }>;
}

interface SetupData {
  secret: string;
  qrCodeDataUrl: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Request failed");
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

function deviceLabel(userAgent: string) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iPhone / iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS/i.test(userAgent)) return "macOS";
  if (/Windows/i.test(userAgent)) return "Windows";
  return "Web";
}

export function AccountSecurityPage() {
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [passkeyPassword, setPasskeyPassword] = useState("");
  const [compromisePassword, setCompromisePassword] = useState("");
  const [compromiseCode, setCompromiseCode] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionIdleTimeoutMinutes, setSessionIdleTimeoutMinutes] = useState(
    7 * 24 * 60,
  );
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const result = await api<SecurityOverview>("/api/account/security");
    setOverview(result);
    setSessionIdleTimeoutMinutes(result.sessionIdleTimeoutMinutes);
  }, []);

  useEffect(() => {
    load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [load]);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    platformAuthenticatorIsAvailable()
      .then(setPasskeySupported)
      .catch(() => setPasskeySupported(false));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const action = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    action(async () => {
      setSetup(
        await api<SetupData>("/api/account/security/mfa/setup", {
          method: "POST",
          body: JSON.stringify({ password }),
        }),
      );
      setPassword("");
    }, t("security.setupReady"));

  const enableMfa = () =>
    action(async () => {
      const result = await api<{ recoveryCodes: string[] }>(
        "/api/account/security/mfa/enable",
        { method: "POST", body: JSON.stringify({ code }) },
      );
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode("");
    }, t("security.enabledSuccess"));

  const regenerateCodes = () =>
    action(async () => {
      const result = await api<{ recoveryCodes: string[] }>(
        "/api/account/security/mfa/recovery-codes",
        { method: "POST", body: JSON.stringify({ password, code }) },
      );
      setRecoveryCodes(result.recoveryCodes);
      setPassword("");
      setCode("");
    }, t("security.codesRegenerated"));

  const disableMfa = () =>
    action(async () => {
      await api<void>("/api/account/security/mfa", {
        method: "DELETE",
        body: JSON.stringify({ password, code }),
      });
      setPassword("");
      setCode("");
      setRecoveryCodes([]);
    }, t("security.disabledSuccess"));

  const enablePasskey = () =>
    action(async () => {
      const options = await api<RegistrationOptions>(
        "/api/account/security/passkeys/options",
        {
          method: "POST",
          body: JSON.stringify({ password: passkeyPassword }),
        },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api<{ enabled: boolean }>("/api/account/security/passkeys/verify", {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      setPasskeyPassword("");
    }, t("security.passkeyEnabledSuccess"));

  const disablePasskey = () =>
    action(async () => {
      await api<void>("/api/account/security/passkeys", {
        method: "DELETE",
        body: JSON.stringify({ password: passkeyPassword }),
      });
      setPasskeyPassword("");
    }, t("security.passkeyDisabledSuccess"));

  const revokeSession = (sessionId: string) =>
    action(
      () =>
        api<void>(`/api/account/security/sessions/${sessionId}`, {
          method: "DELETE",
        }),
      t("security.sessionRevoked"),
    );

  const updateSessionTimeout = () =>
    action(
      () =>
        api<void>("/api/account/security/sessions/settings", {
          method: "PATCH",
          body: JSON.stringify({
            timeoutMinutes: sessionIdleTimeoutMinutes,
          }),
        }),
      t("security.sessionTimeoutSaved"),
    );

  const reportCompromise = () =>
    action(async () => {
      await api("/api/account/security/compromise", {
        method: "POST",
        body: JSON.stringify({
          password: compromisePassword,
          code: compromiseCode || undefined,
        }),
      });
      setCompromisePassword("");
      setCompromiseCode("");
    }, t("security.compromiseSuccess"));

  const date = (value: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);

  const remainingSessionTime = (idleExpiresAt: number, expiresAt: number) => {
    const remainingMinutes = Math.max(
      0,
      Math.ceil((Math.min(idleExpiresAt, expiresAt) - now) / 60_000),
    );
    if (remainingMinutes < 60) {
      return t("security.remainingMinutes", { count: remainingMinutes });
    }
    const remainingHours = Math.ceil(remainingMinutes / 60);
    if (remainingHours < 24) {
      return t("security.remainingHours", { count: remainingHours });
    }
    return t("security.remainingDays", {
      count: Math.ceil(remainingHours / 24),
    });
  };

  const copyRecoveryCodes = async () => {
    const value = recoveryCodes.join("\n");
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setRecoveryCodes([]);
    setNotice(t("security.codesCopied"));
  };

  const downloadRecoveryCodes = () => {
    const date = new Date().toISOString().slice(0, 10);
    const content = [
      t("security.downloadHeading"),
      t("security.downloadWarning"),
      "",
      ...recoveryCodes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `umbravia-forge-recovery-codes-${date}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setRecoveryCodes([]);
    setNotice(t("security.codesDownloaded"));
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-[96rem]">
        <div className="mb-8 flex items-start gap-4">
          <span className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
            <ShieldCheck size={28} />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              {t("security.eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              {t("security.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              {t("security.description")}
            </p>
          </div>
        </div>

        {(error || notice) && (
          <div
            role="status"
            className={`mb-6 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
          >
            {error || notice}
          </div>
        )}

        <ProfilePhotoSettings />

        <Card className="mb-6 rounded-3xl border-amber-200 bg-amber-50 p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-xl font-bold text-amber-950">
                {t("security.compromiseTitle")}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">
                {t("security.compromiseDescription")}
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="compromise-password">
                {t("security.confirmPassword")}
              </Label>
              <PasswordInput
                id="compromise-password"
                value={compromisePassword}
                maxLength={128}
                autoComplete="current-password"
                onChange={(event) => setCompromisePassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compromise-code">
                {t("security.compromiseCodeOptional")}
              </Label>
              <Input
                id="compromise-code"
                value={compromiseCode}
                maxLength={13}
                pattern="(?:[0-9]{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})"
                autoComplete="one-time-code"
                onChange={(event) => setCompromiseCode(event.target.value)}
              />
            </div>
          </div>
          <Button
            className="mt-4"
            variant="destructive"
            disabled={busy || !compromisePassword}
            onClick={reportCompromise}
          >
            <ShieldAlert /> {t("security.compromiseAction")}
          </Button>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="rounded-3xl border-slate-200 p-6 shadow-sm sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  {t("security.twoFactor")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("security.twoFactorDescription")}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${overview?.mfa.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
              >
                {overview?.mfa.enabled
                  ? t("security.enabled")
                  : t("security.disabled")}
              </span>
            </div>

            {!overview?.mfa.enabled && !setup && (
              <div className="mt-6 space-y-3">
                <Label htmlFor="setup-password">
                  {t("security.confirmPassword")}
                </Label>
                <PasswordInput
                  id="setup-password"
                  autoComplete="current-password"
                  value={password}
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  onClick={startSetup}
                  disabled={busy || !password}
                  className="w-full sm:w-auto"
                >
                  <KeyRound /> {t("security.configure")}
                </Button>
              </div>
            )}

            {setup && (
              <div className="mt-6 grid gap-6 sm:grid-cols-[240px_1fr]">
                <img
                  src={setup.qrCodeDataUrl}
                  alt={t("security.qrAlt")}
                  className="rounded-2xl border border-slate-200"
                />
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-600">
                    {t("security.scanHelp")}
                  </p>
                  <div className="rounded-xl bg-slate-100 p-3 font-mono text-xs break-all text-slate-700">
                    {setup.secret}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="enable-code">
                      {t("security.authenticatorCode")}
                    </Label>
                    <Input
                      id="enable-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      maxLength={6}
                      pattern="[0-9]{6}"
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="123456"
                    />
                  </div>
                  <Button
                    onClick={enableMfa}
                    disabled={busy || code.length < 6}
                  >
                    {t("security.activate")}
                  </Button>
                </div>
              </div>
            )}

            {overview?.mfa.enabled && (
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 size={18} /> {t("security.protected")}
                  </div>
                  <p className="mt-1">
                    {t("security.codesRemaining", {
                      count: overview.mfa.recoveryCodesRemaining,
                    })}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="security-password">
                      {t("security.confirmPassword")}
                    </Label>
                    <PasswordInput
                      id="security-password"
                      className="mt-2"
                      autoComplete="current-password"
                      value={password}
                      maxLength={128}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="security-code">
                      {t("security.authenticatorCode")}
                    </Label>
                    <Input
                      id="security-code"
                      className="mt-2"
                      autoComplete="one-time-code"
                      value={code}
                      maxLength={13}
                      pattern="(?:[0-9]{6}|[A-Fa-f0-9]{6}-?[A-Fa-f0-9]{6})"
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {t("security.disableHelp")}
                </p>
                <p className="text-xs leading-relaxed text-amber-700">
                  {t("security.lostAccessHelp")}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={regenerateCodes}
                    disabled={busy || !password || !code}
                  >
                    <RefreshCw /> {t("security.regenerate")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={disableMfa}
                    disabled={busy || !password || !code}
                  >
                    {t("security.disable")}
                  </Button>
                </div>
              </div>
            )}

            {recoveryCodes.length > 0 && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h3 className="font-bold text-amber-950">
                  {t("security.saveCodes")}
                </h3>
                <p className="mt-1 text-sm text-amber-800">
                  {t("security.codesShownOnce")}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
                  {recoveryCodes.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="outline" onClick={copyRecoveryCodes}>
                    <Copy /> {t("security.copyCodes")}
                  </Button>
                  <Button variant="outline" onClick={downloadRecoveryCodes}>
                    <Download /> {t("security.downloadCodes")}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="rounded-3xl border-slate-200 p-6 shadow-sm sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-slate-950">
                  <Fingerprint className="text-blue-600" />
                  {t("security.passkeyTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("security.passkeyDescription")}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${overview?.passkeys.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
              >
                {overview?.passkeys.enabled
                  ? t("security.enabled")
                  : t("security.disabled")}
              </span>
            </div>

            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              {passkeySupported
                ? t("security.passkeyPrivacy")
                : t("security.passkeyUnavailable")}
            </div>

            <div className="mt-5 space-y-3">
              <Label htmlFor="passkey-password">
                {t("security.confirmPassword")}
              </Label>
              <PasswordInput
                id="passkey-password"
                autoComplete="current-password"
                value={passkeyPassword}
                maxLength={128}
                onChange={(event) => setPasskeyPassword(event.target.value)}
              />
              {overview?.passkeys.enabled ? (
                <Button
                  variant="destructive"
                  onClick={disablePasskey}
                  disabled={busy || !passkeyPassword}
                >
                  {t("security.disablePasskey")}
                </Button>
              ) : (
                <Button
                  onClick={enablePasskey}
                  disabled={busy || !passkeyPassword || !passkeySupported}
                >
                  <Fingerprint /> {t("security.enablePasskey")}
                </Button>
              )}
            </div>
          </Card>

          <Card className="rounded-3xl border-slate-200 p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    {t("security.sessions")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("security.sessionsDescription")}
                  </p>
                </div>
                {(overview?.sessions.length ?? 0) > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      action(
                        () =>
                          api<void>(
                            "/api/account/security/sessions/revoke-others",
                            { method: "POST" },
                          ),
                        t("security.otherSessionsRevoked"),
                      )
                    }
                  >
                    <LogOut /> {t("security.closeOthers")}
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <Label
                  htmlFor="session-timeout"
                  className="font-semibold text-blue-950"
                >
                  {t("security.inactivityTitle")}
                </Label>
                <p className="mt-1 text-sm leading-6 text-blue-900">
                  {t("security.inactivityDescription")}
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <select
                    id="session-timeout"
                    value={sessionIdleTimeoutMinutes}
                    onChange={(event) =>
                      setSessionIdleTimeoutMinutes(Number(event.target.value))
                    }
                    className="h-10 flex-1 rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-900"
                  >
                    {[15, 60, 480, 1440, 10080, 43200].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {t(`security.timeouts.${minutes}`)}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={updateSessionTimeout}
                    disabled={
                      busy ||
                      sessionIdleTimeoutMinutes ===
                        overview?.sessionIdleTimeoutMinutes
                    }
                  >
                    {t("security.inactivitySave")}
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {overview?.sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4"
                >
                  <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                    {/Android|iPhone|iPad/i.test(session.userAgent) ? (
                      <Smartphone />
                    ) : (
                      <Laptop />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">
                      {deviceLabel(session.userAgent)}{" "}
                      {session.current && (
                        <span className="ml-2 text-xs text-emerald-600">
                          {t("security.current")}
                        </span>
                      )}
                      {session.remembered === 1 && (
                        <span className="ml-2 text-xs text-blue-600">
                          {t("security.remembered")}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {t("security.lastActivity", {
                        date: date(session.lastSeenAt),
                      })}
                    </p>
                    <p className="mt-1 text-xs font-medium text-blue-600">
                      {t("security.expiresIn", {
                        time: remainingSessionTime(
                          session.idleExpiresAt,
                          session.expiresAt,
                        ),
                      })}
                    </p>
                  </div>
                  {!session.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeSession(session.id)}
                    >
                      {t("security.revoke")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="mt-6 rounded-3xl border-slate-200 p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-950">
            {t("security.activity")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("security.activityDescription")}
          </p>
          <div className="mt-5 divide-y divide-slate-100">
            {overview?.events.length ? (
              overview.events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-4 py-3 text-sm"
                >
                  <span className="font-medium text-slate-800">
                    {t(`security.events.${event.type}`, {
                      defaultValue: event.type,
                    })}
                  </span>
                  <time className="text-xs text-slate-500">
                    {date(event.createdAt)}
                  </time>
                </div>
              ))
            ) : (
              <p className="py-4 text-sm text-slate-500">
                {t("security.noActivity")}
              </p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}

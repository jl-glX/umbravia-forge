import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  KeyRound,
  Laptop,
  Network,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";

type AccessMode = "internal" | "external";

interface AccessBootstrap {
  access: { authorityProfileId: string; priority: number };
  scopeProfiles: Array<{ id: string; label: string; priority: number }>;
  hasTemporaryPermissions: boolean;
  webConsoleAvailable: false;
  clientCommand: string;
  compatibility: string[];
  accessModes: {
    internal: {
      availableFrom: string[];
      webIssuance: false;
      requiresCorporateRole: true;
      requiresStoreAttestation: true;
      credentialDurationMs: null;
      idleTimeoutMs: number;
      singleUse: false;
    };
    external: {
      availableFrom: string[];
      webIssuance: true;
      requiresCorporateRole: true;
      credentialDurationMs: number;
      terminalSessionDurationMs: number;
      singleUse: true;
    };
  };
}

interface IssuedCredential {
  credential: string;
  accessMode: AccessMode;
  expiresAt: number | null;
  idleTimeoutMs: number | null;
  singleUse: boolean;
  scopeProfileId: string;
  allowTemporaryPermissions: boolean;
}

export function ManagerConsolePage() {
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<AccessBootstrap | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [busy, setBusy] = useState<AccessMode | null>(null);
  const [scopeProfileId, setScopeProfileId] = useState("");
  const [allowTemporaryPermissions, setAllowTemporaryPermissions] =
    useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await authFetch("/api/admin/manager-console");
        if (!response.ok) throw new Error(t("managerConsole.loadError"));
        const result = (await response.json()) as AccessBootstrap;
        setBootstrap(result);
        setScopeProfileId(result.access.authorityProfileId);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("managerConsole.loadError"),
        );
      }
    })();
  }, [t]);

  const issue = async (accessMode: AccessMode) => {
    setBusy(accessMode);
    setIssued(null);
    setCopied(false);
    setError("");
    try {
      const response = await authFetch(
        "/api/admin/manager-console/credential",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessMode,
            scopeProfileId,
            allowTemporaryPermissions,
          }),
        },
      );
      const result = (await response.json()) as IssuedCredential & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || t("managerConsole.issueError"));
      }
      setIssued(result);
    } catch (issueError) {
      setError(
        issueError instanceof Error
          ? issueError.message
          : t("managerConsole.issueError"),
      );
    } finally {
      setBusy(null);
    }
  };

  const copyCredential = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.credential);
    setCopied(true);
  };

  return (
    <main className="min-h-[calc(100vh-4.5rem)] bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-brand-ember">
              <KeyRound size={18} />
              {t("managerConsole.eyebrow")}
            </div>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">
              {t("managerConsole.title")}
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-slate-600">
              {t("managerConsole.description")}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            <ShieldCheck size={20} />
            {t("managerConsole.webBoundary")}
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {!bootstrap ? (
          <p className="mt-10 text-slate-500">{t("common.loading")}</p>
        ) : (
          <>
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <article className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl bg-emerald-100 p-3 text-emerald-800">
                    <Network size={23} />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold">
                      {t("managerConsole.internalTitle")}
                    </h2>
                    <p className="text-sm text-emerald-800">
                      {t("managerConsole.recommended")}
                    </p>
                  </div>
                </div>
                <p className="mt-5 leading-7 text-slate-600">
                  {t("managerConsole.internalDescription", {
                    minutes: Math.round(
                      bootstrap.accessModes.internal.idleTimeoutMs / 60_000,
                    ),
                  })}
                </p>
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                  <p className="font-bold">
                    {t("managerConsole.internalAppsOnly")}
                  </p>
                  <p className="mt-1">
                    {t("managerConsole.internalApps", {
                      apps: bootstrap.accessModes.internal.availableFrom.join(
                        " · ",
                      ),
                    })}
                  </p>
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                    <Laptop size={23} />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold">
                      {t("managerConsole.externalTitle")}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {t("managerConsole.externalCompatibility")}
                    </p>
                  </div>
                </div>
                <p className="mt-5 leading-7 text-slate-600">
                  {t("managerConsole.externalDescription", {
                    credentialMinutes: Math.round(
                      bootstrap.accessModes.external.credentialDurationMs /
                        60_000,
                    ),
                    sessionMinutes: Math.round(
                      bootstrap.accessModes.external.terminalSessionDurationMs /
                        60_000,
                    ),
                  })}
                </p>
                <label className="mt-5 block text-sm font-semibold text-slate-700">
                  {t("managerConsole.credentialScope")}
                  <select
                    value={scopeProfileId}
                    onChange={(event) => setScopeProfileId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-950"
                  >
                    {bootstrap.scopeProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label} · P{profile.priority}
                      </option>
                    ))}
                  </select>
                </label>
                {bootstrap.hasTemporaryPermissions && (
                  <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <input
                      type="checkbox"
                      checked={allowTemporaryPermissions}
                      onChange={(event) =>
                        setAllowTemporaryPermissions(event.target.checked)
                      }
                      className="mt-1"
                    />
                    <span>
                      {t("managerConsole.includeTemporaryPermissions")}
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void issue("external")}
                  className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "external"
                    ? t("managerConsole.issuing")
                    : t("managerConsole.issueExternal")}
                </button>
              </article>
            </div>

            {issued && (
              <section className="mt-6 rounded-3xl border border-brand-ember/30 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <SquareTerminal className="text-brand-ember" size={24} />
                  <div>
                    <h2 className="text-xl font-bold">
                      {t("managerConsole.credentialReady")}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {t("managerConsole.externalCredentialNotice")}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex gap-2 rounded-2xl border border-slate-200 bg-slate-950 p-3">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 py-1 text-sm text-emerald-300">
                    {issued.credential}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCredential()}
                    className="shrink-0 rounded-xl bg-white p-2 text-slate-900"
                    aria-label={t("managerConsole.copy")}
                  >
                    {copied ? <Check size={19} /> : <Copy size={19} />}
                  </button>
                </div>
                <div className="mt-4 flex items-start gap-2 text-sm leading-6 text-slate-600">
                  <Clock3 className="mt-0.5 shrink-0" size={18} />
                  <p>{t("managerConsole.externalExpiryNotice")}</p>
                </div>
                <div className="mt-5 rounded-2xl bg-slate-100 p-4">
                  <p className="text-sm font-semibold text-slate-700">
                    {t("managerConsole.launchInstruction")}
                  </p>
                  <code className="mt-2 block overflow-x-auto whitespace-nowrap text-sm text-slate-900">
                    {bootstrap.clientCommand} -- --url {window.location.origin}{" "}
                    --channel {issued.accessMode}
                  </code>
                  <p className="mt-2 text-xs text-slate-600">
                    {t("managerConsole.issuedScope", {
                      scope: issued.scopeProfileId,
                      temporary: issued.allowTemporaryPermissions
                        ? t("managerConsole.temporaryYes")
                        : t("managerConsole.temporaryNo"),
                    })}
                  </p>
                </div>
              </section>
            )}

            <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="font-bold">{t("managerConsole.boundaryTitle")}</h2>
              <p className="mt-2 leading-7 text-slate-600">
                {t("managerConsole.boundaryDescription", {
                  profile: bootstrap.access.authorityProfileId,
                })}
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

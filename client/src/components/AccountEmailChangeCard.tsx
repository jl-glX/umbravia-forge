import { FormEvent, useState } from "react";
import { MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";
import { PasswordInput } from "./PasswordInput";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

async function accountSecurityRequest<T>(
  apiBase: string,
  path: string,
  body?: unknown,
  method = "POST",
) {
  const response = await authFetch(`${apiBase}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new Error(payload.code ?? payload.error ?? "EMAIL_CHANGE_FAILED");
  }
  return payload;
}

interface AccountEmailChangeCardProps {
  apiBase?: string;
  accountUser?: { email: string } | null;
  onAccountRefresh?: () => Promise<unknown>;
}

export function AccountEmailChangeCard({
  apiBase = "/api/account/security",
  accountUser,
  onAccountRefresh,
}: AccountEmailChangeCardProps = {}) {
  const { t } = useTranslation();
  const { user: commercialUser, refreshUser } = useAuth();
  const user = accountUser ?? commercialUser;
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!user) return null;

  const errorMessage = (cause: unknown) => {
    if (!(cause instanceof Error)) return t("accountEmailChange.error");
    const keys: Record<string, string> = {
      INVALID_SECURITY_CONFIRMATION: "passwordInvalid",
      EMAIL_ALREADY_IN_USE: "inUse",
      EMAIL_UNCHANGED: "unchanged",
      EMAIL_CHANGE_CODE_INVALID: "invalidCode",
      EMAIL_CHANGE_STATE_CONFLICT: "conflict",
    };
    const key = keys[cause.message];
    return key ? t(`accountEmailChange.${key}`) : t("accountEmailChange.error");
  };

  const requestChange = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await accountSecurityRequest<{ expiresAt: number }>(
        apiBase,
        "/email-change/request",
        {
          email: newEmail,
          password,
        },
      );
      setPassword("");
      setVerificationPending(true);
      setNotice(
        t("accountEmailChange.codeSent", {
          time: new Intl.DateTimeFormat(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(result.expiresAt),
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const confirmChange = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await accountSecurityRequest(apiBase, "/email-change/confirm", { code });
      await (onAccountRefresh ?? refreshUser)();
      setCode("");
      setNewEmail("");
      setVerificationPending(false);
      setNotice(t("accountEmailChange.completed"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const cancelChange = async () => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await accountSecurityRequest(
        apiBase,
        "/email-change",
        undefined,
        "DELETE",
      );
      setVerificationPending(false);
      setCode("");
      setNewEmail("");
      setNotice(t("accountEmailChange.cancelled"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex gap-3">
        <MailCheck className="mt-0.5 shrink-0 text-slate-600" size={20} />
        <div>
          <h3 className="font-semibold text-slate-950">
            {t("accountEmailChange.title")}
          </h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">
            {t("accountEmailChange.description")}
          </p>
        </div>
      </div>
      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {!verificationPending ? (
        <form
          onSubmit={requestChange}
          className="mt-4 grid gap-3 md:grid-cols-2"
        >
          <div>
            <Label htmlFor="account-current-email">
              {t("accountEmailChange.current")}
            </Label>
            <Input id="account-current-email" value={user.email} disabled />
          </div>
          <div>
            <Label htmlFor="account-new-email">
              {t("accountEmailChange.new")}
            </Label>
            <Input
              id="account-new-email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              maxLength={254}
              required
            />
          </div>
          <div>
            <Label htmlFor="account-email-password">
              {t("accountEmailChange.password")}
            </Label>
            <PasswordInput
              id="account-email-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={128}
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={working} className="w-full">
              {t("accountEmailChange.sendCode")}
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={confirmChange}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Label htmlFor="account-email-code">
              {t("accountEmailChange.code")}
            </Label>
            <Input
              id="account-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              minLength={6}
              maxLength={6}
              pattern="[0-9]{6}"
              required
            />
          </div>
          <Button type="submit" disabled={working}>
            {t("accountEmailChange.confirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={cancelChange}
          >
            {t("accountEmailChange.cancel")}
          </Button>
        </form>
      )}
    </section>
  );
}

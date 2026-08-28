import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthShell } from "../components/AuthShell";
import { Button } from "../components/ui/button";
import { PasswordInput } from "../components/PasswordInput";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";
import { isPasswordWithinHashLimit } from "../lib/passwordPolicy";
import { buildInvitationAcceptancePayload } from "../lib/invitationLocalization";

type InvitationStatus =
  "pending" | "accepted" | "declined" | "revoked" | "expired";

interface InvitationDetails {
  facilityName: string;
  invitedEmail: string;
  invitedName: string;
  role: "admin" | "trainer" | "member";
  status: InvitationStatus;
  expiresAt: number;
  existingAccount: boolean;
}

async function invitationError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return payload.error ?? "FACILITY_INVITATION_OPERATION_FAILED";
}

export function FacilityInvitationPage() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<"accepted" | "declined" | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const copyNamespace =
    invitation?.role === "member"
      ? "memberAffiliationInvitation"
      : "facilityInvitation";

  const invitationPath = useMemo(
    () => `/facility-invitation?token=${encodeURIComponent(token)}`,
    [token],
  );
  const loginPath = `/login?returnTo=${encodeURIComponent(invitationPath)}`;

  useEffect(() => {
    if (!token) {
      setError("FACILITY_INVITATION_INVALID");
      setLoading(false);
      return;
    }
    authFetch(`/api/facility-invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await invitationError(response));
        setInvitation((await response.json()) as InvitationDetails);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "FACILITY_INVITATION_OPERATION_FAILED",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  const displayedError = error
    ? t(`facilityInvitation.errors.${error}`, {
        defaultValue: t("facilityInvitation.errors.generic"),
      })
    : "";

  const acceptExisting = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await authFetch(
        `/api/facility-invitations/${encodeURIComponent(token)}/accept-existing`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await invitationError(response));
      await refreshUser();
      setCompleted("accepted");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "FACILITY_INVITATION_OPERATION_FAILED",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const acceptNew = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (
      password !== confirmPassword ||
      password.length < 12 ||
      !isPasswordWithinHashLimit(password) ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setError(
        password !== confirmPassword
          ? "PASSWORD_CONFIRMATION_MISMATCH"
          : "PASSWORD_POLICY_FAILED",
      );
      return;
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setError("LEGAL_ACKNOWLEDGEMENT_REQUIRED");
      return;
    }
    setSubmitting(true);
    try {
      const response = await authFetch(
        `/api/facility-invitations/${encodeURIComponent(token)}/accept-new`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildInvitationAcceptancePayload({
              password,
              acceptedTerms,
              acceptedPrivacy,
              interfaceLocale: i18n.resolvedLanguage ?? i18n.language,
            }),
          ),
        },
      );
      if (!response.ok) throw new Error(await invitationError(response));
      setCompleted("accepted");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "FACILITY_INVITATION_OPERATION_FAILED",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await authFetch(
        `/api/facility-invitations/${encodeURIComponent(token)}/decline`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await invitationError(response));
      setCompleted("declined");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "FACILITY_INVITATION_OPERATION_FAILED",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      contentSurface="card"
      eyebrow={t(`${copyNamespace}.eyebrow`)}
      title={t(`${copyNamespace}.title`)}
      description={t(`${copyNamespace}.description`)}
    >
      {loading ? <p>{t("common.loading")}</p> : null}
      {displayedError ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {displayedError}
        </p>
      ) : null}
      {completed ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            {t(`${copyNamespace}.${completed}`)}
          </p>
          {completed === "accepted" ? (
            <Button asChild className="w-full">
              <Link to={user ? "/" : "/login"}>
                {user
                  ? t("facilityInvitation.openAccount")
                  : t("facilityInvitation.signIn")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      {!loading && !completed && invitation ? (
        invitation.status !== "pending" ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
            {t(`${copyNamespace}.status.${invitation.status}`)}
          </p>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium text-slate-600">
                {t("facilityInvitation.facility")}
              </dt>
              <dd>{invitation.facilityName}</dd>
              <dt className="font-medium text-slate-600">
                {t("common.email")}
              </dt>
              <dd className="break-all">{invitation.invitedEmail}</dd>
              <dt className="font-medium text-slate-600">{t("common.role")}</dt>
              <dd>{t(`roles.${invitation.role}`)}</dd>
            </dl>
            {invitation.existingAccount ? (
              user ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    {t("facilityInvitation.existingSignedIn", {
                      email: user.email,
                    })}
                  </p>
                  <Button
                    className="w-full"
                    disabled={submitting}
                    onClick={() => void acceptExisting()}
                  >
                    {t("facilityInvitation.accept")}
                  </Button>
                </div>
              ) : (
                <Button asChild className="w-full">
                  <Link to={loginPath}>
                    {t("facilityInvitation.signInToAccept")}
                  </Link>
                </Button>
              )
            ) : (
              <form onSubmit={acceptNew} className="space-y-4">
                <p className="text-sm text-slate-600">
                  {t("facilityInvitation.chooseOwnPassword")}
                </p>
                <PasswordInput
                  value={password}
                  minLength={12}
                  maxLength={128}
                  required
                  placeholder={t("common.password")}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <PasswordInput
                  value={confirmPassword}
                  minLength={12}
                  maxLength={128}
                  required
                  placeholder={t("auth.confirmPassword")}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <label className="flex gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                  />
                  <span>{t("auth.acceptTerms")}</span>
                </label>
                <label className="flex gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={acceptedPrivacy}
                    onChange={(event) =>
                      setAcceptedPrivacy(event.target.checked)
                    }
                  />
                  <span>
                    {t("auth.acceptPrivacy")}{" "}
                    <Link className="font-semibold text-blue-700" to="/privacy">
                      {t("legal.footer.privacy")}
                    </Link>
                  </span>
                </label>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {t("facilityInvitation.createAndAccept")}
                </Button>
              </form>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting}
              onClick={() => void decline()}
            >
              {t("facilityInvitation.decline")}
            </Button>
          </div>
        )
      ) : null}
    </AuthShell>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Building2, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAccessRole } from "../context/auth-context";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";
import { VerifiedForm } from "./VerifiedForm";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

const BASE = import.meta.env.VITE_API_URL ?? "";

interface FacilityLink {
  id: string;
  targetFacilityName: string;
  mode: string;
  status: string;
}

export function FacilityLinksPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const accessRole = getAccessRole(user);
  const [links, setLinks] = useState<FacilityLink[]>([]);
  const [targetFacility, setTargetFacility] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (accessRole !== "admin") return;
    try {
      const response = await authFetch(`${BASE}/api/community/facility-links`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Request failed");
      setLinks(body as FacilityLink[]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [accessRole]);

  useEffect(() => {
    void load();
  }, [load]);

  if (accessRole !== "admin") return null;

  const createLink = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await authFetch(`${BASE}/api/community/facility-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetFacilityName: targetFacility,
          mode: "temporary",
          sharedSpaces: ["announcements", "events"],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Request failed");
      setTargetFacility("");
      setNotice(t("community.facilityLinkRequested"));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const withdrawLink = async (linkId: string) => {
    try {
      const response = await authFetch(
        `${BASE}/api/community/facility-links/${linkId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "facility_link_terminated" }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Request failed");
      setNotice(t("community.facilityLinkWithdrawn"));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card className="mt-6 overflow-hidden rounded-3xl border-brand-path/20 bg-white/95 p-0 shadow-sm">
      <div className="h-1.5 bg-gradient-to-r from-brand-path via-brand-steel to-brand-ember" />
      <div className="p-6">
        <h2 className="flex items-center gap-2 font-bold text-brand-night">
          <Building2 className="text-brand-path" />
          {t("community.facilityLinks")}
        </h2>
        <p className="mt-2 text-sm text-brand-slate">
          {t("community.facilityLinksDescription")}
        </p>
        {notice && (
          <p
            role="status"
            className="mt-4 rounded-xl bg-brand-path/10 p-3 text-sm text-brand-slate"
          >
            {notice}
          </p>
        )}
        <VerifiedForm
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={createLink}
        >
          <Input
            required
            minLength={2}
            maxLength={120}
            value={targetFacility}
            onChange={(event) => setTargetFacility(event.target.value)}
            placeholder={t("community.facilityName")}
          />
          <Button type="submit">
            <Link2 aria-hidden="true" />
            {t("community.requestFacilityLink")}
          </Button>
        </VerifiedForm>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"
            >
              <strong className="text-brand-night">
                {link.targetFacilityName}
              </strong>
              <span className="mt-1 block text-brand-steel">
                {t(`community.facilityLinkModes.${link.mode}`)} ·{" "}
                {t(`community.facilityLinkStatuses.${link.status}`)}
              </span>
              {![
                "facility_link_rejected",
                "facility_link_expired",
                "facility_link_terminated",
              ].includes(link.status) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void withdrawLink(link.id)}
                >
                  {t("community.withdrawFacilityLink")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

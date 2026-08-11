import { useCallback, useEffect, useState } from "react";
import { Flag, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { VerifiedForm } from "../components/VerifiedForm";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";
import { getAccessRole } from "../context/auth-context";

const BASE = import.meta.env.VITE_API_URL ?? "";
interface Case {
  id: string;
  category: string;
  description: string;
  urgency: string;
  status: string;
}
interface FacilityLink {
  id: string;
  targetFacilityName: string;
  mode: string;
  status: string;
}
interface ParentalControl {
  id: string;
  childUserId: string;
  guardianUserId: string;
  status: string;
}
export function ModerationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const accessRole = getAccessRole(user);
  const [cases, setCases] = useState<Case[]>([]);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("conduct");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [facilityLinks, setFacilityLinks] = useState<FacilityLink[]>([]);
  const [parentalControls, setParentalControls] = useState<ParentalControl[]>(
    [],
  );
  const [targetFacility, setTargetFacility] = useState("");
  const [childUserId, setChildUserId] = useState("");
  const [guardianUserId, setGuardianUserId] = useState("");
  const api = async <T,>(path: string, init?: RequestInit) => {
    const response = await authFetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Request failed");
    return body as T;
  };
  const load = useCallback(async () => {
    try {
      setCases(await api<Case[]>("/api/moderation/cases"));
      if (accessRole === "admin") {
        const [links, controls] = await Promise.all([
          api<FacilityLink[]>("/api/community/facility-links"),
          api<ParentalControl[]>("/api/community/parental-controls"),
        ]);
        setFacilityLinks(links);
        setParentalControls(controls);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [accessRole]);
  useEffect(() => {
    void load();
  }, [load]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/moderation/cases", {
        method: "POST",
        body: JSON.stringify({
          subjectUserId: subject || null,
          category,
          description,
          urgency: "normal",
        }),
      });
      setDescription("");
      setNotice(t("moderation.created"));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const resolve = async (id: string) => {
    try {
      await api(`/api/moderation/cases/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "resolved",
          resolution: t("moderation.defaultResolution"),
        }),
      });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const createFacilityLink = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/community/facility-links", {
        method: "POST",
        body: JSON.stringify({
          targetFacilityName: targetFacility,
          mode: "temporary",
          sharedSpaces: ["announcements", "events"],
        }),
      });
      setTargetFacility("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const createParentalControl = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/community/parental-controls", {
        method: "POST",
        body: JSON.stringify({
          childUserId,
          guardianUserId,
          settings: {
            unknownMessages: "blocked",
            contactRequests: "approval_required",
            files: "approval_required",
          },
        }),
      });
      setChildUserId("");
      setGuardianUserId("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[.18em] text-blue-600">
          {t("moderation.eyebrow")}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{t("moderation.title")}</h1>
        <p className="mt-2 text-slate-600">{t("moderation.description")}</p>
        {notice && (
          <div className="mt-4 rounded-xl bg-blue-50 p-3">{notice}</div>
        )}
        <Card className="mt-6 rounded-3xl p-6">
          <h2 className="flex items-center gap-2 font-bold">
            <Flag className="text-red-600" />
            {t("moderation.newReport")}
          </h2>
          <VerifiedForm className="mt-4 space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>{t("moderation.subject")}</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div>
                <Label>{t("moderation.category")}</Label>
                <Input
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>{t("moderation.details")}</Label>
              <textarea
                required
                minLength={10}
                maxLength={4000}
                className="mt-2 min-h-32 w-full rounded-xl border p-3"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <Button type="submit">{t("moderation.submit")}</Button>
          </VerifiedForm>
        </Card>
        <div className="mt-6 space-y-3">
          {cases.map((item) => (
            <Card key={item.id} className="rounded-2xl p-5">
              <div className="flex justify-between gap-3">
                <div>
                  <h3 className="font-bold">{item.category}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.description}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {item.status} · {item.urgency}
                  </p>
                </div>
                {accessRole === "admin" && item.status !== "resolved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolve(item.id)}
                  >
                    <Scale />
                    {t("moderation.resolve")}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
        {accessRole === "admin" && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card className="rounded-3xl p-6">
              <h2 className="font-bold">{t("moderation.facilityLinks")}</h2>
              <VerifiedForm
                className="mt-4 flex gap-2"
                onSubmit={createFacilityLink}
              >
                <Input
                  required
                  minLength={2}
                  maxLength={120}
                  value={targetFacility}
                  onChange={(event) => setTargetFacility(event.target.value)}
                  placeholder={t("moderation.facilityName")}
                />
                <Button type="submit">{t("moderation.request")}</Button>
              </VerifiedForm>
              <div className="mt-3 space-y-2">
                {facilityLinks.map((link) => (
                  <div
                    key={link.id}
                    className="rounded-xl bg-slate-100 p-3 text-sm"
                  >
                    <strong>{link.targetFacilityName}</strong>
                    <span className="block text-slate-500">
                      {link.mode} · {link.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="rounded-3xl p-6">
              <h2 className="font-bold">{t("moderation.parentalControls")}</h2>
              <VerifiedForm
                className="mt-4 space-y-3"
                onSubmit={createParentalControl}
              >
                <Input
                  required
                  value={childUserId}
                  onChange={(event) => setChildUserId(event.target.value)}
                  placeholder={t("moderation.childId")}
                />
                <Input
                  required
                  value={guardianUserId}
                  onChange={(event) => setGuardianUserId(event.target.value)}
                  placeholder={t("moderation.guardianId")}
                />
                <Button type="submit">{t("moderation.createReview")}</Button>
              </VerifiedForm>
              <div className="mt-3 space-y-2">
                {parentalControls.map((control) => (
                  <div
                    key={control.id}
                    className="rounded-xl bg-slate-100 p-3 text-sm"
                  >
                    {control.childUserId} → {control.guardianUserId}
                    <span className="block text-slate-500">
                      {control.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

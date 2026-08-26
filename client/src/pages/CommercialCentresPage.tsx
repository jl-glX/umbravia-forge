import { useEffect, useState } from "react";
import {
  ExternalLink,
  MapPin,
  Phone,
  Search,
  Ticket,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../lib/api";
import type { PublishedCommercialCentre } from "../lib/commercial";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";

type CentreSummary = Pick<
  PublishedCommercialCentre,
  | "slug"
  | "name"
  | "logoDataUrl"
  | "accentColor"
  | "facilityType"
  | "publicDescription"
  | "city"
  | "country"
  | "classTypes"
>;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await authFetch(path);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

function CentreMark({ centre }: { centre: CentreSummary }) {
  return centre.logoDataUrl ? (
    <img
      src={centre.logoDataUrl}
      alt=""
      className="size-16 rounded-2xl bg-white object-contain p-2 shadow-sm"
    />
  ) : (
    <span
      className="grid size-16 place-items-center rounded-2xl text-2xl font-black text-white shadow-sm"
      style={{ backgroundColor: centre.accentColor }}
    >
      {centre.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function CommercialCentresPage() {
  const { t } = useTranslation();
  const [centres, setCentres] = useState<CentreSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchJson<CentreSummary[]>("/api/commercial/public-centres")
      .then(setCentres)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setLoading(false));
  }, []);

  const normalized = query.trim().toLocaleLowerCase();
  const filtered = centres.filter((centre) =>
    [centre.name, centre.city, centre.country, ...centre.classTypes]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-[2rem] bg-slate-950 px-6 py-10 text-white md:px-10">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">
            {t("commercial.directory.eyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-black md:text-5xl">
            {t("commercial.directory.title")}
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
            {t("commercial.directory.description")}
          </p>
          <div className="relative mt-7 max-w-xl">
            <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("commercial.directory.search")}
              className="h-12 border-white/20 bg-white pl-12 text-slate-950"
            />
          </div>
        </header>

        {loading && (
          <p className="mt-8 text-slate-600">{t("common.loading")}</p>
        )}
        {error && (
          <p role="alert" className="mt-8 text-red-700">
            {error}
          </p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <Card className="mt-8 p-8 text-center text-slate-600">
            {t("commercial.directory.empty")}
          </Card>
        )}
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((centre) => (
            <Link
              key={centre.slug}
              to={`/centres/${centre.slug}`}
              className="group"
            >
              <Card className="h-full overflow-hidden border-slate-200 p-0 transition-transform group-hover:-translate-y-1 group-hover:shadow-lg">
                <div
                  className="h-2"
                  style={{ backgroundColor: centre.accentColor }}
                />
                <div className="p-6">
                  <CentreMark centre={centre} />
                  <h2 className="mt-5 text-xl font-black text-slate-950">
                    {centre.name}
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-blue-700">
                    {t(`commercial.facilityTypes.${centre.facilityType}`)}
                  </p>
                  {(centre.city || centre.country) && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                      <MapPin className="size-4" />
                      {[centre.city, centre.country].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">
                    {centre.publicDescription ||
                      t("commercial.directory.noDescription")}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

export function PublishedCommercialCentrePage() {
  const { slug = "" } = useParams();
  const { t } = useTranslation();
  const [centre, setCentre] = useState<PublishedCommercialCentre | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchJson<PublishedCommercialCentre>(
      `/api/commercial/public-centres/${encodeURIComponent(slug)}`,
    )
      .then(setCentre)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [slug]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <Card className="max-w-xl p-8 text-center">
          <h1 className="text-2xl font-black text-slate-950">
            {t("commercial.directory.notFound")}
          </h1>
          <Button asChild className="mt-5">
            <Link to="/centres">{t("commercial.directory.back")}</Link>
          </Button>
        </Card>
      </main>
    );
  }
  if (!centre)
    return (
      <main className="grid min-h-screen place-items-center">
        {t("common.loading")}
      </main>
    );

  const links = [
    ["websiteUrl", centre.websiteUrl],
    ["instagramUrl", centre.instagramUrl],
    ["facebookUrl", centre.facebookUrl],
    ["tiktokUrl", centre.tiktokUrl],
    ["youtubeUrl", centre.youtubeUrl],
    ["linkedinUrl", centre.linkedinUrl],
  ].filter(([, value]) => value) as Array<[string, string]>;

  return (
    <main className="min-h-screen bg-slate-50">
      <header
        className="px-4 py-10 text-white"
        style={{ backgroundColor: centre.accentColor }}
      >
        <div className="mx-auto max-w-5xl">
          <Link
            to="/centres"
            className="text-sm font-semibold text-white/80 hover:text-white"
          >
            ← {t("commercial.directory.back")}
          </Link>
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-center">
            <CentreMark centre={centre} />
            <div>
              <h1 className="text-4xl font-black md:text-5xl">{centre.name}</h1>
              <p className="mt-2 text-lg font-semibold text-white/85">
                {t(`commercial.facilityTypes.${centre.facilityType}`)}
              </p>
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-6">
          <Card className="p-6 md:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              {t("commercial.directory.about")}
            </h2>
            <p className="mt-4 whitespace-pre-wrap leading-7 text-slate-700">
              {centre.publicDescription ||
                t("commercial.directory.noDescription")}
            </p>
            {centre.classTypes.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {centre.classTypes.map((activity) => (
                  <span
                    key={activity}
                    className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800"
                  >
                    {activity}
                  </span>
                ))}
              </div>
            )}
          </Card>
          {centre.scheduleNotes && (
            <Card className="p-6 md:p-8">
              <h2 className="text-xl font-black">
                {t("commercial.directory.schedule")}
              </h2>
              <p className="mt-4 whitespace-pre-wrap leading-7 text-slate-700">
                {centre.scheduleNotes}
              </p>
            </Card>
          )}
          {(centre.pricingDescription || centre.bonusesDescription) && (
            <Card className="p-6 md:p-8">
              <h2 className="flex items-center gap-2 text-xl font-black">
                <Ticket /> {t("commercial.directory.prices")}
              </h2>
              {centre.pricingDescription && (
                <p className="mt-4 whitespace-pre-wrap leading-7 text-slate-700">
                  {centre.pricingDescription}
                </p>
              )}
              {centre.bonusesDescription && (
                <p className="mt-4 whitespace-pre-wrap border-t border-slate-200 pt-4 leading-7 text-slate-700">
                  {centre.bonusesDescription}
                </p>
              )}
            </Card>
          )}
        </div>
        <aside className="space-y-6">
          {(centre.addressLine || centre.city || centre.country) && (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-black">
                <MapPin /> {t("commercial.directory.location")}
              </h2>
              <p className="mt-4 leading-7 text-slate-700">
                {[
                  centre.addressLine,
                  centre.postalCode,
                  centre.city,
                  centre.country,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </Card>
          )}
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-black">
              <Users /> {t("commercial.directory.links")}
            </h2>
            {centre.phone && (
              <a
                href={`tel:${centre.phone}`}
                className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                <span className="flex items-center gap-2">
                  <Phone className="size-4" />
                  {t("commercial.directory.phone")}
                </span>
                <span>{centre.phone}</span>
              </a>
            )}
            {links.length ? (
              <div className="mt-2 space-y-2">
                {links.map(([label, url]) => (
                  <a
                    key={label}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    {t(`commercial.trial.fields.${label}`)}
                    <ExternalLink className="size-4" />
                  </a>
                ))}
              </div>
            ) : (
              !centre.phone && (
                <p className="mt-3 text-sm text-slate-500">
                  {t("commercial.directory.noLinks")}
                </p>
              )
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}

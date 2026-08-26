import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultFacilityProfile,
  FacilityProfileContext,
  type FacilityProfile,
} from "../context/facility-profile-context";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";
import { useTranslation } from "react-i18next";

export function FacilityProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [profile, setProfile] = useState(defaultFacilityProfile);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantHostUnavailable, setTenantHostUnavailable] = useState(false);

  useEffect(() => {
    if (!user) {
      let active = true;
      setProfile(defaultFacilityProfile);
      setError(null);
      setTenantHostUnavailable(false);
      setIsLoading(true);
      authFetch("/api/tenant-context")
        .then(async (response) => {
          if (response.status === 204) return null;
          const body = (await response.json()) as {
            code?: string;
            error?: string;
            facility?: Pick<
              FacilityProfile,
              "name" | "logoDataUrl" | "accentColor"
            >;
          };
          if (!response.ok) {
            if (body.code === "FACILITY_HOST_NOT_FOUND") {
              if (active) setTenantHostUnavailable(true);
              return null;
            }
            throw new Error(body.error ?? "Tenant profile load failed");
          }
          return body.facility ?? null;
        })
        .then((facility) => {
          if (!active || !facility) return;
          setProfile({
            ...defaultFacilityProfile,
            ...facility,
          });
          setTenantHostUnavailable(false);
          setError(null);
        })
        .catch((cause) => {
          if (active)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
      return () => {
        active = false;
      };
    }

    let active = true;
    setIsLoading(true);
    setTenantHostUnavailable(false);
    authFetch("/api/facility-profile")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Profile load failed");
        return body as FacilityProfile;
      })
      .then((body) => {
        if (active) {
          setProfile(body);
          setError(null);
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--facility-accent",
      profile.accentColor,
    );
  }, [profile.accentColor]);

  const updateProfile = useCallback(
    async (
      values: Partial<
        Pick<FacilityProfile, "name" | "logoDataUrl" | "accentColor">
      >,
    ) => {
      const response = await authFetch("/api/facility-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Profile update failed");
      setProfile(body as FacilityProfile);
      setError(null);
      return body as FacilityProfile;
    },
    [],
  );

  const value = useMemo(
    () => ({ profile, isLoading, error, updateProfile }),
    [error, isLoading, profile, updateProfile],
  );

  if (tenantHostUnavailable) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-ember">
            {t("tenantHost.notFoundEyebrow")}
          </p>
          <h1 className="mt-3 text-3xl font-black text-brand-night">
            {t("tenantHost.notFoundTitle")}
          </h1>
          <p className="mt-4 leading-7 text-brand-steel">
            {t("tenantHost.notFoundBody")}
          </p>
        </section>
      </main>
    );
  }

  return (
    <FacilityProfileContext.Provider value={value}>
      {children}
    </FacilityProfileContext.Provider>
  );
}

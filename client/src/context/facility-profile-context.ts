import { createContext } from "react";

export interface FacilityProfile {
  id: string;
  name: string;
  logoDataUrl: string;
  accentColor: string;
  updatedAt: number;
}

export interface FacilityProfileContextValue {
  profile: FacilityProfile;
  isLoading: boolean;
  error: string | null;
  updateProfile: (
    values: Partial<
      Pick<FacilityProfile, "name" | "logoDataUrl" | "accentColor">
    >,
  ) => Promise<FacilityProfile>;
}

export const defaultFacilityProfile: FacilityProfile = {
  id: "",
  name: "Umbravia Forge",
  logoDataUrl: "",
  accentColor: "#2563eb",
  updatedAt: 0,
};

export const FacilityProfileContext =
  createContext<FacilityProfileContextValue | null>(null);

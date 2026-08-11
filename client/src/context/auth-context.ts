import { createContext } from "react";

export type UserRole = "member" | "trainer" | "admin";
export type FacilityRole = "owner" | "admin" | "trainer" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: UserRole;
  accountStatus: "pending_verification" | "active" | "security_review";
  facility?: {
    id: string;
    slug: string;
    name: string;
    role: FacilityRole;
  } | null;
  platformOperator?: boolean;
}

export function getAccessRole(user: AuthUser | null): UserRole | null {
  const facilityRole = user?.facility?.role;
  if (facilityRole === "owner" || facilityRole === "admin") return "admin";
  return facilityRole ?? user?.role ?? null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isInitializing: boolean;
  error: string | null;
  clearError: () => void;
  signup: (input: {
    email: string;
    name: string;
    lastName: string;
    password: string;
    countryCode: string;
    locale: "es" | "en" | "de" | "de-CH";
    acceptedTerms: boolean;
    acceptedPrivacy: boolean;
    captchaToken: string;
    accountType: "member" | "administrator";
    facilityName?: string;
    facilityType?: string;
  }) => Promise<{
    user: AuthUser;
    verificationRequired: boolean;
    demoVerificationCode?: string;
  }>;
  login: (
    identifier: string,
    password: string,
    accessPortal: "member" | "staff",
    rememberDevice: boolean,
    captchaToken: string,
  ) => Promise<{ mfaRequired: boolean; user?: AuthUser }>;
  loginWithPasskey: (
    identifier: string,
    accessPortal: "member" | "staff",
    rememberDevice: boolean,
    captchaToken: string,
  ) => Promise<AuthUser>;
  verifyMfa: (code: string) => Promise<AuthUser>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

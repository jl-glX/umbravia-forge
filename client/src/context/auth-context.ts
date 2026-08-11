import { createContext } from "react";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarDataUrl: string;
  role: "member" | "trainer" | "admin";
  accountStatus: "pending_verification" | "active" | "security_review";
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

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext, AuthUser } from "../context/auth-context";
import { authFetch } from "../lib/api";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  LOGIN_PUBLIC_ERROR_CODES,
  PASSKEY_PUBLIC_ERROR_CODES,
  SIGNUP_PUBLIC_ERROR_CODES,
  normalizePublicAuthError,
  readPublicAuthResponse,
  requirePublicAuthUser,
  type PublicAuthErrorCode,
} from "../lib/public-auth-errors";
import type { SupportedLocale } from "../i18n/supported-locales";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<PublicAuthErrorCode | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const refreshUser = useCallback(async () => {
    const response = await authFetch(`${API_BASE}/api/auth/session`);
    if (!response.ok) {
      setUser(null);
      return;
    }
    const data = (await response.json()) as { user: AuthUser };
    setUser(data.user);
  }, []);

  useEffect(() => {
    refreshUser()
      .catch(() => setUser(null))
      .finally(() => {
        setIsLoading(false);
        setIsInitializing(false);
      });
  }, [refreshUser]);

  const login = useCallback(
    async (
      identifier: string,
      password: string,
      accessPortal: "member" | "staff",
      rememberDevice: boolean,
      captchaToken: string,
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await authFetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier,
            password,
            accessPortal,
            rememberDevice,
            captchaToken,
          }),
        });
        const data = await readPublicAuthResponse<{
          user?: AuthUser;
          demoVerificationCode?: string;
          mfaRequired?: boolean;
        }>(response, LOGIN_PUBLIC_ERROR_CODES);
        if (data.mfaRequired) return { mfaRequired: true };
        const authenticatedUser = requirePublicAuthUser(data.user);
        setUser(authenticatedUser);
        return { mfaRequired: false, user: authenticatedUser };
      } catch (cause) {
        const publicError = normalizePublicAuthError(cause);
        setError(publicError.code);
        throw publicError;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const loginWithPasskey = useCallback(
    async (
      identifier: string,
      accessPortal: "member" | "staff",
      rememberDevice: boolean,
      captchaToken: string,
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const optionsResponse = await authFetch(
          `${API_BASE}/api/auth/passkey/options`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              identifier,
              accessPortal,
              rememberDevice,
              captchaToken,
            }),
          },
        );
        const options = await readPublicAuthResponse<
          Parameters<typeof startAuthentication>[0]["optionsJSON"]
        >(optionsResponse, PASSKEY_PUBLIC_ERROR_CODES);
        const response = await startAuthentication({
          optionsJSON: options,
        });
        const verificationResponse = await authFetch(
          `${API_BASE}/api/auth/passkey/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response }),
          },
        );
        const data = await readPublicAuthResponse<{
          user?: AuthUser;
        }>(verificationResponse, PASSKEY_PUBLIC_ERROR_CODES);
        const authenticatedUser = requirePublicAuthUser(data.user);
        setUser(authenticatedUser);
        return authenticatedUser;
      } catch (cause) {
        const publicError = normalizePublicAuthError(cause);
        setError(publicError.code);
        throw publicError;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const verifyMfa = useCallback(async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/api/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await readPublicAuthResponse<{
        user?: AuthUser;
      }>(response);
      const authenticatedUser = requirePublicAuthUser(data.user);
      setUser(authenticatedUser);
      return authenticatedUser;
    } catch (cause) {
      const publicError = normalizePublicAuthError(cause);
      setError(publicError.code);
      throw publicError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signup = useCallback(
    async (input: {
      email: string;
      name: string;
      lastName: string;
      password: string;
      countryCode: string;
      locale: SupportedLocale;
      acceptedTerms: boolean;
      acceptedPrivacy: boolean;
      captchaToken: string;
      accountType: "member" | "administrator";
      facilityName?: string;
      facilityType?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await authFetch(`${API_BASE}/api/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await readPublicAuthResponse<{
          user?: AuthUser;
          demoVerificationCode?: string;
          verificationRequired?: boolean;
        }>(response, SIGNUP_PUBLIC_ERROR_CODES);
        const authenticatedUser = requirePublicAuthUser(data.user);
        setUser(authenticatedUser);
        return {
          user: authenticatedUser,
          verificationRequired: Boolean(data.verificationRequired),
          demoVerificationCode: data.demoVerificationCode,
        };
      } catch (cause) {
        const publicError = normalizePublicAuthError(cause);
        setError(publicError.code);
        throw publicError;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authFetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
    } finally {
      setUser(null);
      setError(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isInitializing,
      error,
      clearError,
      signup,
      login,
      loginWithPasskey,
      verifyMfa,
      refreshUser,
      logout,
    }),
    [
      user,
      isLoading,
      isInitializing,
      error,
      clearError,
      signup,
      login,
      loginWithPasskey,
      verifyMfa,
      refreshUser,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

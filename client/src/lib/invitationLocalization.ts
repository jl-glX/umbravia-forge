import { canonicalizeLocale } from "../i18n/supported-locales";

export function buildInvitationCreationPayload(input: {
  email: string;
  name: string;
  role: "member" | "trainer" | "admin";
  interfaceLocale: string | null | undefined;
}) {
  return {
    email: input.email,
    name: input.name,
    role: input.role,
    locale: canonicalizeLocale(input.interfaceLocale),
  };
}

export function buildInvitationAcceptancePayload(input: {
  password: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  interfaceLocale: string | null | undefined;
}) {
  return {
    password: input.password,
    locale: canonicalizeLocale(input.interfaceLocale),
    acceptedTerms: input.acceptedTerms,
    acceptedPrivacy: input.acceptedPrivacy,
  };
}

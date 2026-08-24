export const DEFAULT_EXTERNAL_HELPDESK_EMAIL =
  "umbravia-forge-scrf@support.openhelpdesk.dev";
export const DEFAULT_EXTERNAL_HELPDESK_PORTAL_URL =
  "https://support.umbraviaforge.com";
export const DEFAULT_GENERAL_FALLBACK_EMAIL = "umbraviaforge@gmail.com";
export const DEFAULT_LEGAL_RIGHTS_EMAIL = "umbraviaforge@gmail.com";

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function email(value: string | undefined, fallback: string): string {
  const candidate = value?.trim().toLowerCase() || fallback;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate)) {
    throw Object.assign(new Error("Public support email is invalid"), {
      statusCode: 500,
    });
  }
  return candidate;
}

function httpsUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw Object.assign(new Error("Public support portal URL is invalid"), {
      statusCode: 500,
    });
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw Object.assign(new Error("Public support portal URL is invalid"), {
      statusCode: 500,
    });
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function internalSupportTicketsEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(environment.INTERNAL_SUPPORT_TICKETS_ENABLED);
}

export function umfSupportOperationalWorkspaceEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabled(environment.UMF_SUPPORT_OPERATIONAL_WORKSPACE_ENABLED);
}

export function publicSupportContacts(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return {
    helpdeskPortalEnabled: enabled(
      environment.EXTERNAL_HELPDESK_PORTAL_ENABLED,
    ),
    helpdeskPortalUrl: httpsUrl(
      environment.EXTERNAL_HELPDESK_PORTAL_URL,
      DEFAULT_EXTERNAL_HELPDESK_PORTAL_URL,
    ),
    helpdeskEmail: email(
      environment.EXTERNAL_HELPDESK_EMAIL_ADDRESS,
      DEFAULT_EXTERNAL_HELPDESK_EMAIL,
    ),
    generalFallbackEmail: email(
      environment.GENERAL_CONTACT_EMAIL_ADDRESS,
      DEFAULT_GENERAL_FALLBACK_EMAIL,
    ),
    legalRightsEmail: email(
      environment.LEGAL_RIGHTS_EMAIL_ADDRESS,
      DEFAULT_LEGAL_RIGHTS_EMAIL,
    ),
  };
}

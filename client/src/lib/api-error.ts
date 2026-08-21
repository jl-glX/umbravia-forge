interface ApiErrorPayload {
  code?: unknown;
  error?: unknown;
}

type Translate = (key: string) => string;

const FACILITY_MEMBERSHIP_MESSAGE = "An active facility membership is required";

export function localizedApiErrorCodeMessage(
  code: unknown,
  fallback: string,
  translate: Translate,
): string {
  if (code === "FACILITY_MEMBERSHIP_REQUIRED") {
    return translate("errors.facilityMembershipRequired");
  }

  if (code === "INVALID_CREDENTIALS") {
    return translate("umfSupportAccess.invalidCredentials");
  }

  return fallback;
}

export async function localizedApiErrorMessage(
  response: Response,
  fallback: string,
  translate: Translate,
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => null)) as ApiErrorPayload | null;

  const normalizedCode =
    payload?.code === "FACILITY_MEMBERSHIP_REQUIRED" ||
    payload?.error === FACILITY_MEMBERSHIP_MESSAGE
      ? "FACILITY_MEMBERSHIP_REQUIRED"
      : payload?.code;

  return localizedApiErrorCodeMessage(normalizedCode, fallback, translate);
}

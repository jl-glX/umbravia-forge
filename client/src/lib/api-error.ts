interface ApiErrorPayload {
  code?: unknown;
  error?: unknown;
}

type Translate = (key: string) => string;

const FACILITY_MEMBERSHIP_MESSAGE = "An active facility membership is required";

export async function localizedApiErrorMessage(
  response: Response,
  fallback: string,
  translate: Translate,
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => null)) as ApiErrorPayload | null;

  if (
    payload?.code === "FACILITY_MEMBERSHIP_REQUIRED" ||
    payload?.error === FACILITY_MEMBERSHIP_MESSAGE
  ) {
    return translate("errors.facilityMembershipRequired");
  }

  return fallback;
}

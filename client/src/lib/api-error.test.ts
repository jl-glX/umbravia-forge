import { describe, expect, it } from "vitest";
import { localizedApiErrorMessage } from "./api-error.js";

const messages: Record<string, string> = {
  "errors.facilityMembershipRequired": "translated membership explanation",
};
const translate = (key: string) => messages[key] ?? key;

describe("localizedApiErrorMessage", () => {
  it("translates the stable missing-membership code", async () => {
    const response = Response.json(
      {
        code: "FACILITY_MEMBERSHIP_REQUIRED",
        error: "An active facility membership is required",
      },
      { status: 403 },
    );

    await expect(
      localizedApiErrorMessage(response, "fallback", translate),
    ).resolves.toBe("translated membership explanation");
  });

  it("translates the legacy server message during a rolling deployment", async () => {
    const response = Response.json(
      { code: "FORBIDDEN", error: "An active facility membership is required" },
      { status: 403 },
    );

    await expect(
      localizedApiErrorMessage(response, "fallback", translate),
    ).resolves.toBe("translated membership explanation");
  });

  it("does not expose unrelated server messages", async () => {
    const response = Response.json(
      { code: "FORBIDDEN", error: "internal server wording" },
      { status: 403 },
    );

    await expect(
      localizedApiErrorMessage(response, "localized fallback", translate),
    ).resolves.toBe("localized fallback");
  });
});

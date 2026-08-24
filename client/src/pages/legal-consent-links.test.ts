import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legal consent links", () => {
  it.each(["SignupPage.tsx", "FacilityInvitationPage.tsx"])(
    "%s links the privacy consent to the public policy",
    (page) => {
      const source = readFileSync(resolve("client/src/pages", page), "utf8");

      expect(source).toContain('to="/privacy"');
      expect(source).toContain('t("auth.acceptPrivacy")');
      expect(source).toContain('t("legal.footer.privacy")');
    },
  );
});

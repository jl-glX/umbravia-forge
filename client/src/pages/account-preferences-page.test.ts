import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("account preferences navigation", () => {
  it("exposes Preferences as a protected operational account option", () => {
    const app = read("client/src/App.tsx");
    const accountControl = read("client/src/pages/AccountControlPage.tsx");

    expect(app).toContain('path="/account/preferences"');
    expect(app).toContain("<AccountPreferencesPage />");
    expect(app).toContain('path="/account/data"');
    expect(app).toContain("<AccountDataPage />");
    expect(accountControl).toContain('to: "/account/preferences"');
  });

  it("separates data management from deletion and connects the owner policy", () => {
    const preferences = read("client/src/pages/AccountPreferencesPage.tsx");
    const dataManagement = read("client/src/pages/AccountDataPage.tsx");

    expect(preferences).toContain(
      'authFetch("/api/users/member-affiliation-policy")',
    );
    expect(preferences).toContain('to="/account/data"');
    expect(preferences).not.toContain('to="/account/delete-data"');
    expect(preferences).toContain('user?.facility?.role === "owner"');
    expect(preferences).toContain("policy.allowAllStaff ?");
    expect(preferences).toContain('t("accountPreferences.specificNotNeeded")');
    expect(dataManagement).toContain('to="/privacy"');
    expect(dataManagement).toContain("contacts.legalRightsEmail");
    expect(dataManagement).toContain('to="/account/delete-data"');
  });
});

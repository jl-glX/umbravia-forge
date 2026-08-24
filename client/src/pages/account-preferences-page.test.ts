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
    expect(accountControl).toContain('to: "/account/preferences"');
  });

  it("connects privacy and the owner-managed staff affiliation policy", () => {
    const preferences = read("client/src/pages/AccountPreferencesPage.tsx");

    expect(preferences).toContain(
      'authFetch("/api/users/member-affiliation-policy")',
    );
    expect(preferences).toContain('to="/privacy"');
    expect(preferences).toContain('to="/account/delete-data"');
    expect(preferences).toContain('user?.facility?.role === "owner"');
  });
});

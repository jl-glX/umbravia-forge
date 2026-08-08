import { describe, expect, it } from "vitest";
import { cacheControlForStaticFile } from "./static-serve.js";

describe("static serving cache policy", () => {
  it("allows long-lived caching only for versioned Vite assets", () => {
    expect(
      cacheControlForStaticFile(
        "C:\\app\\dist\\public\\assets\\index-DLXFBuWL.js",
      ),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("keeps HTML out of intermediary and browser caches", () => {
    expect(cacheControlForStaticFile("/app/dist/public/index.html")).toBe(
      "no-store",
    );
  });

  it("uses a short cache for stable public assets without a content hash", () => {
    expect(cacheControlForStaticFile("/app/dist/public/favicon.svg")).toBe(
      "public, max-age=3600",
    );
  });
});

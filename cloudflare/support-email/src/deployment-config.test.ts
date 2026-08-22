import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface WranglerConfig {
  name: string;
  main: string;
  compatibility_flags?: string[];
  vars?: Record<string, string>;
  observability?: {
    enabled?: boolean;
    head_sampling_rate?: number;
  };
}

async function readConfig(path: string): Promise<WranglerConfig> {
  const jsonc = await readFile(path, "utf8");
  const withoutTrailingCommas = jsonc.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas) as WranglerConfig;
}

describe("Cloudflare email Worker deployment boundaries", () => {
  it("keeps the tenant and UMF Support deployments distinct", async () => {
    const tenantSupport = await readConfig(
      "cloudflare/support-email/wrangler.jsonc",
    );
    const umfSupport = await readConfig("cloudflare/wrangler.jsonc");

    expect(tenantSupport).toMatchObject({
      name: "umbravia-forge-support-email",
      main: "src/index.ts",
    });
    expect(umfSupport).toMatchObject({
      name: "umbravia-forge-umf-support-email",
      main: "support-email/src/index.ts",
      compatibility_flags: ["global_fetch_private_origin"],
      vars: {
        SUPPORT_INBOUND_ENDPOINT:
          "https://www.umbraviaforge.com/api/internal/umf-support-email",
      },
      observability: {
        enabled: true,
        head_sampling_rate: 1,
      },
    });
    expect(umfSupport.name).not.toBe(tenantSupport.name);
  });
});

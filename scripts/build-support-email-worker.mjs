import { mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const outputDirectory = path.join(process.cwd(), "dist", "workers");
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: ["cloudflare/support-email/src/index.ts"],
  outfile: path.join(outputDirectory, "support-email-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
});

console.log("Cloudflare support email Worker compiled.");

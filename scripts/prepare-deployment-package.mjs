import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, ".deployment-package");
const releaseCapabilities = JSON.parse(
  await readFile(
    path.join(root, "deploy", "release-capabilities.json"),
    "utf8",
  ),
);
if (
  releaseCapabilities.schemaVersion !== 1 ||
  !Array.isArray(releaseCapabilities.supportedLocales) ||
  releaseCapabilities.supportedLocales.length === 0 ||
  new Set(releaseCapabilities.supportedLocales).size !==
    releaseCapabilities.supportedLocales.length
) {
  throw new Error("Deployment release capabilities are invalid.");
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "scripts"), { recursive: true });
await cp(path.join(root, "dist"), path.join(output, "dist"), {
  recursive: true,
});
await cp(
  path.join(root, "scripts", "start-production.mjs"),
  path.join(output, "scripts", "start-production.mjs"),
);
await cp(path.join(root, "package.json"), path.join(output, "package.json"));
await cp(path.join(root, "deploy"), path.join(output, "deploy"), {
  recursive: true,
});
await cp(
  path.join(root, "package-lock.json"),
  path.join(output, "package-lock.json"),
);

console.log(`Deployment package prepared at ${output}`);

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), ".deployment-package");
const forbiddenDirectoryNames = new Set([".git", ".hg", ".svn", ".ssh"]);
const forbiddenFileExtensions = new Set([
  ".db",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
  ".sql",
  ".sqlite",
  ".sqlite3",
]);
const forbiddenFileNames = new Set([
  ".npmrc",
  ".yarnrc",
  "id_rsa",
  "id_ed25519",
]);

async function collectFiles(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (forbiddenDirectoryNames.has(entry.name.toLowerCase())) {
        throw new Error(
          `Forbidden directory in deployment package: ${entryRelative}`,
        );
      }
      files.push(
        ...(await collectFiles(
          path.join(directory, entry.name),
          entryRelative,
        )),
      );
    } else {
      files.push(entryRelative);
    }
  }
  return files;
}

const files = await collectFiles(root);
const violations = files.filter((relativeFile) => {
  const fileName = path.basename(relativeFile).toLowerCase();
  if (fileName.startsWith(".env")) return true;
  return (
    forbiddenFileNames.has(fileName) ||
    forbiddenFileExtensions.has(path.extname(fileName))
  );
});

if (violations.length) {
  throw new Error(
    `Deployment package contains forbidden sensitive files:\n${violations.join("\n")}`,
  );
}

for (const requiredFile of [
  "dist/public/index.html",
  "dist/server/index.js",
  "deploy/Caddyfile",
  "deploy/caddy-tenant-subdomains-available/tenant-subdomains.caddy",
  "deploy/caddy-tenant-subdomains.env.template",
  "deploy/caddy-tenant-subdomains.service.conf",
  "deploy/umbravia-forge.service",
  "deploy/umbravia-forge.env.template",
  "deploy/auto-update.sh",
  "deploy/check-locale-rollback-safety.mjs",
  "deploy/release-capabilities.json",
  "deploy/umbravia-forge-update.env.template",
  "deploy/umbravia-forge-update.service",
  "deploy/umbravia-forge-update.timer",
  "deploy/configure-mail.sh",
  "deploy/check-manager-connection-key.mjs",
]) {
  const platformPath = requiredFile.split("/").join(path.sep);
  if (!files.includes(platformPath)) {
    throw new Error(`Deployment package is incomplete: ${requiredFile}`);
  }
}

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

console.log(`Deployment package audit passed (${files.length} files).`);

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const operationalRoots = [".github/workflows", "deploy", "scripts"];
const forbiddenWrapperExtensions = new Set([".bat", ".cmd", ".ps1"]);
const platformExecutablePattern =
  /\b(?:node|npm|npx|tsc|tsx|vite|vitest)\.(?:bat|cmd|exe)\b/i;
const windowsAbsolutePathPattern = /(?:^|[\s"'=])(?:[a-z]:\\|\\\\[^\\])/im;

async function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativeEntry = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relativeEntry)));
    } else if (entry.isFile()) {
      files.push(relativeEntry);
    }
  }

  return files;
}

const operationalFiles = (
  await Promise.all(operationalRoots.map(collectFiles))
).flat();
const violations = [];

for (const relativeFile of operationalFiles) {
  const extension = path.extname(relativeFile).toLowerCase();
  if (forbiddenWrapperExtensions.has(extension)) {
    violations.push(
      `${relativeFile}: envoltorio operativo específico de Windows`,
    );
    continue;
  }

  const contents = await readFile(path.join(projectRoot, relativeFile), "utf8");
  if (platformExecutablePattern.test(contents)) {
    violations.push(
      `${relativeFile}: ejecutable con extensión específica del sistema`,
    );
  }
  if (windowsAbsolutePathPattern.test(contents)) {
    violations.push(`${relativeFile}: ruta absoluta específica de Windows`);
  }
}

const packageDocument = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
for (const [name, command] of Object.entries(packageDocument.scripts ?? {})) {
  if (
    typeof command === "string" &&
    (platformExecutablePattern.test(command) ||
      windowsAbsolutePathPattern.test(command))
  ) {
    violations.push(`package.json#scripts.${name}: comando no portable`);
  }
}

if (violations.length > 0) {
  console.error("El control de portabilidad encontró dependencias operativas:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Portabilidad operativa validada (${operationalFiles.length} archivos revisados).`,
);

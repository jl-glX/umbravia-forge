import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SourceHygieneAudit {
  inspectedFiles: number;
  findings: string[];
}

const SOURCE_ROOTS = ["client/src", "server", "scripts"];
const INSPECTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);
const OBSOLETE_SUFFIXES = [".bak", ".old", ".orig", ".tmp", "~"];
const SENSITIVE_ARTIFACT_NAMES = new Set([".env", ".env.local", ".npmrc"]);
const SENSITIVE_ARTIFACT_EXTENSIONS = new Set([
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
]);

function isSensitiveArtifact(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return (
    SENSITIVE_ARTIFACT_NAMES.has(name) ||
    name.startsWith(".env.") ||
    SENSITIVE_ARTIFACT_EXTENSIONS.has(path.extname(name))
  );
}

async function collectFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory()
          ? collectFiles(target)
          : Promise.resolve([target]);
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

export async function auditSourceHygiene(): Promise<SourceHygieneAudit> {
  const projectRoot = process.cwd();
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((root) => collectFiles(path.join(projectRoot, root))),
    )
  ).flat();
  const findings: string[] = [];
  const hashes = new Map<string, string>();
  let inspectedFiles = 0;

  for (const file of files) {
    if (isSensitiveArtifact(file)) continue;
    const relative = path.relative(projectRoot, file).replace(/\\/g, "/");
    if (OBSOLETE_SUFFIXES.some((suffix) => file.endsWith(suffix))) {
      findings.push(`Possible obsolete artifact: ${relative}`);
      continue;
    }
    if (!INSPECTED_EXTENSIONS.has(path.extname(file))) continue;
    inspectedFiles += 1;
    const metadata = await stat(file);
    if (metadata.size === 0) {
      findings.push(`Empty source file: ${relative}`);
      continue;
    }
    const digest = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    const duplicate = hashes.get(digest);
    if (duplicate)
      findings.push(`Exact duplicate: ${relative} matches ${duplicate}`);
    else hashes.set(digest, relative);
  }

  return { inspectedFiles, findings: findings.slice(0, 20) };
}

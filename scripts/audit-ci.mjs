import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluateNpmAuditReport,
  parseNpmAuditReport,
} from "./lib/npm-audit-policy.mjs";
import { resolveNpmInvocation } from "./lib/npm-invocation.mjs";

const temporaryExceptions = new Map([
  [
    "react-router",
    {
      advisories: new Set([
        "https://github.com/advisories/GHSA-qwww-vcr4-c8h2",
      ]),
      viaPackages: new Set(),
      versions: new Set(["7.18.2"]),
      reason:
        "La corrección está en react-router 8.3.0, pero react-router-dom todavía solo publica 7.18.2. Umbravia Forge usa BrowserRouter declarativo y no activa las API RSC inestables afectadas.",
    },
  ],
  [
    "react-router-dom",
    {
      advisories: new Set(),
      viaPackages: new Set(["react-router"]),
      versions: new Set(["7.18.2"]),
      reason:
        "Es la entrada derivada del mismo aviso RSC de react-router; no se permite ninguna otra cadena vulnerable.",
    },
  ],
]);

function runAudit(directory) {
  const invocation = resolveNpmInvocation(["audit", "--json"]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(process.cwd(), directory),
    env: process.env,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  return parseNpmAuditReport(result);
}

const projects = [
  { name: "raíz", directory: ".", exceptions: temporaryExceptions },
  { name: "Cloudflare", directory: "cloudflare", exceptions: new Map() },
];
for (const project of projects) {
  const report = runAudit(project.directory);
  const lockfile = JSON.parse(
    await readFile(resolve(project.directory, "package-lock.json"), "utf8"),
  );
  const { allowed, blocking } = evaluateNpmAuditReport({
    report,
    lockfile,
    temporaryExceptions: project.exceptions,
  });
  for (const exception of allowed) {
    console.warn(
      `Excepción temporal verificada para ${exception.name}@${exception.packageVersion}: ${exception.reason}`,
    );
  }
  if (blocking.length > 0) {
    console.error(
      JSON.stringify(
        { project: project.name, vulnerabilities: blocking },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  console.log(`Auditoría de dependencias superada para ${project.name}.`);
}

console.log(
  "Auditoría superada: no hay informes incompletos ni vulnerabilidades sin una excepción explícita y acotada.",
);

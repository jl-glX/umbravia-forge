import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

function runAudit() {
  const invocation = resolveNpmInvocation(["audit", "--json"]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (!result.stdout) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return JSON.parse(result.stdout);
}

function advisoryUrls(vulnerability) {
  return new Set(
    vulnerability.via
      .filter((entry) => typeof entry === "object" && entry !== null)
      .map((entry) => entry.url)
      .filter(Boolean),
  );
}

function vulnerableDependencies(vulnerability) {
  return new Set(
    vulnerability.via.filter((entry) => typeof entry === "string"),
  );
}

const report = runAudit();
const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const blocking = [];

for (const [name, vulnerability] of Object.entries(
  report.vulnerabilities ?? {},
)) {
  const exception = temporaryExceptions.get(name);
  const urls = advisoryUrls(vulnerability);
  const dependencies = vulnerableDependencies(vulnerability);
  const packageVersion = lockfile.packages?.[`node_modules/${name}`]?.version;
  const advisoriesMatch =
    urls.size > 0 &&
    dependencies.size === 0 &&
    [...urls].every((url) => exception?.advisories.has(url));
  const dependenciesMatch =
    dependencies.size > 0 &&
    urls.size === 0 &&
    [...dependencies].every((dependency) =>
      exception?.viaPackages.has(dependency),
    );
  const exceptionMatches =
    exception &&
    (advisoriesMatch || dependenciesMatch) &&
    exception.versions.has(packageVersion);

  if (exceptionMatches) {
    console.warn(
      `Excepción temporal verificada para ${name}@${packageVersion}: ${exception.reason}`,
    );
    continue;
  }

  blocking.push({ name, packageVersion, vulnerability });
}

if (blocking.length > 0) {
  console.error(JSON.stringify({ vulnerabilities: blocking }, null, 2));
  process.exit(1);
}

console.log(
  "Auditoría superada: no hay vulnerabilidades sin una excepción explícita y acotada.",
);

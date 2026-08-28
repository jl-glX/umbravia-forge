function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidVulnerabilityTotals(metadata) {
  if (!isRecord(metadata) || !isRecord(metadata.vulnerabilities)) return false;
  const totals = metadata.vulnerabilities;
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (
    ![...severities, "total"].every(
      (severity) =>
        Number.isInteger(totals[severity]) && Number(totals[severity]) >= 0,
    )
  )
    return false;
  return (
    severities.reduce((sum, severity) => sum + Number(totals[severity]), 0) ===
    totals.total
  );
}

export function parseNpmAuditReport({ stdout, stderr = "", status }) {
  if (status !== 0 && status !== 1) {
    throw new Error(
      `npm audit no pudo completar la consulta (salida ${String(status)}): ${stderr.trim() || "sin detalle"}`,
    );
  }
  if (!stdout.trim()) {
    throw new Error(
      `npm audit no devolvió un informe: ${stderr.trim() || "salida vacía"}`,
    );
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error("npm audit devolvió una respuesta que no es JSON válido");
  }
  if (
    !isRecord(report) ||
    "error" in report ||
    report.auditReportVersion !== 2 ||
    !isRecord(report.vulnerabilities) ||
    !hasValidVulnerabilityTotals(report.metadata)
  ) {
    throw new Error(
      "npm audit no devolvió un informe de vulnerabilidades completo y verificable",
    );
  }
  const total = Number(report.metadata.vulnerabilities.total);
  const vulnerabilityPackages = Object.keys(report.vulnerabilities).length;
  if (
    (status === 0 && total !== 0) ||
    (status === 1 && total === 0) ||
    total !== vulnerabilityPackages
  ) {
    throw new Error(
      "npm audit devolvió un estado incoherente con sus vulnerabilidades",
    );
  }
  return report;
}

export function evaluateNpmAuditReport({
  report,
  lockfile,
  temporaryExceptions = new Map(),
}) {
  const allowed = [];
  const blocking = [];
  const pendingDerived = new Map();
  const allowedNames = new Set();
  const sameSet = (left, right) =>
    left.size === right.size && [...left].every((value) => right.has(value));

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    const packageVersion = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (
      !isRecord(vulnerability) ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0
    ) {
      blocking.push({ name, packageVersion, vulnerability });
      continue;
    }

    const urls = new Set();
    const dependencies = new Set();
    let malformed = false;
    for (const entry of vulnerability.via) {
      if (typeof entry === "string" && entry.length > 0) {
        dependencies.add(entry);
      } else if (
        isRecord(entry) &&
        typeof entry.url === "string" &&
        entry.url.length > 0
      ) {
        urls.add(entry.url);
      } else {
        malformed = true;
      }
    }

    const exception = temporaryExceptions.get(name);
    if (
      malformed ||
      !exception ||
      !exception.versions.has(packageVersion) ||
      (urls.size > 0 && dependencies.size > 0)
    ) {
      blocking.push({ name, packageVersion, vulnerability });
      continue;
    }

    if (urls.size > 0) {
      if (sameSet(urls, exception.advisories)) {
        allowed.push({ name, packageVersion, reason: exception.reason });
        allowedNames.add(name);
      } else {
        blocking.push({ name, packageVersion, vulnerability });
      }
      continue;
    }

    if (dependencies.size > 0 && sameSet(dependencies, exception.viaPackages)) {
      pendingDerived.set(name, {
        dependencies,
        packageVersion,
        reason: exception.reason,
        vulnerability,
      });
    } else {
      blocking.push({ name, packageVersion, vulnerability });
    }
  }

  let changed = true;
  while (changed && pendingDerived.size > 0) {
    changed = false;
    for (const [name, candidate] of pendingDerived) {
      if (
        [...candidate.dependencies].every((dependency) =>
          allowedNames.has(dependency),
        )
      ) {
        allowed.push({
          name,
          packageVersion: candidate.packageVersion,
          reason: candidate.reason,
        });
        allowedNames.add(name);
        pendingDerived.delete(name);
        changed = true;
      }
    }
  }
  for (const [name, candidate] of pendingDerived) {
    blocking.push({
      name,
      packageVersion: candidate.packageVersion,
      vulnerability: candidate.vulnerability,
    });
  }
  return { allowed, blocking };
}

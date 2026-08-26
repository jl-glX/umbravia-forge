import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  formatSupportDiagnosticProbeReport,
  runSupportDiagnosticProbe,
  type SupportDiagnosticProbeCheck,
  type SupportDiagnosticProbeReport,
} from "../services/support-diagnostic-probe.js";

const supportedChecks = new Set<SupportDiagnosticProbeCheck>([
  "all",
  "dns",
  "tls",
  "live",
  "ready",
]);

const usage = [
  "Uso local Linux:",
  "  sh deploy/run-support-diagnostic-probe.sh [all|dns|tls|live|ready]",
  "El destino se fija mediante UMBRAVIA_DIAGNOSTIC_PROBE_ORIGIN o usa cf-test.umbraviaforge.com.",
].join("\n");

type ProbeRunner = (
  check: SupportDiagnosticProbeCheck,
) => Promise<SupportDiagnosticProbeReport>;

export function parseSupportDiagnosticProbeArguments(
  args: string[],
): SupportDiagnosticProbeCheck | "help" {
  if (args.length === 0) return "all";
  if (args.length !== 1) {
    throw new Error("El diagnostico acepta una sola comprobacion.");
  }
  const [candidate] = args;
  if (["help", "--help", "-h"].includes(candidate)) return "help";
  if (!supportedChecks.has(candidate as SupportDiagnosticProbeCheck)) {
    throw new Error(
      "Comprobacion no reconocida; use all, dns, tls, live o ready.",
    );
  }
  return candidate as SupportDiagnosticProbeCheck;
}

export async function executeSupportDiagnosticProbeCommand(
  args: string[],
  dependencies: {
    runProbe?: ProbeRunner;
    write?: (value: string) => void;
  } = {},
): Promise<number> {
  const check = parseSupportDiagnosticProbeArguments(args);
  const write = dependencies.write ?? console.log;
  if (check === "help") {
    write(usage);
    return 0;
  }
  const report = await (dependencies.runProbe ?? runSupportDiagnosticProbe)(
    check,
  );
  write(formatSupportDiagnosticProbeReport(report).join("\n"));
  return report.healthy ? 0 : 1;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  executeSupportDiagnosticProbeCommand(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

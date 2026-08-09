import { readFile } from "node:fs/promises";
import process from "node:process";
import { parse } from "dotenv";
import { assessMailDnsReadiness } from "../lib/mail-dns-readiness.js";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const envPath = argumentValue("--env");
  const fileEnvironment = envPath ? parse(await readFile(envPath, "utf8")) : {};
  const environment = { ...process.env, ...fileEnvironment };
  const smtpHost = environment.SMTP_HOST?.trim().toLowerCase();
  if (!smtpHost) throw new Error("SMTP_HOST no esta configurado.");
  if (!["127.0.0.1", "::1", "localhost"].includes(smtpHost)) {
    console.log(
      "INFO El transporte usa un relay SMTP externo; valide el DNS con ese proveedor.",
    );
    return;
  }

  const strict =
    process.argv.includes("--strict") ||
    environment.EMAIL_PUBLIC_DNS_CHECK?.toLowerCase() === "strict";
  const findings = await assessMailDnsReadiness({
    emailFrom: environment.EMAIL_FROM ?? "",
    expectedMailHost: environment.EMAIL_PUBLIC_MAIL_HOST,
    dkimSelector: environment.EMAIL_DKIM_SELECTOR,
    strictAuthentication: strict,
  });
  for (const finding of findings) {
    const prefix =
      finding.level === "pass"
        ? "OK"
        : finding.level === "warning"
          ? "WARN"
          : "ERR";
    const output = `${prefix} ${finding.code}: ${finding.message}`;
    if (finding.level === "error") console.error(output);
    else console.log(output);
  }
  if (findings.some((finding) => finding.level === "error")) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

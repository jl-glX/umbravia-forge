import { generateKeyPairSync } from "node:crypto";
import {
  constants,
  lstatSync,
  openSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { domainToASCII } from "node:url";

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    "Usage: node scripts/generate-dkim-replacement.mjs " +
      "--domain <domain> --selector <new-selector> --output-dir <existing-directory>\n",
  );
  process.exitCode = 2;
}

function argumentsByName(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      return null;
    }
    if (result.has(name)) return null;
    result.set(name, value);
  }
  return result;
}

function normalizedDnsName(value, label) {
  const normalized = domainToASCII(
    value.trim().toLowerCase().replace(/\.$/u, ""),
  );
  if (
    !normalized ||
    normalized.length > 253 ||
    normalized
      .split(".")
      .some(
        (part) =>
          !part ||
          part.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(part),
      )
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function ensureNewFile(filePath) {
  try {
    lstatSync(filePath);
    throw new Error(`Refusing to overwrite existing path: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function writeExclusive(filePath, value, mode) {
  const descriptor = openSync(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode,
  );
  try {
    writeFileSync(descriptor, value, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

const parsed = argumentsByName(process.argv.slice(2));
if (!parsed) {
  usage("Invalid or duplicated arguments");
} else {
  const domainValue = parsed.get("--domain");
  const selectorValue = parsed.get("--selector");
  const outputValue = parsed.get("--output-dir");
  if (!domainValue || !selectorValue || !outputValue || parsed.size !== 3) {
    usage(
      "Domain, a new selector and an existing output directory are required",
    );
  } else {
    try {
      const domain = normalizedDnsName(domainValue, "DKIM domain");
      const selector = normalizedDnsName(selectorValue, "DKIM selector");
      const outputDirectory = path.resolve(outputValue);
      const directoryStats = lstatSync(outputDirectory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        throw new Error("Output path must be an existing real directory");
      }

      const prefix = `${selector}.${domain}`;
      const privateKeyPath = path.join(
        outputDirectory,
        `${prefix}.private.pem`,
      );
      const publicKeyPath = path.join(outputDirectory, `${prefix}.public.pem`);
      const dnsRecordPath = path.join(outputDirectory, `${prefix}.dns.txt`);
      for (const filePath of [privateKeyPath, publicKeyPath, dnsRecordPath]) {
        ensureNewFile(filePath);
      }

      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const publicValue = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----/gu, "")
        .replace(/\s+/gu, "");
      const dnsName = `${selector}._domainkey.${domain}`;
      const dnsRecord = `${dnsName} IN TXT "v=DKIM1; k=rsa; p=${publicValue}"\n`;

      writeExclusive(privateKeyPath, privateKey, 0o600);
      writeExclusive(publicKeyPath, publicKey, 0o644);
      writeExclusive(dnsRecordPath, dnsRecord, 0o644);

      process.stdout.write(
        `${JSON.stringify({
          selector,
          domain,
          dnsName,
          privateKeyPath,
          publicKeyPath,
          dnsRecordPath,
        })}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "DKIM generation failed"}\n`,
      );
      process.exitCode = 1;
    }
  }
}

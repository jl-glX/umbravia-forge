import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCryptographicMaterialFamilies,
  getLocallyGeneratedReplacementFamilies,
} from "../server/services/cryptographic-material-replacement-manager.js";

interface DkimGenerationResult {
  selector: string;
  domain: string;
  dnsName: string;
  privateKeyPath: string;
  publicKeyPath: string;
  dnsRecordPath: string;
}

function usage(message?: string): void {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    "Usage: tsx scripts/generate-key-replacement-bundle.ts " +
      "--domain <dkim-domain> --selector <new-selector> " +
      "--rotation-id <unique-id> --output-dir <existing-directory>\n",
  );
  process.exitCode = 2;
}

function argumentsByName(values: string[]): Map<string, string> | null {
  if (values.length % 2 !== 0) return null;
  const result = new Map<string, string>();
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

function safeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(value)) {
    throw new Error(
      "Rotation id must use 3-64 lowercase letters, digits or hyphens",
    );
  }
  return value;
}

function writeExclusive(filePath: string, value: string, mode: number): void {
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
  const domain = parsed.get("--domain");
  const selector = parsed.get("--selector");
  const rotationIdValue = parsed.get("--rotation-id");
  const outputValue = parsed.get("--output-dir");
  if (
    !domain ||
    !selector ||
    !rotationIdValue ||
    !outputValue ||
    parsed.size !== 4
  ) {
    usage("All arguments are required");
  } else {
    try {
      const rotationId = safeId(rotationIdValue);
      const outputRoot = path.resolve(outputValue);
      const outputStats = lstatSync(outputRoot);
      if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
        throw new Error("Output path must be an existing real directory");
      }

      const bundleDirectory = path.join(
        outputRoot,
        `umbravia-key-rotation-${rotationId}`,
      );
      mkdirSync(bundleDirectory, { mode: 0o700 });

      const dkimGenerator = fileURLToPath(
        new URL("./generate-dkim-replacement.mjs", import.meta.url),
      );
      const dkimResult = JSON.parse(
        execFileSync(
          process.execPath,
          [
            dkimGenerator,
            "--domain",
            domain,
            "--selector",
            selector,
            "--output-dir",
            bundleDirectory,
          ],
          { encoding: "utf8" },
        ),
      ) as DkimGenerationResult;

      const generatedSecrets = [];
      for (const family of getLocallyGeneratedReplacementFamilies()) {
        if (!family.secretEnvironmentName) {
          throw new Error(
            `Local family ${family.id} does not define its destination`,
          );
        }
        const filePath = path.join(
          bundleDirectory,
          `${family.id.replaceAll("_", "-")}.secret`,
        );
        writeExclusive(
          filePath,
          `${randomBytes(32).toString("base64")}\n`,
          0o600,
        );
        generatedSecrets.push({
          id: family.id,
          destination: family.secretEnvironmentName,
          activation: family.activationStrategy,
          retirementPreconditions: [...family.retirementPreconditions],
          filePath,
        });
      }

      const externalFamilies = getCryptographicMaterialFamilies()
        .filter(
          (family) =>
            family.generation !== "local_supported" ||
            family.kind === "asymmetric_keypair",
        )
        .filter((family) => family.id !== "mail_dkim")
        .map((family) => ({
          id: family.id,
          generation: family.generation,
          activation: family.activationStrategy,
          retirementPreconditions: [...family.retirementPreconditions],
        }));

      const dkimFamily = getCryptographicMaterialFamilies().find(
        (family) => family.id === "mail_dkim",
      );
      if (!dkimFamily)
        throw new Error("DKIM material family is not registered");

      const manifest = {
        version: 2,
        role: "encryption_manager_auxiliary",
        rotationId,
        generatedAt: new Date().toISOString(),
        state: "prepared_not_activated",
        activationPolicy: "manual_per_family_after_verified_migration",
        dkim: {
          selector: dkimResult.selector,
          domain: dkimResult.domain,
          dnsName: dkimResult.dnsName,
          privateKeyPath: dkimResult.privateKeyPath,
          publicKeyPath: dkimResult.publicKeyPath,
          dnsRecordPath: dkimResult.dnsRecordPath,
          activation: dkimFamily.activationStrategy,
          retirementPreconditions: [...dkimFamily.retirementPreconditions],
        },
        localSecrets: generatedSecrets,
        externalFamilies,
        policy: {
          automaticActivation: false,
          automaticRetirement: false,
          overwritesExistingMaterial: false,
          printsSecretValues: false,
        },
        warning:
          "Generation does not recover data encrypted with a lost key and does not activate replacements.",
      };
      const manifestPath = path.join(bundleDirectory, "rotation-manifest.json");
      writeExclusive(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        0o600,
      );

      process.stdout.write(
        `${JSON.stringify({ bundleDirectory, manifestPath, rotationId })}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Key bundle generation failed"}\n`,
      );
      process.exitCode = 1;
    }
  }
}

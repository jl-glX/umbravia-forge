import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

describe("integral replacement key bundle", () => {
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("generates distinct local replacements and a non-activating rotation manifest", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "umbravia-key-bundle-"),
    );
    directories.push(directory);
    const result = await execFileAsync(process.execPath, [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("scripts/generate-key-replacement-bundle.ts"),
      "--domain",
      "example.test",
      "--selector",
      "mail-20260815",
      "--rotation-id",
      "recovery-20260815",
      "--output-dir",
      directory,
    ]);
    const output = JSON.parse(result.stdout) as { manifestPath: string };
    const manifest = JSON.parse(
      await readFile(output.manifestPath, "utf8"),
    ) as {
      activationPolicy: string;
      role: string;
      state: string;
      localSecrets: Array<{
        id: string;
        destination: string;
        filePath: string;
        activation: string;
      }>;
      externalFamilies: Array<{ id: string; generation: string }>;
      warning: string;
    };
    const values = await Promise.all(
      manifest.localSecrets.map(async (entry) => ({
        ...entry,
        value: (await readFile(entry.filePath, "utf8")).trim(),
      })),
    );

    expect(manifest.activationPolicy).toBe(
      "manual_per_family_after_verified_migration",
    );
    expect(manifest).toMatchObject({
      role: "encryption_manager_auxiliary",
      state: "prepared_not_activated",
    });
    expect(values.map((entry) => entry.destination)).toEqual(
      expect.arrayContaining([
        "EMAIL_QUEUE_ENCRYPTION_KEY",
        "MANAGER_CONNECTION_ENCRYPTION_KEY",
        "MFA_ENCRYPTION_KEY",
        "PRIVATE_CONTENT_ENCRYPTION_KEY",
        "SUPPORT_EMAIL_REPLY_TOKEN_KEY",
        "SUPPORT_EMAIL_WEBHOOK_SECRET",
      ]),
    );
    expect(
      values.every((entry) => Buffer.from(entry.value, "base64").length === 32),
    ).toBe(true);
    expect(new Set(values.map((entry) => entry.value)).size).toBe(
      values.length,
    );
    expect(manifest.externalFamilies.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "turnstile",
        "transport_tls",
        "encrypted_backups",
        "user_authenticators",
      ]),
    );
    expect(manifest.warning).toMatch(/does not recover data/u);
    expect(result.stdout).not.toContain(values[0]?.value);
  });

  it("refuses to reuse an existing rotation id", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "umbravia-key-bundle-collision-"),
    );
    directories.push(directory);
    const argumentsList = [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("scripts/generate-key-replacement-bundle.ts"),
      "--domain",
      "example.test",
      "--selector",
      "mail-rotation",
      "--rotation-id",
      "collision-test",
      "--output-dir",
      directory,
    ];
    await execFileAsync(process.execPath, argumentsList);

    await expect(
      execFileAsync(process.execPath, argumentsList),
    ).rejects.toBeDefined();
  });
});

import { createPrivateKey, createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

describe("DKIM replacement key generator", () => {
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("creates a new 2048-bit pair and public DNS record without printing the private key", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "umbravia-dkim-replacement-"),
    );
    directories.push(directory);
    const result = await execFileAsync(process.execPath, [
      path.resolve("scripts/generate-dkim-replacement.mjs"),
      "--domain",
      "example.test",
      "--selector",
      "mail-20260815",
      "--output-dir",
      directory,
    ]);
    const output = JSON.parse(result.stdout) as {
      privateKeyPath: string;
      publicKeyPath: string;
      dnsRecordPath: string;
    };
    const [privateKey, publicKey, dnsRecord] = await Promise.all([
      readFile(output.privateKeyPath, "utf8"),
      readFile(output.publicKeyPath, "utf8"),
      readFile(output.dnsRecordPath, "utf8"),
    ]);

    expect(
      createPrivateKey(privateKey).asymmetricKeyDetails?.modulusLength,
    ).toBe(2048);
    expect(
      createPublicKey(privateKey).export({ type: "spki", format: "pem" }),
    ).toBe(publicKey);
    expect(dnsRecord).toMatch(
      /^mail-20260815\._domainkey\.example\.test IN TXT "v=DKIM1; k=rsa; p=/u,
    );
    expect(result.stdout).not.toContain("PRIVATE KEY");
  });

  it("refuses to overwrite an existing selector", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "umbravia-dkim-collision-"),
    );
    directories.push(directory);
    const argumentsList = [
      path.resolve("scripts/generate-dkim-replacement.mjs"),
      "--domain",
      "example.test",
      "--selector",
      "mail-rotation",
      "--output-dir",
      directory,
    ];
    await execFileAsync(process.execPath, argumentsList);

    await expect(
      execFileAsync(process.execPath, argumentsList),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/Refusing to overwrite/u),
    });
  });
});

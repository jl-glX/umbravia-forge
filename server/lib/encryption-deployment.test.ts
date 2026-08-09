import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("server encryption deployment", () => {
  it("streams PostgreSQL backups directly into authenticated encryption", () => {
    const script = read("deploy/backup-postgresql-encrypted.sh");

    expect(script).toContain('export PGDATABASE="$DATABASE_URL"');
    expect(script).toMatch(/pg_dump[\s\S]+\|[\s\\]+age --recipient/);
    expect(script).not.toContain('--dbname="$DATABASE_URL"');
    expect(script).not.toMatch(/>[^\n]+\.dump(?:\s|$)/);
    expect(script).toContain("sha256sum");
    expect(script).toContain("flock -n");
  });

  it("keeps the decryption identity outside the production backup service", () => {
    const service = read("deploy/umbravia-forge-backup.service");
    const environmentTemplate = read("deploy/umbravia-forge.env.template");

    expect(service).toContain("UMask=0077");
    expect(service).toContain("ProtectSystem=strict");
    expect(service).toContain(
      "ReadWritePaths=/var/backups/umbravia-forge/postgresql",
    );
    expect(service).not.toMatch(
      /UMBRAVIA_BACKUP_AGE_IDENTITY|VERACRYPT_(?:PASSWORD|KEYFILE)/,
    );
    expect(environmentTemplate).toContain("UMBRAVIA_BACKUP_AGE_RECIPIENT=");
    expect(environmentTemplate).not.toContain("UMBRAVIA_BACKUP_AGE_IDENTITY");
  });

  it("schedules persistent backups and validates them independently", () => {
    const timer = read("deploy/umbravia-forge-backup.timer");
    const verifier = read("deploy/verify-encrypted-backup.sh");
    const readiness = read("deploy/check-encryption-readiness.sh");

    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("RandomizedDelaySec=30m");
    expect(verifier).toMatch(/age --decrypt[\s\S]+\| pg_restore --list/);
    expect(readiness).toContain("UMBRAVIA_BACKUP_AGE_RECIPIENT");
    expect(readiness).toContain("posible copia sin cifrar");
  });

  it("recognizes the requested VeraCrypt storage cascades without handling keys", () => {
    const readiness = read("deploy/check-encryption-readiness.sh");
    const environmentTemplate = read("deploy/umbravia-forge.env.template");

    expect(readiness).toContain("veracrypt-aes-twofish-serpent");
    expect(readiness).toContain("AES-Twofish-Serpent");
    expect(readiness).toContain("veracrypt-aes-twofish");
    expect(readiness).toContain("AES-Twofish");
    expect(environmentTemplate).not.toMatch(/VERACRYPT_(?:PASSWORD|KEYFILE)=/);
  });
});

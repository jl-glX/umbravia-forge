import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("systemd deployment service", () => {
  it("approves the reviewed native install scripts used in production", async () => {
    const [packageSource, npmConfig] = await Promise.all([
      readFile(path.resolve("package.json"), "utf8"),
      readFile(path.resolve(".npmrc"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      allowScripts?: Record<string, boolean>;
      engines?: Record<string, string>;
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("npm@11.18.0");
    expect(packageJson.engines?.npm).toBe(">=11.18.0 <12");
    expect(npmConfig).toContain("strict-allow-scripts=true");
    expect(packageJson.allowScripts).toMatchObject({
      "argon2@0.45.1": true,
      "better-sqlite3@13.0.3": true,
      "esbuild@0.28.1": true,
    });
    expect(Object.keys(packageJson.allowScripts ?? {})).toEqual(
      expect.arrayContaining([
        "argon2@0.45.1",
        "better-sqlite3@13.0.3",
        "esbuild@0.28.1",
      ]),
    );
    expect(
      Object.keys(packageJson.allowScripts ?? {}).every((entry) =>
        /@\d/u.test(entry),
      ),
    ).toBe(true);
  });

  it("resolves Node portably instead of fixing a server-specific path", async () => {
    const unit = await readFile(
      path.resolve("deploy", "umbravia-forge.service"),
      "utf8",
    );

    expect(unit).toContain("Environment=PATH=/usr/local/bin:/usr/bin:/bin");
    expect(unit).toContain(
      "ExecStart=/usr/bin/env node scripts/start-production.mjs",
    );
    expect(unit).not.toMatch(
      /^ExecStart=\/(?:usr\/local\/bin|usr\/bin)\/node\b/m,
    );
  });

  it("validates Caddy without taking ownership of its production log", async () => {
    const [caddyfile, readiness] = await Promise.all([
      readFile(path.resolve("deploy", "Caddyfile"), "utf8"),
      readFile(path.resolve("deploy", "check-linux-readiness.sh"), "utf8"),
    ]);

    expect(caddyfile).toContain(
      "{$UMBRAVIA_CADDY_LOG:/var/log/caddy/umbravia-forge-access.log}",
    );
    expect(caddyfile).toContain("protocols tls1.3");
    expect(readiness).toContain("CADDY_VALIDATION_LOG=$(mktemp");
    expect(readiness).toContain(
      "CADDY_VALIDATION_HOME=${HOME:-${TMPDIR:-/tmp}}",
    );
    expect(readiness).toContain('HOME="$CADDY_VALIDATION_HOME"');
    expect(readiness).toContain('XDG_CONFIG_HOME="$CADDY_VALIDATION_XDG_HOME"');
    expect(readiness).toContain('UMBRAVIA_CADDY_LOG="$CADDY_VALIDATION_LOG"');
    expect(readiness).toContain('rm -f "$CADDY_VALIDATION_LOG"');
    expect(readiness).toContain("TURNSTILE_SECRET_KEY");
    expect(readiness).toContain("EMAIL_QUEUE_ENCRYPTION_KEY");
    expect(readiness).toContain(
      "EMAIL_VERIFICATION_ENABLED debe ser true en produccion",
    );
    expect(readiness).toContain(
      "for REQUIRED_ENV in EMAIL_FROM EMAIL_QUEUE_ENCRYPTION_KEY",
    );
    expect(readiness).toContain(
      "EMAIL_DIRECT_HELO_NAME EMAIL_DKIM_DOMAIN EMAIL_DKIM_SELECTOR EMAIL_DKIM_PRIVATE_KEY_PATH",
    );
    expect(readiness).toContain(
      "EMAIL_DKIM_PRIVATE_KEY_PATH no apunta a un archivo regular disponible",
    );
    expect(readiness).toContain("EMAIL_VERIFICATION_ENABLED=true");
    expect(readiness).toContain("ausente para la verificacion de correo");
    expect(readiness).toContain(
      "SMTP_USER y SMTP_PASSWORD deben configurarse juntos",
    );
    expect(readiness).toContain("dist/server/bin/check-mail-dns.js");
    expect(readiness).toContain("EMAIL_PUBLIC_DNS_CHECK=strict");
    expect(readiness).toContain("DNS publico del MTA local incompleto");
    expect(readiness).toContain(
      'require_file "$PROJECT_ROOT/node_modules/@noble/ciphers/package.json"',
    );
    expect(readiness).toContain("runtime criptografico completo operativo");
    expect(readiness).toContain("CRYPTO_RUNTIME_OUTPUT");
    expect(readiness).toContain("check-crypto-runtime.mjs");
    expect(readiness).toContain("check-private-content-key.mjs");
    expect(readiness).toContain("check-manager-connection-key.mjs");
    expect(readiness).toContain("host publico del MTA aun no configurado");
    expect(readiness).toContain(
      "EMAIL_PUBLIC_MAIL_HOST es obligatorio en el modo DNS estricto",
    );
  });

  it("keeps portable authenticated private-content encryption in the production package", async () => {
    const [packageSource, checker] = await Promise.all([
      readFile(path.resolve("package.json"), "utf8"),
      readFile(path.resolve("deploy", "check-private-content-key.mjs"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@noble/ciphers"]).toBe("2.3.0");
    expect(checker).toContain("createCipheriv");
    expect(checker).toContain('createCipheriv("aes-256-gcm"');
    expect(checker).toContain("authTagLength: 16");
    expect(checker).toContain("key.length !== 32");
    expect(checker).not.toMatch(/console\.log\([^)]*(?:encoded|key)/u);
  });

  it("exercises reviewed cryptography before activating a Linux release", async () => {
    const [updater, readiness] = await Promise.all([
      readFile(path.resolve("deploy", "auto-update.sh"), "utf8"),
      readFile(path.resolve("deploy", "check-linux-readiness.sh"), "utf8"),
    ]);

    expect(updater).toContain("npm rebuild argon2 --foreground-scripts");
    expect(updater).toContain('HOME="$home_dir"');
    expect(updater).toContain('XDG_CONFIG_HOME="$home_dir/.config"');
    expect(updater).toContain("for command_name in cut curl env flock getent");
    expect(updater).toContain('version_at_least "$npm_version" "11.18.0"');
    expect(updater).toContain(
      'require_supported_runtime_for_user "$UMBRAVIA_BUILD_USER"',
    );
    expect(updater).toContain(
      'require_supported_runtime_for_user "$UMBRAVIA_APP_USER"',
    );
    expect(readiness).toContain('version_at_least "$NPM_VERSION" "11.18.0"');
    const runtimeChecker = await readFile(
      path.resolve("deploy", "check-crypto-runtime.mjs"),
      "utf8",
    );
    expect(runtimeChecker).toContain("argon2Hash");
    expect(runtimeChecker).toContain("argon2Verify");
    expect(runtimeChecker).toContain("xchacha20poly1305");
    expect(runtimeChecker).toContain('createCipheriv("aes-256-gcm"');
    expect(runtimeChecker).toContain('createHash("sha256"');
    expect(runtimeChecker).toContain("scryptSync");

    const unrelatedDirectory = await mkdtemp(
      path.join(tmpdir(), "umbravia-crypto-runtime-cwd-"),
    );
    try {
      const executed = await execFileAsync(
        process.execPath,
        [path.resolve("deploy", "check-crypto-runtime.mjs")],
        { cwd: unrelatedDirectory },
      );
      expect(executed.stdout).toBe("");
      expect(executed.stderr).toBe("");
    } finally {
      await rm(unrelatedDirectory, { recursive: true, force: true });
    }
  });

  it("checks the private-content key without printing it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "umbravia-key-check-"));
    const envFile = path.join(directory, "production.env");
    const key = Buffer.alloc(32, 17).toString("base64url");
    try {
      await writeFile(
        envFile,
        `PRIVATE_CONTENT_ENCRYPTION_ENABLED=true\nPRIVATE_CONTENT_ENCRYPTION_KEY=${key}\n`,
        { mode: 0o600 },
      );
      const result = await execFileAsync(process.execPath, [
        path.resolve("deploy", "check-private-content-key.mjs"),
        envFile,
      ]);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const nextKey = Buffer.alloc(32, 18).toString("base64url");
      await writeFile(
        envFile,
        [
          "PRIVATE_CONTENT_ENCRYPTION_ENABLED=true",
          `PRIVATE_CONTENT_ENCRYPTION_KEY=${key}`,
          `PRIVATE_CONTENT_ENCRYPTION_KEYRING=current:${key},next:${nextKey}`,
          "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID=next",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const rotatedResult = await execFileAsync(process.execPath, [
        path.resolve("deploy", "check-private-content-key.mjs"),
        envFile,
      ]);
      expect(rotatedResult.stdout).toBe("");
      expect(rotatedResult.stderr).toBe("");

      await writeFile(
        envFile,
        [
          "PRIVATE_CONTENT_ENCRYPTION_ENABLED=true",
          `PRIVATE_CONTENT_ENCRYPTION_KEYRING=legacy:${key}`,
          "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID=legacy",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      await expect(
        execFileAsync(process.execPath, [
          path.resolve("deploy", "check-private-content-key.mjs"),
          envFile,
        ]),
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(
        envFile,
        [
          "PRIVATE_CONTENT_ENCRYPTION_ENABLED=true",
          `PRIVATE_CONTENT_ENCRYPTION_KEYRING=current:${key},duplicate:${key}`,
          "PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID=current",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      await expect(
        execFileAsync(process.execPath, [
          path.resolve("deploy", "check-private-content-key.mjs"),
          envFile,
        ]),
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(
        envFile,
        "PRIVATE_CONTENT_ENCRYPTION_ENABLED=true\nPRIVATE_CONTENT_ENCRYPTION_KEY=invalid\n",
        { mode: 0o600 },
      );
      await expect(
        execFileAsync(process.execPath, [
          path.resolve("deploy", "check-private-content-key.mjs"),
          envFile,
        ]),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("checks the manager-connection key before activating a release", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "umbravia-manager-key-check-"),
    );
    const envFile = path.join(directory, "production.env");
    const key = Buffer.alloc(32, 23).toString("base64");
    const nextKey = Buffer.alloc(32, 24).toString("base64");
    try {
      await writeFile(envFile, `MANAGER_CONNECTION_ENCRYPTION_KEY=${key}\n`, {
        mode: 0o600,
      });
      const result = await execFileAsync(process.execPath, [
        path.resolve("deploy", "check-manager-connection-key.mjs"),
        envFile,
      ]);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      await writeFile(
        envFile,
        [
          `MANAGER_CONNECTION_ENCRYPTION_KEYRING=current:${key},next:${nextKey}`,
          "MANAGER_CONNECTION_ENCRYPTION_ACTIVE_KEY_ID=next",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const rotatedResult = await execFileAsync(process.execPath, [
        path.resolve("deploy", "check-manager-connection-key.mjs"),
        envFile,
      ]);
      expect(rotatedResult.stdout).toBe("");
      expect(rotatedResult.stderr).toBe("");

      await writeFile(envFile, "MANAGER_CONNECTION_ENCRYPTION_KEY=invalid\n", {
        mode: 0o600,
      });
      await expect(
        execFileAsync(process.execPath, [
          path.resolve("deploy", "check-manager-connection-key.mjs"),
          envFile,
        ]),
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(envFile, "", { mode: 0o600 });
      await expect(
        execFileAsync(process.execPath, [
          path.resolve("deploy", "check-manager-connection-key.mjs"),
          envFile,
        ]),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps persistent security environment files outside release cleanup", async () => {
    const [updater, disableUpdates] = await Promise.all([
      readFile(path.resolve("deploy", "auto-update.sh"), "utf8"),
      readFile(path.resolve("deploy", "disable-automatic-updates.sh"), "utf8"),
    ]);

    for (const script of [updater, disableUpdates]) {
      expect(script).not.toMatch(
        /rm\s+(?:-[^\s]+\s+)*[^\n]*(?:update\.env|umbravia-forge\.env)/,
      );
    }
    expect(updater).toContain(
      "UMBRAVIA_APP_ENV_FILE:=/etc/umbravia-forge/umbravia-forge.env",
    );
  });

  it("prepares mail without exposing SMTP or replacing existing security state", async () => {
    const installer = await readFile(
      path.resolve("deploy", "configure-mail.sh"),
      "utf8",
    );

    expect(installer).toContain("ACTION=${1:-plan}");
    expect(installer).toContain("inet_interfaces = loopback-only");
    expect(installer).toContain("inet_protocols = ipv4");
    expect(installer).toContain("smtp_address_preference = ipv4");
    expect(installer).toContain("maximal_queue_lifetime = 1d");
    expect(installer).toContain("bounce_queue_lifetime = 1d");
    expect(installer).toContain("minimal_backoff_time = 5m");
    expect(installer).toContain("maximal_backoff_time = 1h");
    expect(installer).toContain("127.0.0.1:8891");
    expect(installer).toContain("se rechaza pisar una configuracion ajena");
    expect(installer).toContain("systemctl disable --now opendkim.service");
    expect(installer).toContain("Clave DKIM existente conservada");
    expect(installer).toContain(
      "CONFIG_ROOT=${UMBRAVIA_MAIL_CONFIG_ROOT:-/etc/umbravia-forge-mail}",
    );
    expect(installer).toContain(
      "LEGACY_CONFIG_ROOT=${UMBRAVIA_MAIL_LEGACY_CONFIG_ROOT:-/etc/umbravia-forge/mail}",
    );
    expect(installer).toContain("Clave DKIM heredada conservada y copiada");
    expect(installer).not.toMatch(/rm[^\n]+LEGACY_CONFIG_ROOT/);
    expect(installer).toContain("No publicar todavia:");
    expect(installer).not.toMatch(/ufw\s+allow\s+25/);
    expect(installer).not.toMatch(/firewall-cmd[^\n]+smtp/);
    expect(installer).not.toMatch(
      /cat\s+[^\n]*\$KEY_ROOT\/\$DKIM_SELECTOR\.private/,
    );
    expect(installer).not.toMatch(
      /rm\s+(?:-[^\s]+\s+)*[^\n]*(?:umbravia-forge\.env|update\.env)/,
    );
  });

  it("cleans only incomplete, inactive releases and preserves rollback targets", async () => {
    const updater = await readFile(
      path.resolve("deploy", "auto-update.sh"),
      "utf8",
    );

    expect(updater).toContain("release_is_complete()");
    expect(updater).toContain('[ -f "$candidate/.umbravia-release-complete" ]');
    expect(updater).toContain('[ "$candidate" != "$current_target" ]');
    expect(updater).toContain('[ "$candidate" != "$previous_target" ]');
    expect(updater).toContain(
      'remove_incomplete_release "$release_dir" "actualizacion no activada"',
    );
    expect(updater).toContain("release_activated=0");
    expect(updater).toContain("release_activated=1");
    expect(updater).toContain('rm -rf -- "$build_root"');
    expect(updater).toContain("cleanup_stale_builds");
    expect(updater).toContain('rm -f -- "$next_link"');
    expect(updater).toContain("worktree prune");
    expect(updater).toContain("trap cleanup EXIT");
    expect(updater).toContain("trap 'exit 1' HUP INT TERM");
    expect(updater).toContain('chmod -R u+rwX,g+rX,o-rwx "$release_dir"');
    expect(updater).toContain("restart_app_service()");
    expect(updater).toContain('systemctl reset-failed "$UMBRAVIA_APP_SERVICE"');
    expect(updater.match(/restart_app_service/g)).toHaveLength(4);
  });

  it("covers npm, readiness and health failures with the expected cleanup state", async () => {
    const updater = await readFile(
      path.resolve("deploy", "auto-update.sh"),
      "utf8",
    );
    const buildNpmCi = updater.indexOf("npm ci --audit=false");
    const releaseCreated = updater.indexOf("release_created=1");
    const releaseNpmCi = updater.indexOf("npm ci --omit=dev");
    const readiness = updater.indexOf(
      'UMBRAVIA_ENV_FILE="$UMBRAVIA_APP_ENV_FILE"',
    );
    const activated = updater.indexOf("release_activated=1");
    const healthFailure = updater.indexOf(
      '! health_check "$UMBRAVIA_LOCAL_HEALTH_URL"',
    );
    const rollbackCleanup = updater.indexOf("release_activated=0", activated);

    expect(buildNpmCi).toBeGreaterThan(-1);
    expect(buildNpmCi).toBeLessThan(releaseCreated);
    expect(releaseNpmCi).toBeGreaterThan(releaseCreated);
    expect(readiness).toBeGreaterThan(releaseNpmCi);
    expect(readiness).toBeLessThan(activated);
    expect(healthFailure).toBeGreaterThan(activated);
    expect(rollbackCleanup).toBeGreaterThan(healthFailure);
  });
});

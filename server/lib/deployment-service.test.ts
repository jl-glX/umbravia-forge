import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./supported-locales.js";

const execFileAsync = promisify(execFile);

describe("systemd deployment service", () => {
  it.skipIf(process.platform === "win32")(
    "keeps the diagnostic Caddy tools valid POSIX shell",
    async () => {
      for (const script of [
        "manage-caddy-diagnostics.sh",
        "run-support-diagnostic-probe.sh",
      ]) {
        const result = await execFileAsync("sh", [
          "-n",
          path.resolve("deploy", script),
        ]);

        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
    },
  );

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

  it("enforces the independent Cloudflare native-script allowlist", async () => {
    const [packageSource, npmConfig] = await Promise.all([
      readFile(path.resolve("cloudflare", "package.json"), "utf8"),
      readFile(path.resolve("cloudflare", ".npmrc"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      allowScripts?: Record<string, boolean>;
      engines?: Record<string, string>;
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("npm@11.18.0");
    expect(packageJson.engines).toEqual({
      node: ">=24.15.0 <25",
      npm: ">=11.18.0 <12",
    });
    expect(npmConfig).toContain("engine-strict=true");
    expect(npmConfig).toContain("strict-allow-scripts=true");
    expect(packageJson.allowScripts).toEqual({
      "esbuild@0.28.1": true,
      "workerd@1.20260820.1": true,
    });
  });

  it("enforces native-script policy and a writable cache in the updater", async () => {
    const [updater, updateUnit, packageAudit] = await Promise.all([
      readFile(path.resolve("deploy", "auto-update.sh"), "utf8"),
      readFile(path.resolve("deploy", "umbravia-forge-update.service"), "utf8"),
      readFile(path.resolve("scripts", "audit-deployment-package.mjs"), "utf8"),
    ]);

    expect(updater).toContain(
      "npm ci --audit=false --fund=false --strict-allow-scripts=true",
    );
    expect(updater).toContain(
      'npm ci --omit=dev --audit=false --fund=false --strict-allow-scripts=true --cache "$2"',
    );
    expect(updater).toContain(
      'npm rebuild argon2 --foreground-scripts --strict-allow-scripts=true --cache "$2"',
    );
    expect(updater).toContain(
      "app_npm_cache=/var/lib/umbravia-forge-updater/npm-cache-app",
    );
    expect(updater).toContain(
      'install -d -o "$UMBRAVIA_APP_USER" -g "$UMBRAVIA_APP_GROUP" -m 0700 "$app_npm_cache"',
    );
    expect(updateUnit).toContain(
      "ReadWritePaths=/opt/umbravia-forge /var/lib/umbravia-forge-updater /run/lock",
    );
    expect(packageAudit).toContain('".npmrc"');
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
    const [caddyfile, readiness, diagnosticManager, diagnosticRunner] =
      await Promise.all([
        readFile(path.resolve("deploy", "Caddyfile"), "utf8"),
        readFile(path.resolve("deploy", "check-linux-readiness.sh"), "utf8"),
        readFile(path.resolve("deploy", "manage-caddy-diagnostics.sh"), "utf8"),
        readFile(
          path.resolve("deploy", "run-support-diagnostic-probe.sh"),
          "utf8",
        ),
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
    expect(readiness).toContain(
      "dist/server/bin/check-support-diagnostic-probe.js",
    );
    expect(readiness).toContain("run-support-diagnostic-probe.sh");
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
    expect(diagnosticManager).toContain("validate_config()");
    expect(diagnosticManager).toContain(
      'UMBRAVIA_DIAGNOSTIC_LOG="$validation_log"',
    );
    expect(diagnosticManager).toContain(
      "PROBE_LOG=${UMBRAVIA_DIAGNOSTIC_RUNTIME_LOG:-/var/log/caddy/umbravia-diagnostic-access.log}",
    );
    expect(diagnosticManager).toContain(
      'systemctl show "$CADDY_SERVICE" --property=User --value',
    );
    expect(diagnosticManager).toContain(
      'systemctl show "$CADDY_SERVICE" --property=Group --value',
    );
    expect(diagnosticManager).toContain(
      'chown "$caddy_user:$caddy_group" "$PROBE_LOG"',
    );
    expect(diagnosticManager).toContain('chmod 0640 "$PROBE_LOG"');
    expect(diagnosticManager).not.toMatch(
      /^\s*caddy validate --config "\$CONFIG_PATH"/m,
    );
    expect(diagnosticRunner).toContain(
      "dist/server/bin/check-support-diagnostic-probe.js",
    );
    expect(diagnosticRunner).not.toContain("ufctl");
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
    expect(disableUpdates).toContain(
      "systemctl disable --now umbravia-forge-update.timer",
    );
    expect(disableUpdates).toContain(
      "systemctl is-active --quiet umbravia-forge-update.service",
    );
    expect(disableUpdates).toContain('exec 9>"$UPDATE_LOCK"');
    expect(disableUpdates).toContain("flock -n 9");
    expect(disableUpdates).not.toContain(
      "systemctl stop umbravia-forge-update.service",
    );
    expect(disableUpdates).not.toContain(
      'rm -f -- "$UPDATE_SERVICE" "$UPDATE_TIMER" "$UPDATE_LOCK"',
    );
    expect(disableUpdates).not.toMatch(
      /\bumbravia-update\.(?:service|timer)\b/u,
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
    expect(updater.match(/restart_app_service/g)).toHaveLength(3);
  });

  it("keeps rollback recovery ordered, read-only and recoverable", async () => {
    const updater = await readFile(
      path.resolve("deploy", "auto-update.sh"),
      "utf8",
    );
    const recoveryStart = updater.indexOf("recover_previous_release() {");
    const recoveryEnd = updater.indexOf(
      "\n}\n\nrelease_is_complete()",
      recoveryStart,
    );
    const recovery = updater.slice(recoveryStart, recoveryEnd);
    const switchStart = updater.indexOf("switch_current_release() {");
    const switchEnd = updater.indexOf(
      "\n}\n\nrun_locale_rollback_preflight()",
      switchStart,
    );
    const switchFunction = updater.slice(switchStart, switchEnd);
    const stopStart = updater.indexOf("stop_app_service() {");
    const stopEnd = updater.indexOf("\n}\n\nfail()", stopStart);
    const stopFunction = updater.slice(stopStart, stopEnd);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recovery).toContain("release_preserved=1");
    expect(recovery).not.toContain("release_preserved=0");
    expect(recovery).toContain("stop_app_service ||");
    expect(recovery).toContain(
      'run_locale_rollback_preflight "$release_dir" "$current_target"',
    );
    expect(recovery.indexOf("stop_app_service ||")).toBeLessThan(
      recovery.indexOf("run_locale_rollback_preflight"),
    );
    expect(recovery.indexOf("run_locale_rollback_preflight")).toBeLessThan(
      recovery.indexOf('switch_current_release "$current_target"'),
    );
    expect(
      recovery.indexOf('switch_current_release "$current_target"'),
    ).toBeLessThan(recovery.indexOf("restart_app_service"));
    expect(recovery).not.toContain("restart_app_service || true");
    expect(switchFunction.match(/\|\| return 1/g)).toHaveLength(3);
    expect(stopFunction).toContain(
      'systemctl show "$UMBRAVIA_APP_SERVICE" --property=ActiveState --value',
    );
    expect(stopFunction).toContain('[ "$active_state" = "inactive" ]');
  });

  it("packages a locale capability marker and a secret-free rollback preflight", async () => {
    const [
      audit,
      prepare,
      markerSource,
      preflight,
      environmentTemplate,
      deploymentReadme,
    ] = await Promise.all([
      readFile(path.resolve("scripts", "audit-deployment-package.mjs"), "utf8"),
      readFile(
        path.resolve("scripts", "prepare-deployment-package.mjs"),
        "utf8",
      ),
      readFile(path.resolve("deploy", "release-capabilities.json"), "utf8"),
      readFile(
        path.resolve("deploy", "check-locale-rollback-safety.mjs"),
        "utf8",
      ),
      readFile(path.resolve("deploy", "umbravia-forge.env.template"), "utf8"),
      readFile(path.resolve("deploy", "README.md"), "utf8"),
    ]);
    const marker = JSON.parse(markerSource) as {
      schemaVersion: number;
      supportedLocales: string[];
    };

    expect(marker).toEqual({
      schemaVersion: 1,
      supportedLocales: [...SUPPORTED_LOCALES],
    });
    for (const source of [audit, prepare]) {
      expect(source).toContain("release-capabilities.json");
    }
    expect(audit).toContain("check-locale-rollback-safety.mjs");
    expect(preflight).toContain("readonly: true");
    expect(preflight).toContain('database.pragma("query_only = ON")');
    expect(preflight).toContain(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(preflight).toContain(
      'SELECT locale, COUNT(*)::int AS count FROM "${table}" GROUP BY locale',
    );
    expect(preflight).not.toContain("payloadEncrypted");
    expect(preflight).toContain('"da5466706a0026f018f8b211b352c793eb7a1cfd"');
    expect(preflight).toContain('"--legacy-target-commit"');
    expect(preflight).toContain("LEGACY_TARGET_CAPABILITIES_PRESENT");
    const updater = await readFile(
      path.resolve("deploy", "auto-update.sh"),
      "utf8",
    );
    expect(updater).not.toContain("--legacy-target-commit");
    expect(environmentTemplate).toContain(
      "DATA_DIRECTORY=/var/lib/umbravia-forge",
    );
    expect(environmentTemplate).toContain(
      "ENVIRONMENT_DATA_ROOT=/var/lib/umbravia-forge/environments",
    );
    expect(deploymentReadme).toContain(
      "sudo install -d -o umbravia -g umbravia -m 0750 /var/lib/umbravia-forge /var/lib/umbravia-forge/environments",
    );
    expect(deploymentReadme).toContain(
      '--legacy-target-commit "$LEGACY_COMMIT"',
    );
    expect(
      deploymentReadme.indexOf("systemctl stop umbravia-forge.service"),
    ).toBeLessThan(
      deploymentReadme.indexOf('--legacy-target-commit "$LEGACY_COMMIT"'),
    );
    expect(deploymentReadme).toContain('ActiveState --value)" = inactive');
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
      "if ! release_health_check",
      activated,
    );
    const recoveryCall = updater.indexOf(
      'recover_previous_release "la nueva release no supera la salud local o publica"',
      healthFailure,
    );

    expect(buildNpmCi).toBeGreaterThan(-1);
    expect(buildNpmCi).toBeLessThan(releaseCreated);
    expect(releaseNpmCi).toBeGreaterThan(releaseCreated);
    expect(readiness).toBeGreaterThan(releaseNpmCi);
    expect(readiness).toBeLessThan(activated);
    expect(healthFailure).toBeGreaterThan(activated);
    expect(recoveryCall).toBeGreaterThan(healthFailure);
  });
});

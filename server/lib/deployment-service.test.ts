import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("systemd deployment service", () => {
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
    expect(readiness).toContain("CADDY_VALIDATION_LOG=$(mktemp");
    expect(readiness).toContain('UMBRAVIA_CADDY_LOG="$CADDY_VALIDATION_LOG"');
    expect(readiness).toContain('rm -f "$CADDY_VALIDATION_LOG"');
    expect(readiness).toContain("TURNSTILE_SECRET_KEY");
    expect(readiness).toContain("EMAIL_QUEUE_ENCRYPTION_KEY");
    expect(readiness).toContain(
      "EMAIL_VERIFICATION_ENABLED debe ser true en produccion",
    );
    expect(readiness).toContain(
      "for REQUIRED_ENV in SMTP_HOST SMTP_PORT EMAIL_FROM",
    );
    expect(readiness).toContain("EMAIL_VERIFICATION_ENABLED=true");
    expect(readiness).toContain("ausente para la verificacion de correo");
    expect(readiness).toContain(
      "SMTP_USER y SMTP_PASSWORD deben configurarse juntos",
    );
    expect(readiness).toContain("dist/server/bin/check-mail-dns.js");
    expect(readiness).toContain("EMAIL_PUBLIC_DNS_CHECK=strict");
    expect(readiness).toContain("DNS publico del MTA local incompleto");
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
    expect(installer).toContain("127.0.0.1:8891");
    expect(installer).toContain("se rechaza pisar una configuracion ajena");
    expect(installer).toContain("systemctl disable --now opendkim.service");
    expect(installer).toContain("Clave DKIM existente conservada");
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

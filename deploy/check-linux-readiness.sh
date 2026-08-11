#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${UMBRAVIA_ENV_FILE:-/etc/umbravia-forge/umbravia-forge.env}
FAILED=0

pass() {
  printf 'OK  %s\n' "$1"
}

fail() {
  printf 'ERR %s\n' "$1" >&2
  FAILED=1
}

warn() {
  printf 'WARN %s\n' "$1" >&2
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$1 disponible"
  else
    fail "$1 no esta instalado"
  fi
}

require_file() {
  if [ -f "$1" ]; then
    pass "$1 presente"
  else
    fail "$1 ausente"
  fi
}

version_at_least() {
  current_version=$1
  minimum_version=$2
  first_version=$(printf '%s\n' "$minimum_version" "$current_version" | sort -V | head -n 1)
  [ "$first_version" = "$minimum_version" ]
}

case "$(uname -s)" in
  Linux) pass "sistema Linux detectado" ;;
  *) fail "este despliegue requiere Linux" ;;
esac

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  pass "distribucion detectada: ${PRETTY_NAME:-Linux desconocido}"
fi

require_command node
require_command npm
require_command caddy
require_command head
require_command sort
require_command systemd-analyze

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -p "process.versions.node")
  NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" = "24" ] && version_at_least "$NODE_VERSION" "24.15.0"; then
    pass "Node.js $NODE_VERSION compatible"
  else
    fail "se requiere Node.js 24.15.0 o posterior dentro de la rama 24; version encontrada: $NODE_VERSION"
  fi
fi

if command -v npm >/dev/null 2>&1; then
  NPM_VERSION=$(npm --version)
  NPM_MAJOR=$(printf '%s' "$NPM_VERSION" | cut -d. -f1)
  if [ "$NPM_MAJOR" = "11" ] && version_at_least "$NPM_VERSION" "11.18.0"; then
    pass "npm $NPM_VERSION compatible con la politica fijada de scripts"
  else
    fail "se requiere npm 11.18.0 o posterior dentro de la rama 11 para aplicar allowScripts; version encontrada: $NPM_VERSION"
  fi
fi

require_file "$PROJECT_ROOT/dist/server/index.js"
require_file "$PROJECT_ROOT/dist/public/index.html"
require_file "$PROJECT_ROOT/package-lock.json"
require_file "$PROJECT_ROOT/deploy/Caddyfile"
require_file "$PROJECT_ROOT/deploy/umbravia-forge.service"
require_file "$PROJECT_ROOT/deploy/backup-postgresql-encrypted.sh"
require_file "$PROJECT_ROOT/deploy/verify-encrypted-backup.sh"
require_file "$PROJECT_ROOT/deploy/umbravia-forge-backup.service"
require_file "$PROJECT_ROOT/deploy/umbravia-forge-backup.timer"
require_file "$PROJECT_ROOT/node_modules/express/package.json"
require_file "$PROJECT_ROOT/node_modules/argon2/package.json"
require_file "$PROJECT_ROOT/node_modules/@noble/ciphers/package.json"
require_file "$PROJECT_ROOT/deploy/check-crypto-runtime.mjs"
require_file "$PROJECT_ROOT/deploy/check-private-content-key.mjs"
require_file "$PROJECT_ROOT/deploy/check-manager-connection-key.mjs"

CRYPTO_RUNTIME_OUTPUT=""
if CRYPTO_RUNTIME_OUTPUT=$(node "$PROJECT_ROOT/deploy/check-crypto-runtime.mjs" 2>&1); then
  pass "runtime criptografico completo operativo"
else
  fail "el runtime criptografico no puede ejecutar Argon2id, XChaCha20-Poly1305, AES-256-GCM, SHA-256 o scrypt: $CRYPTO_RUNTIME_OUTPUT"
fi

if command -v caddy >/dev/null 2>&1; then
  CADDY_VERSION=$(caddy version | sed 's/^v//' | cut -d' ' -f1)
  FIRST_VERSION=$(printf '%s\n' 2.10.0 "$CADDY_VERSION" | sort -V | head -n 1)
  if [ "$FIRST_VERSION" = "2.10.0" ]; then
    pass "Caddy $CADDY_VERSION compatible"
  else
    fail "se requiere Caddy 2.10.0 o posterior; version encontrada: $CADDY_VERSION"
  fi
fi

if [ -f "$ENV_FILE" ]; then
  MODE=$(stat -c '%a' "$ENV_FILE")
  case "$MODE" in
    600|640) pass "permisos seguros en $ENV_FILE ($MODE)" ;;
    *) fail "permisos inseguros en $ENV_FILE ($MODE); use 600 o 640" ;;
  esac

  if grep -Eiq 'replace-me|replace-with|example\.com' "$ENV_FILE"; then
    fail "$ENV_FILE contiene marcadores sin sustituir"
  else
    pass "$ENV_FILE no contiene marcadores conocidos"
  fi

  if grep -Eq '^TURNSTILE_SECRET_KEY=.{20,}$' "$ENV_FILE"; then
    pass "TURNSTILE_SECRET_KEY configurado"
  else
    fail "TURNSTILE_SECRET_KEY ausente o demasiado corto"
  fi

  if grep -Eq '^EMAIL_VERIFICATION_ENABLED=true$' "$ENV_FILE"; then
    pass "EMAIL_VERIFICATION_ENABLED activo"
  else
    fail "EMAIL_VERIFICATION_ENABLED debe ser true en produccion"
  fi

  for REQUIRED_ENV in SMTP_HOST SMTP_PORT EMAIL_FROM EMAIL_QUEUE_ENCRYPTION_KEY; do
    if grep -Eq "^${REQUIRED_ENV}=.+" "$ENV_FILE"; then
      pass "$REQUIRED_ENV configurado"
    else
      fail "$REQUIRED_ENV ausente para la verificacion de correo"
    fi
  done

  if node "$PROJECT_ROOT/deploy/check-private-content-key.mjs" "$ENV_FILE" >/dev/null 2>&1; then
    pass "cifrado XChaCha20-Poly1305 de contenido privado activo y valido"
  else
    PRIVATE_CRYPTO_STATUS=$?
    if [ "$PRIVATE_CRYPTO_STATUS" -eq 2 ]; then
      warn "cifrado de contenido privado aun no activado; configure la nueva clave antes de almacenar datos privados reales"
    else
      fail "configuracion invalida del cifrado de contenido privado"
    fi
  fi

  if node "$PROJECT_ROOT/deploy/check-manager-connection-key.mjs" "$ENV_FILE" >/dev/null 2>&1; then
    pass "cifrado XChaCha20-Poly1305 de interconexiones de gestores activo y valido"
  else
    fail "configuracion invalida del cifrado de interconexiones de gestores"
  fi

  if grep -Eq '^UMBRAVIA_BACKUP_AGE_RECIPIENT=(age1|age1pq1).+' "$ENV_FILE"; then
    pass "destinatario publico de copias cifradas configurado"
    for BACKUP_COMMAND in age flock pg_dump sha256sum; do
      if command -v "$BACKUP_COMMAND" >/dev/null 2>&1; then
        pass "$BACKUP_COMMAND disponible para copias cifradas"
      else
        fail "$BACKUP_COMMAND no esta instalado para copias cifradas"
      fi
    done
  else
    warn "copias PostgreSQL cifradas aun no activadas; configure el destinatario publico age y ejecute check-encryption-readiness.sh"
  fi

  SMTP_USER_PRESENT=0
  SMTP_PASSWORD_PRESENT=0
  if grep -Eq '^SMTP_USER=.+' "$ENV_FILE"; then SMTP_USER_PRESENT=1; fi
  if grep -Eq '^SMTP_PASSWORD=.+' "$ENV_FILE"; then SMTP_PASSWORD_PRESENT=1; fi
  if [ "$SMTP_USER_PRESENT" -eq "$SMTP_PASSWORD_PRESENT" ]; then
    pass "credenciales SMTP coherentes"
  else
    fail "SMTP_USER y SMTP_PASSWORD deben configurarse juntos"
  fi

  SMTP_HOST_VALUE=$(sed -n 's/^SMTP_HOST=//p' "$ENV_FILE" | tail -n 1 | tr '[:upper:]' '[:lower:]')
  case "$SMTP_HOST_VALUE" in
    127.0.0.1|::1|localhost)
      if ! grep -Eq '^EMAIL_PUBLIC_MAIL_HOST=.+' "$ENV_FILE"; then
        if grep -Eiq '^EMAIL_PUBLIC_DNS_CHECK=strict$' "$ENV_FILE"; then
          fail "EMAIL_PUBLIC_MAIL_HOST es obligatorio en el modo DNS estricto"
        else
          warn "host publico del MTA aun no configurado; la entrega local puede permanecer preparada mientras el proveedor mantiene bloqueado el puerto 25"
        fi
      else
        MAIL_DNS_ARGS="--env $ENV_FILE"
        if grep -Eiq '^EMAIL_PUBLIC_DNS_CHECK=strict$' "$ENV_FILE"; then
          MAIL_DNS_ARGS="$MAIL_DNS_ARGS --strict"
        fi
        # shellcheck disable=SC2086
        if node "$PROJECT_ROOT/dist/server/bin/check-mail-dns.js" $MAIL_DNS_ARGS; then
          pass "DNS publico del MTA local comprobado"
        elif grep -Eiq '^EMAIL_PUBLIC_DNS_CHECK=strict$' "$ENV_FILE"; then
          fail "DNS publico del MTA local incompleto"
        else
          warn "DNS publico del MTA local incompleto; active EMAIL_PUBLIC_DNS_CHECK=strict antes de aceptar correo real"
        fi
      fi
      ;;
  esac
else
  fail "$ENV_FILE no existe"
fi

if command -v caddy >/dev/null 2>&1; then
  CADDY_VALIDATION_LOG=$(mktemp "${TMPDIR:-/tmp}/umbravia-caddy-validation.XXXXXX")
  CADDY_VALIDATION_HOME=${HOME:-${TMPDIR:-/tmp}}
  CADDY_VALIDATION_XDG_HOME=${XDG_CONFIG_HOME:-$CADDY_VALIDATION_HOME/.config}
  trap 'rm -f "$CADDY_VALIDATION_LOG"' EXIT HUP INT TERM
  if HOME="$CADDY_VALIDATION_HOME" \
    XDG_CONFIG_HOME="$CADDY_VALIDATION_XDG_HOME" \
    UMBRAVIA_CADDY_LOG="$CADDY_VALIDATION_LOG" \
    caddy validate --config "$PROJECT_ROOT/deploy/Caddyfile" >/dev/null; then
    pass "Caddyfile valido"
  else
    fail "Caddyfile no valido"
  fi
  rm -f "$CADDY_VALIDATION_LOG"
  trap - EXIT HUP INT TERM
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if systemd-analyze verify \
    "$PROJECT_ROOT/deploy/umbravia-forge.service" \
    "$PROJECT_ROOT/deploy/umbravia-forge-backup.service" \
    "$PROJECT_ROOT/deploy/umbravia-forge-backup.timer"; then
    pass "unidades systemd validas"
  else
    fail "alguna unidad systemd no es valida"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\nLa preparacion de Linux tiene errores. No active esta version.\n' >&2
  exit 1
fi

printf '\nUmbravia Forge esta preparada para activarse en Linux.\n'

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
require_command systemd-analyze

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  if [ "$NODE_MAJOR" = "24" ]; then
    pass "Node.js 24 detectado"
  else
    fail "se requiere Node.js 24; version encontrada: $(node --version)"
  fi
fi

if command -v npm >/dev/null 2>&1; then
  NPM_MAJOR=$(npm --version | cut -d. -f1)
  if [ "$NPM_MAJOR" = "11" ]; then
    pass "npm 11 detectado"
  else
    fail "se requiere npm 11; version encontrada: $(npm --version)"
  fi
fi

require_file "$PROJECT_ROOT/dist/server/index.js"
require_file "$PROJECT_ROOT/dist/public/index.html"
require_file "$PROJECT_ROOT/package-lock.json"
require_file "$PROJECT_ROOT/deploy/Caddyfile"
require_file "$PROJECT_ROOT/deploy/umbravia-forge.service"
require_file "$PROJECT_ROOT/node_modules/express/package.json"

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
      ;;
  esac
else
  fail "$ENV_FILE no existe"
fi

if command -v caddy >/dev/null 2>&1; then
  CADDY_VALIDATION_LOG=$(mktemp "${TMPDIR:-/tmp}/umbravia-caddy-validation.XXXXXX")
  trap 'rm -f "$CADDY_VALIDATION_LOG"' EXIT HUP INT TERM
  if UMBRAVIA_CADDY_LOG="$CADDY_VALIDATION_LOG" \
    caddy validate --config "$PROJECT_ROOT/deploy/Caddyfile" >/dev/null; then
    pass "Caddyfile valido"
  else
    fail "Caddyfile no valido"
  fi
  rm -f "$CADDY_VALIDATION_LOG"
  trap - EXIT HUP INT TERM
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if systemd-analyze verify "$PROJECT_ROOT/deploy/umbravia-forge.service"; then
    pass "unidad systemd valida"
  else
    fail "unidad systemd no valida"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\nLa preparacion de Linux tiene errores. No active esta version.\n' >&2
  exit 1
fi

printf '\nUmbravia Forge esta preparada para activarse en Linux.\n'

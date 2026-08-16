#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG_PATH=${UMBRAVIA_CADDY_CONFIG:-/etc/caddy/Caddyfile}
CONFIG_DIR=$(dirname -- "$CONFIG_PATH")
MODULE_DIR=${UMBRAVIA_CADDY_DIAGNOSTICS_DIR:-$CONFIG_DIR/umbravia-diagnostics-enabled}
AVAILABLE_DIR=${UMBRAVIA_CADDY_DIAGNOSTICS_AVAILABLE_DIR:-$SCRIPT_DIR/caddy-diagnostics-available}
BACKUP_DIR=${UMBRAVIA_CADDY_BACKUP_DIR:-/var/backups/umbravia-forge/caddy}
CADDY_SERVICE=${UMBRAVIA_CADDY_SERVICE:-caddy.service}
PROBE_LOG=${UMBRAVIA_DIAGNOSTIC_RUNTIME_LOG:-/var/log/caddy/umbravia-diagnostic-access.log}
IMPORT_LINE='import umbravia-diagnostics-enabled/*.caddy'
PROBE_NAME=cf-test
PROBE_FILE=$MODULE_DIR/$PROBE_NAME.caddy
PROBE_TEMPLATE=$AVAILABLE_DIR/$PROBE_NAME.caddy

usage() {
  cat <<'EOF'
Uso: manage-caddy-diagnostics.sh <enable|disable|status|reload>

  enable   Instala el punto modular y activa la sonda cf-test.
  disable  Retira cf-test y conserva el punto modular para futuras sondas.
  status   Muestra si el modulo y la sonda estan activos.
  reload   Valida y recarga los modulos ya instalados.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "esta operacion requiere privilegios administrativos"
}

require_runtime() {
  command -v caddy >/dev/null 2>&1 || fail "caddy no esta instalado"
  command -v systemctl >/dev/null 2>&1 || fail "systemctl no esta disponible"
  [ -f "$CONFIG_PATH" ] || fail "no existe $CONFIG_PATH"
}

config_has_import() {
  grep -Fqx "$IMPORT_LINE" "$CONFIG_PATH"
}

validate_config() {
  config=$1
  validation_log=$(mktemp "${TMPDIR:-/tmp}/umbravia-caddy-diagnostic-validation.XXXXXX")
  if UMBRAVIA_DIAGNOSTIC_LOG="$validation_log" \
    caddy validate --config "$config" --adapter caddyfile >/dev/null; then
    rm -f "$validation_log"
    return 0
  fi
  rm -f "$validation_log"
  return 1
}

prepare_probe_log() {
  case "$PROBE_LOG" in
    /*) ;;
    *) fail "la ruta del registro de la sonda debe ser absoluta" ;;
  esac

  caddy_user=$(systemctl show "$CADDY_SERVICE" --property=User --value)
  caddy_group=$(systemctl show "$CADDY_SERVICE" --property=Group --value)
  [ -n "$caddy_user" ] || fail "no se pudo determinar el usuario de $CADDY_SERVICE"
  [ -n "$caddy_group" ] || caddy_group=$caddy_user

  probe_log_dir=$(dirname -- "$PROBE_LOG")
  if [ -e "$PROBE_LOG" ] && [ ! -f "$PROBE_LOG" ]; then
    fail "$PROBE_LOG existe pero no es un archivo regular"
  fi

  install -d -o "$caddy_user" -g "$caddy_group" -m 0750 "$probe_log_dir"
  touch "$PROBE_LOG"
  chown "$caddy_user:$caddy_group" "$PROBE_LOG"
  chmod 0640 "$PROBE_LOG"
}

make_candidate() {
  candidate=$1
  cp -p "$CONFIG_PATH" "$candidate"
  if ! grep -Fqx "$IMPORT_LINE" "$candidate"; then
    {
      printf '\n# Modulos de diagnostico de Umbravia Forge.\n'
      printf '%s\n' "$IMPORT_LINE"
    } >>"$candidate"
  fi
  validate_config "$candidate"
}

install_candidate() {
  candidate=$1
  backup=$2
  config_mode=$(stat -c '%a' "$CONFIG_PATH")
  config_uid=$(stat -c '%u' "$CONFIG_PATH")
  config_gid=$(stat -c '%g' "$CONFIG_PATH")

  cp -p "$CONFIG_PATH" "$backup"
  install -o "$config_uid" -g "$config_gid" -m "$config_mode" "$candidate" "$CONFIG_PATH"
}

reload_caddy() {
  validate_config "$CONFIG_PATH"
  systemctl reload "$CADDY_SERVICE"
}

enable_probe() {
  require_root
  require_runtime
  [ -f "$PROBE_TEMPLATE" ] || fail "no existe la plantilla $PROBE_TEMPLATE"

  install -d -o root -g root -m 0755 "$MODULE_DIR" "$BACKUP_DIR"
  prepare_probe_log
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=$BACKUP_DIR/Caddyfile.before-diagnostics.$timestamp
  candidate=$(mktemp "$CONFIG_DIR/.Caddyfile.umbravia.XXXXXX")
  module_backup=$(mktemp "$CONFIG_DIR/.cf-test.caddy.umbravia.XXXXXX")
  module_existed=0
  cleanup_files="$candidate $module_backup"
  trap 'rm -f $cleanup_files' EXIT HUP INT TERM

  if [ -f "$PROBE_FILE" ]; then
    cp -p "$PROBE_FILE" "$module_backup"
    module_existed=1
  fi

  install -o root -g root -m 0644 "$PROBE_TEMPLATE" "$PROBE_FILE"
  if ! make_candidate "$candidate"; then
    if [ "$module_existed" -eq 1 ]; then
      cp -p "$module_backup" "$PROBE_FILE"
    else
      rm -f "$PROBE_FILE"
    fi
    fail "la configuracion candidata de Caddy no es valida"
  fi

  install_candidate "$candidate" "$backup"
  if ! reload_caddy; then
    cp -p "$backup" "$CONFIG_PATH"
    if [ "$module_existed" -eq 1 ]; then
      cp -p "$module_backup" "$PROBE_FILE"
    else
      rm -f "$PROBE_FILE"
    fi
    systemctl reload "$CADDY_SERVICE" || true
    fail "Caddy no pudo recargarse; se restauro la configuracion anterior"
  fi

  printf 'Sonda %s activa. Copia previa: %s\n' "$PROBE_NAME" "$backup"
}

disable_probe() {
  require_root
  require_runtime
  if [ ! -f "$PROBE_FILE" ]; then
    printf 'La sonda %s ya esta desactivada; el modulo permanece disponible.\n' "$PROBE_NAME"
    return
  fi

  module_backup=$(mktemp "$CONFIG_DIR/.cf-test.caddy.umbravia.XXXXXX")
  cp -p "$PROBE_FILE" "$module_backup"
  trap 'rm -f "$module_backup"' EXIT HUP INT TERM
  rm -f "$PROBE_FILE"

  if ! reload_caddy; then
    cp -p "$module_backup" "$PROBE_FILE"
    systemctl reload "$CADDY_SERVICE" || true
    fail "Caddy no pudo recargarse; la sonda fue restaurada"
  fi

  printf 'Sonda %s retirada; el punto modular sigue disponible para futuros diagnosticos.\n' "$PROBE_NAME"
}

show_status() {
  [ -f "$CONFIG_PATH" ] || fail "no existe $CONFIG_PATH"
  if config_has_import; then
    printf 'modulo=instalado\n'
  else
    printf 'modulo=no_instalado\n'
  fi
  if [ -f "$PROBE_FILE" ]; then
    printf 'sonda_%s=activa\n' "$PROBE_NAME"
  else
    printf 'sonda_%s=inactiva\n' "$PROBE_NAME"
  fi
}

reload_modules() {
  require_root
  require_runtime
  config_has_import || fail "el punto modular aun no esta instalado"
  reload_caddy
  printf 'Modulos de diagnostico validados y recargados.\n'
}

case "${1:-}" in
  enable) enable_probe ;;
  disable) disable_probe ;;
  status) show_status ;;
  reload) reload_modules ;;
  *) usage >&2; exit 2 ;;
esac

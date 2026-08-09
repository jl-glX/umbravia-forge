#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${UMBRAVIA_ENV_FILE:-/etc/umbravia-forge/umbravia-forge.env}
FAILED=0

pass() { printf 'OK  %s\n' "$1"; }
warn() { printf 'WARN %s\n' "$1" >&2; }
fail() { printf 'ERR %s\n' "$1" >&2; FAILED=1; }

require_command() {
  if command -v "$1" >/dev/null 2>&1; then pass "$1 disponible"; else fail "$1 no esta instalado"; fi
}

check_veracrypt_profile() {
  profile_name=$1
  mount_path=$2
  expected_algorithm=$3
  label=$4

  case "$profile_name" in
    filesystem|'')
      warn "$label usa el perfil del sistema de archivos; no se declara una cascada VeraCrypt"
      return
      ;;
    veracrypt-aes-twofish-serpent)
      [ "$expected_algorithm" = "AES-Twofish-Serpent" ] || {
        fail "perfil VeraCrypt incoherente para $label"
        return
      }
      ;;
    veracrypt-aes-twofish)
      [ "$expected_algorithm" = "AES-Twofish" ] || {
        fail "perfil VeraCrypt incoherente para $label"
        return
      }
      ;;
    *)
      fail "perfil de almacenamiento desconocido para $label: $profile_name"
      return
      ;;
  esac

  if ! command -v veracrypt >/dev/null 2>&1; then
    fail "veracrypt no esta instalado para comprobar $label"
    return
  fi
  if ! mountpoint -q "$mount_path"; then
    fail "$mount_path no es un volumen montado independiente para $label"
    return
  fi

  properties=$(LC_ALL=C veracrypt -t --volume-properties "$mount_path" 2>/dev/null || true)
  if printf '%s\n' "$properties" | grep -Fqi "$expected_algorithm"; then
    pass "$label esta sobre un volumen $expected_algorithm"
  else
    fail "no se ha podido confirmar $expected_algorithm en $mount_path"
  fi
}

case "$(uname -s)" in
  Linux) pass "sistema Linux detectado" ;;
  *) fail "esta comprobacion requiere Linux" ;;
esac

for command_name in age findmnt flock mountpoint pg_dump pg_restore sha256sum stat systemd-analyze; do
  require_command "$command_name"
done

for required_file in \
  "$PROJECT_ROOT/deploy/backup-postgresql-encrypted.sh" \
  "$PROJECT_ROOT/deploy/verify-encrypted-backup.sh" \
  "$PROJECT_ROOT/deploy/umbravia-forge-backup.service" \
  "$PROJECT_ROOT/deploy/umbravia-forge-backup.timer"; do
  if [ -f "$required_file" ]; then pass "$required_file presente"; else fail "$required_file ausente"; fi
done

if [ -r "$ENV_FILE" ]; then
  mode=$(stat -c '%a' "$ENV_FILE")
  case "$mode" in
    600|640) pass "permisos seguros en $ENV_FILE ($mode)" ;;
    *) fail "permisos inseguros en $ENV_FILE ($mode); use 600 o 640" ;;
  esac

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  if [ "${DATABASE_PROVIDER:-}" = "postgresql" ]; then
    pass "PostgreSQL es el motor de produccion"
  else
    fail "DATABASE_PROVIDER debe ser postgresql"
  fi

  case "${DATABASE_URL:-}" in
    postgresql://*|postgres://*) pass "DATABASE_URL usa un esquema PostgreSQL" ;;
    *) fail "DATABASE_URL no es una URL PostgreSQL valida" ;;
  esac

  case "${UMBRAVIA_BACKUP_AGE_RECIPIENT:-}" in
    age1*|age1pq1*) pass "destinatario publico age configurado" ;;
    *) fail "UMBRAVIA_BACKUP_AGE_RECIPIENT no esta configurado o no es valido" ;;
  esac

  backup_directory=${UMBRAVIA_BACKUP_DIRECTORY:-/var/backups/umbravia-forge/postgresql}
  if [ -d "$backup_directory" ]; then
    backup_mode=$(stat -c '%a' "$backup_directory")
    case "$backup_mode" in
      700|750) pass "directorio de copias protegido ($backup_mode)" ;;
      *) fail "$backup_directory debe usar permisos 700 o 750; actuales: $backup_mode" ;;
    esac

    if find "$backup_directory" -maxdepth 1 -type f \
      \( -name '*.sql' -o -name '*.dump' -o -name '*.sqlite' -o -name '*.db' \) \
      -print -quit | grep -q .; then
      fail "$backup_directory contiene una posible copia sin cifrar"
    else
      pass "no hay copias PostgreSQL o SQLite en claro"
    fi
  else
    fail "$backup_directory no existe"
  fi

  postgres_profile=${UMBRAVIA_POSTGRES_STORAGE_PROFILE:-filesystem}
  postgres_mount=${UMBRAVIA_POSTGRES_STORAGE_MOUNT:-/var/lib/postgresql}
  sqlite_profile=${UMBRAVIA_SQLITE_STORAGE_PROFILE:-filesystem}
  sqlite_mount=${UMBRAVIA_SQLITE_STORAGE_MOUNT:-/var/lib/umbravia-forge/sqlite}
  check_veracrypt_profile "$postgres_profile" "$postgres_mount" "AES-Twofish-Serpent" "PostgreSQL"
  check_veracrypt_profile "$sqlite_profile" "$sqlite_mount" "AES-Twofish" "SQLite"
else
  fail "$ENV_FILE no existe o no se puede leer"
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if systemd-analyze verify \
    "$PROJECT_ROOT/deploy/umbravia-forge-backup.service" \
    "$PROJECT_ROOT/deploy/umbravia-forge-backup.timer"; then
    pass "unidades systemd de copia validas"
  else
    fail "unidades systemd de copia no validas"
  fi
fi

# El cifrado del volumen es una frontera de infraestructura. Se informa sin
# intentar modificar discos ni bloquear una release de aplicacion ya activa.
if command -v findmnt >/dev/null 2>&1 && command -v lsblk >/dev/null 2>&1; then
  root_source=$(findmnt -n -o SOURCE / 2>/dev/null || true)
  if [ -n "$root_source" ] && lsblk -s -n -o TYPE "$root_source" 2>/dev/null | grep -qx crypt; then
    pass "el sistema raiz esta respaldado por un volumen cifrado"
  else
    warn "no se ha confirmado cifrado de volumen para /; planifique LUKS o almacenamiento cifrado en una migracion controlada"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\nLa capa de cifrado tiene errores de preparacion. No active el temporizador.\n' >&2
  exit 1
fi

printf '\nLa capa de cifrado de Umbravia Forge esta preparada.\n'

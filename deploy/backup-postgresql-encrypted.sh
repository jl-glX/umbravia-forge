#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

ENV_FILE=${UMBRAVIA_ENV_FILE:-/etc/umbravia-forge/umbravia-forge.env}
BACKUP_DIRECTORY=${UMBRAVIA_BACKUP_DIRECTORY:-/var/backups/umbravia-forge/postgresql}
RETENTION_DAYS=${UMBRAVIA_BACKUP_RETENTION_DAYS:-30}
LOCK_FILE=${UMBRAVIA_BACKUP_LOCK_FILE:-/run/umbravia-forge/postgresql-backup.lock}

fail() {
  printf 'ERR %s\n' "$1" >&2
  exit 1
}

for command_name in age flock pg_dump sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name no esta instalado"
done

[ -r "$ENV_FILE" ] || fail "no se puede leer $ENV_FILE"

set -a
# El archivo pertenece a root y solo puede leerlo el grupo de la aplicacion.
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[ "${DATABASE_PROVIDER:-}" = "postgresql" ] || fail "DATABASE_PROVIDER debe ser postgresql"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL no esta configurada"
[ -n "${UMBRAVIA_BACKUP_AGE_RECIPIENT:-}" ] || \
  fail "UMBRAVIA_BACKUP_AGE_RECIPIENT no esta configurado"

case "$UMBRAVIA_BACKUP_AGE_RECIPIENT" in
  age1*|age1pq1*) ;;
  *) fail "UMBRAVIA_BACKUP_AGE_RECIPIENT no parece un destinatario age valido" ;;
esac

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) fail "UMBRAVIA_BACKUP_RETENTION_DAYS debe ser un numero entero" ;;
esac
[ "$RETENTION_DAYS" -ge 1 ] || fail "la retencion debe ser de al menos un dia"

[ -d "$BACKUP_DIRECTORY" ] || fail "$BACKUP_DIRECTORY no existe"
[ -w "$BACKUP_DIRECTORY" ] || fail "$BACKUP_DIRECTORY no permite escritura"

exec 9>"$LOCK_FILE"
flock -n 9 || fail "ya hay una copia de PostgreSQL en curso"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
hostname_safe=$(hostname | tr -cd 'A-Za-z0-9._-')
base_name="umbravia-forge-${hostname_safe:-server}-$timestamp.dump.age"
final_path="$BACKUP_DIRECTORY/$base_name"
temporary_path="$BACKUP_DIRECTORY/.$base_name.tmp"
checksum_path="$final_path.sha256"
temporary_checksum="$checksum_path.tmp"

cleanup() {
  rm -f -- "$temporary_path" "$temporary_checksum"
}
trap cleanup EXIT HUP INT TERM

# El volcado nunca se escribe en claro: pg_dump transmite directamente a age.
# La URL se entrega mediante el entorno de libpq para no exponer credenciales
# en la linea de comandos visible por otros procesos del sistema.
export PGDATABASE="$DATABASE_URL"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=- | \
  age --recipient "$UMBRAVIA_BACKUP_AGE_RECIPIENT" --output "$temporary_path"

[ -s "$temporary_path" ] || fail "age produjo una copia vacia"
chmod 0600 "$temporary_path"
mv -- "$temporary_path" "$final_path"

(
  cd -- "$BACKUP_DIRECTORY"
  sha256sum -- "$base_name" >"$(basename -- "$temporary_checksum")"
)
chmod 0600 "$temporary_checksum"
mv -- "$temporary_checksum" "$checksum_path"

# La retencion solo se aplica despues de completar y autenticar una copia nueva.
find "$BACKUP_DIRECTORY" -maxdepth 1 -type f \
  \( -name '*.dump.age' -o -name '*.dump.age.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

trap - EXIT HUP INT TERM
printf 'OK  copia cifrada creada: %s\n' "$final_path"

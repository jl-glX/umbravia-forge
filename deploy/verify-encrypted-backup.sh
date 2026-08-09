#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

fail() {
  printf 'ERR %s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || fail "uso: verify-encrypted-backup.sh <copia.dump.age> <identidad-age>"

BACKUP_PATH=$1
IDENTITY_PATH=$2
CHECKSUM_PATH="$BACKUP_PATH.sha256"

for command_name in age pg_restore sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name no esta instalado"
done

[ -f "$BACKUP_PATH" ] || fail "la copia cifrada no existe"
[ -f "$CHECKSUM_PATH" ] || fail "falta el checksum de la copia"
[ -f "$IDENTITY_PATH" ] || fail "la identidad age no existe"

identity_mode=$(stat -c '%a' "$IDENTITY_PATH")
case "$identity_mode" in
  400|600|640) ;;
  *) fail "la identidad age debe usar permisos 400, 600 o 640" ;;
esac

(
  cd -- "$(dirname -- "$BACKUP_PATH")"
  sha256sum --check --status "$(basename -- "$CHECKSUM_PATH")"
) || fail "el checksum de la copia no coincide"

# La verificacion descifra por tuberia y no crea un volcado PostgreSQL en claro.
age --decrypt --identity "$IDENTITY_PATH" "$BACKUP_PATH" | pg_restore --list >/dev/null

printf 'OK  copia descifrada y catalogo PostgreSQL validado\n'

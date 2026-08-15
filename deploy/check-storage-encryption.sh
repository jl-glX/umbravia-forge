#!/bin/sh

set -eu

say() {
  printf '%s\n' "$1"
}

fail() {
  say "estado=no_conforme"
  say "motivo=$1"
  exit 2
}

for command_name in findmnt lsblk awk basename; do
  command -v "$command_name" >/dev/null 2>&1 || {
    say "estado=error"
    say "motivo=falta_el_comando_$command_name"
    exit 1
  }
done

root_source=$(findmnt -n -o SOURCE / 2>/dev/null || true)
[ -n "$root_source" ] || {
  say "estado=error"
  say "motivo=no_se_pudo_identificar_el_volumen_raiz"
  exit 1
}

say "root_source=$root_source"
say "topologia_inicio"
lsblk -s -n -o NAME,TYPE,FSTYPE,MOUNTPOINTS "$root_source" 2>/dev/null || {
  say "estado=error"
  say "motivo=no_se_pudo_leer_la_topologia_del_volumen"
  exit 1
}
say "topologia_fin"

crypt_mapping=$(
  lsblk -s -n -o NAME,TYPE "$root_source" 2>/dev/null |
    awk '$2 == "crypt" { print $1; exit }'
)

[ -n "$crypt_mapping" ] ||
  fail "el_volumen_raiz_no_esta_dentro_de_un_mapeo_dm_crypt"

say "crypt_mapping=$(basename "$crypt_mapping")"

command -v cryptsetup >/dev/null 2>&1 ||
  fail "cryptsetup_no_esta_disponible_para_verificar_el_cifrado"

crypt_status=$(cryptsetup status "$(basename "$crypt_mapping")" 2>/dev/null || true)
[ -n "$crypt_status" ] ||
  fail "no_se_pudo_consultar_el_estado_del_mapeo_dm_crypt"

cipher=$(
  printf '%s\n' "$crypt_status" |
    awk -F: '$1 ~ /^[[:space:]]*cipher[[:space:]]*$/ { value=$2; sub(/^[[:space:]]+/, "", value); print value; exit }'
)
keysize_bits=$(
  printf '%s\n' "$crypt_status" |
    awk -F: '$1 ~ /^[[:space:]]*keysize[[:space:]]*$/ { value=$2; sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+bits.*/, "", value); print value; exit }'
)

[ -n "$cipher" ] || fail "cryptsetup_no_informo_el_cifrado"
[ -n "$keysize_bits" ] || fail "cryptsetup_no_informo_el_tamano_de_clave"

say "cipher=$cipher"
say "keysize_bits=$keysize_bits"

[ "$cipher" = "aes-xts-plain64" ] ||
  fail "el_cifrado_del_volumen_no_es_aes_xts_plain64"

[ "$keysize_bits" = "512" ] ||
  fail "aes_xts_no_usa_512_bits_totales_dos_claves_aes_256"

say "estado=conforme"
say "politica=XTS-AES-256_mediante_LUKS2_dm-crypt"

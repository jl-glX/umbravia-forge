#!/bin/sh
set -eu

UPDATER_ROOT=/var/lib/umbravia-forge-updater
UPDATE_LOCK=/run/lock/umbravia-forge-update.lock
UPDATE_SERVICE=/etc/systemd/system/umbravia-forge-update.service
UPDATE_TIMER=/etc/systemd/system/umbravia-forge-update.timer
CURRENT_RELEASE=/opt/umbravia-forge/current

if [ "$(id -u)" -ne 0 ]; then
  printf 'ERR esta limpieza debe ejecutarse como root\n' >&2
  exit 1
fi

case "$UPDATER_ROOT" in
  /var/lib/umbravia-forge-updater) ;;
  *)
    printf 'ERR ruta del actualizador inesperada: %s\n' "$UPDATER_ROOT" >&2
    exit 1
    ;;
esac

active_release=$(readlink -f "$CURRENT_RELEASE" 2>/dev/null || true)
if [ -z "$active_release" ] || [ ! -d "$active_release" ]; then
  printf 'ERR no se ha encontrado una release activa; no se limpia nada\n' >&2
  exit 1
fi

printf 'Release activa preservada: %s\n' "$active_release"

if ! systemctl is-active --quiet umbravia-forge.service; then
  printf 'ERR la aplicacion activa no esta en ejecucion; no se retira el actualizador\n' >&2
  exit 1
fi

systemctl disable --now umbravia-forge-update.timer
if systemctl is-active --quiet umbravia-forge-update.timer; then
  printf 'ERR el temporizador sigue activo; no se limpia nada\n' >&2
  exit 1
fi
if systemctl is-active --quiet umbravia-forge-update.service; then
  printf 'ERR hay una actualizacion en curso; espere a que termine antes de retirar el actualizador\n' >&2
  exit 1
fi

install -d -o root -g root -m 0755 "$(dirname "$UPDATE_LOCK")"
exec 9>"$UPDATE_LOCK"
if ! flock -n 9; then
  printf 'ERR el bloqueo del actualizador sigue ocupado; no se limpia nada\n' >&2
  exit 1
fi

rm -f -- "$UPDATE_SERVICE" "$UPDATE_TIMER"
if [ -d "$UPDATER_ROOT" ]; then
  rm -rf -- "$UPDATER_ROOT"
fi

systemctl daemon-reload
systemctl reset-failed umbravia-forge-update.service umbravia-forge-update.timer 2>/dev/null || true

printf 'Actualizador automatico retirado. Umbravia Forge sigue activa.\n'

#!/bin/sh
set -eu

ACTION=${1:-plan}
DOMAIN=${UMBRAVIA_MAIL_DOMAIN:-umbraviaforge.com}
MAIL_HOST=${UMBRAVIA_MAIL_HOST:-mail.$DOMAIN}
DKIM_SELECTOR=${UMBRAVIA_DKIM_SELECTOR:-forge}
PUBLIC_IPV4=${UMBRAVIA_PUBLIC_IPV4:-}
CONFIG_ROOT=${UMBRAVIA_MAIL_CONFIG_ROOT:-/etc/umbravia-forge-mail}
LEGACY_CONFIG_ROOT=${UMBRAVIA_MAIL_LEGACY_CONFIG_ROOT:-/etc/umbravia-forge/mail}
KEY_ROOT=$CONFIG_ROOT/keys/$DOMAIN
DKIM_CONFIG=$CONFIG_ROOT/opendkim.conf
DNS_MANIFEST=$CONFIG_ROOT/dns-records.txt
DKIM_SERVICE=umbravia-forge-dkim.service
DKIM_UNIT=/etc/systemd/system/$DKIM_SERVICE
BACKUP_ROOT=/var/backups/umbravia-forge-mail
APPLY_SUCCEEDED=0
POSTFIX_BACKUP=
STOCK_OPENDKIM_WAS_ACTIVE=0

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERR %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "falta el comando requerido: $1"
}

validate_settings() {
  case "$DOMAIN" in
    *[!A-Za-z0-9.-]*|.*|*..*|*.) fail "dominio de correo no valido: $DOMAIN" ;;
  esac
  case "$MAIL_HOST" in
    *[!A-Za-z0-9.-]*|.*|*..*|*.) fail "host de correo no valido: $MAIL_HOST" ;;
  esac
  case "$DKIM_SELECTOR" in
    ''|*[!A-Za-z0-9_-]*) fail "selector DKIM no valido: $DKIM_SELECTOR" ;;
  esac
  if [ -n "$PUBLIC_IPV4" ]; then
    case "$PUBLIC_IPV4" in
      *[!0-9.]*|.*|*..*|*.) fail "IPv4 publica no valida: $PUBLIC_IPV4" ;;
    esac
  fi
}

print_plan() {
  cat <<EOF
Plan de correo de Umbravia Forge (sin cambios)

Dominio:        $DOMAIN
Host de correo: $MAIL_HOST
Selector DKIM:  $DKIM_SELECTOR
IPv4 publica:   ${PUBLIC_IPV4:-pendiente}

La fase apply:
  1. instala Postfix, OpenDKIM y sus herramientas;
  2. conserva Postfix limitado a loopback-only;
  3. genera una clave DKIM privada solo si no existe;
  4. crea un servicio DKIM aislado para Umbravia Forge;
  5. conecta Postfix con el milter local 127.0.0.1:8891;
  6. valida ambos servicios y genera un manifiesto DNS publico.

No abre puertos, no activa recepcion SMTP publica, no modifica el archivo de
entorno de la aplicacion y no imprime claves privadas.
EOF
}

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y postfix opendkim opendkim-tools ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y postfix opendkim opendkim-tools ca-certificates
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install postfix opendkim ca-certificates
  elif command -v pacman >/dev/null 2>&1; then
    pacman --noconfirm -S --needed postfix opendkim ca-certificates
  else
    fail "gestor de paquetes no compatible; instale Postfix y OpenDKIM manualmente"
  fi
}

backup_postfix() {
  timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
  backup_dir=$BACKUP_ROOT/$timestamp
  install -d -o root -g root -m 0700 "$backup_dir"
  POSTFIX_BACKUP=$backup_dir/main.cf
  cp /etc/postfix/main.cf "$POSTFIX_BACKUP"
  chmod 0600 "$POSTFIX_BACKUP"
  log "Copia previa de Postfix: $POSTFIX_BACKUP"
}

rollback_on_failure() {
  [ "$ACTION" = "apply" ] || return 0
  [ "$APPLY_SUCCEEDED" -eq 0 ] || return 0
  if [ -n "$POSTFIX_BACKUP" ] && [ -f "$POSTFIX_BACKUP" ]; then
    cp "$POSTFIX_BACKUP" /etc/postfix/main.cf
    postfix check >/dev/null 2>&1 || true
    systemctl restart postfix >/dev/null 2>&1 || true
  fi
  systemctl stop "$DKIM_SERVICE" >/dev/null 2>&1 || true
  printf 'WARN la activacion fallo; se restauro main.cf y se conservaron la clave y los diagnosticos\n' >&2
}

write_dkim_files() {
  getent passwd opendkim >/dev/null 2>&1 || fail "el paquete no creo el usuario opendkim"
  getent group opendkim >/dev/null 2>&1 || fail "el paquete no creo el grupo opendkim"

  install -d -o root -g opendkim -m 0750 "$CONFIG_ROOT" "$CONFIG_ROOT/keys" "$KEY_ROOT"
  legacy_key_root=$LEGACY_CONFIG_ROOT/keys/$DOMAIN
  if [ "$CONFIG_ROOT" != "$LEGACY_CONFIG_ROOT" ] && \
    [ ! -f "$KEY_ROOT/$DKIM_SELECTOR.private" ] && \
    [ -f "$legacy_key_root/$DKIM_SELECTOR.private" ]; then
    install -o root -g opendkim -m 0640 \
      "$legacy_key_root/$DKIM_SELECTOR.private" \
      "$KEY_ROOT/$DKIM_SELECTOR.private"
    if [ -f "$legacy_key_root/$DKIM_SELECTOR.txt" ]; then
      install -o root -g root -m 0644 \
        "$legacy_key_root/$DKIM_SELECTOR.txt" \
        "$KEY_ROOT/$DKIM_SELECTOR.txt"
    fi
    log "Clave DKIM heredada conservada y copiada al directorio aislado: $KEY_ROOT"
  fi
  if [ ! -f "$KEY_ROOT/$DKIM_SELECTOR.private" ]; then
    opendkim-genkey -b 2048 -d "$DOMAIN" -D "$KEY_ROOT" -s "$DKIM_SELECTOR"
    log "Nueva clave DKIM generada y custodiada en $KEY_ROOT"
  else
    log "Clave DKIM existente conservada: $KEY_ROOT/$DKIM_SELECTOR.private"
  fi
  [ -f "$KEY_ROOT/$DKIM_SELECTOR.txt" ] || \
    fail "falta la representacion publica de la clave DKIM existente"
  chown root:opendkim "$KEY_ROOT/$DKIM_SELECTOR.private"
  chmod 0640 "$KEY_ROOT/$DKIM_SELECTOR.private"
  chown root:root "$KEY_ROOT/$DKIM_SELECTOR.txt"
  chmod 0644 "$KEY_ROOT/$DKIM_SELECTOR.txt"

  cat >"$CONFIG_ROOT/TrustedHosts" <<EOF
127.0.0.1
::1
localhost
$DOMAIN
*.$DOMAIN
EOF
  cat >"$CONFIG_ROOT/KeyTable" <<EOF
$DKIM_SELECTOR._domainkey.$DOMAIN $DOMAIN:$DKIM_SELECTOR:$KEY_ROOT/$DKIM_SELECTOR.private
EOF
  cat >"$CONFIG_ROOT/SigningTable" <<EOF
*@$DOMAIN $DKIM_SELECTOR._domainkey.$DOMAIN
EOF
  cat >"$DKIM_CONFIG" <<EOF
Syslog                  yes
SyslogSuccess           yes
LogWhy                  no
Mode                    sv
Canonicalization        relaxed/simple
SubDomains              no
OversignHeaders         From
AutoRestart             yes
AutoRestartRate         10/1h
Socket                  inet:8891@127.0.0.1
ExternalIgnoreList      refile:$CONFIG_ROOT/TrustedHosts
InternalHosts           refile:$CONFIG_ROOT/TrustedHosts
KeyTable                refile:$CONFIG_ROOT/KeyTable
SigningTable            refile:$CONFIG_ROOT/SigningTable
EOF
  chown root:opendkim "$CONFIG_ROOT/TrustedHosts" "$CONFIG_ROOT/KeyTable" \
    "$CONFIG_ROOT/SigningTable" "$DKIM_CONFIG"
  chmod 0640 "$CONFIG_ROOT/TrustedHosts" "$CONFIG_ROOT/KeyTable" \
    "$CONFIG_ROOT/SigningTable" "$DKIM_CONFIG"
}

write_dkim_service() {
  opendkim_binary=$(command -v opendkim)
  cat >"$DKIM_UNIT" <<EOF
[Unit]
Description=Umbravia Forge DKIM signer
After=network.target
Before=postfix.service

[Service]
Type=simple
User=opendkim
Group=opendkim
ExecStart=$opendkim_binary -f -x $DKIM_CONFIG
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictRealtime=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$DKIM_UNIT"
  systemd-analyze verify "$DKIM_UNIT"
}

configure_postfix() {
  postconf -e "myhostname = $MAIL_HOST"
  postconf -e "mydomain = $DOMAIN"
  postconf -e 'myorigin = $mydomain'
  postconf -e 'inet_interfaces = loopback-only'
  postconf -e 'inet_protocols = ipv4'
  postconf -e 'smtp_address_preference = ipv4'
  postconf -e 'mynetworks = 127.0.0.0/8 [::1]/128'
  postconf -e 'smtpd_relay_restrictions = permit_mynetworks,reject_unauth_destination'
  postconf -e 'smtpd_recipient_restrictions = permit_mynetworks,reject_unauth_destination'
  postconf -e 'smtp_tls_security_level = may'
  postconf -e 'smtp_tls_CApath = /etc/ssl/certs'
  postconf -e 'smtp_tls_session_cache_database = btree:${data_directory}/smtp_scache'
  postconf -e 'maximal_queue_lifetime = 1d'
  postconf -e 'bounce_queue_lifetime = 1d'
  postconf -e 'minimal_backoff_time = 5m'
  postconf -e 'maximal_backoff_time = 1h'
  postconf -e 'queue_run_delay = 5m'
  postconf -e 'smtpd_milters = inet:127.0.0.1:8891'
  postconf -e 'non_smtpd_milters = inet:127.0.0.1:8891'
  postconf -e 'milter_default_action = tempfail'
  postconf -e 'milter_protocol = 6'
  postfix check
}

write_dns_manifest() {
  dkim_value=$(awk -F'"' '{ for (i = 2; i <= NF; i += 2) printf "%s", $i } END { print "" }' \
    "$KEY_ROOT/$DKIM_SELECTOR.txt")
  [ -n "$dkim_value" ] || fail "no se pudo extraer la clave DKIM publica"
  cat >"$DNS_MANIFEST" <<EOF
# Registros publicos propuestos. Este archivo no contiene la clave privada.
# Revise conflictos antes de publicarlos en Cloudflare.
A|$MAIL_HOST|${PUBLIC_IPV4:-INTRODUCIR_IPV4_PUBLICA}|DNS_ONLY
TXT|$DOMAIN|v=spf1${PUBLIC_IPV4:+ ip4:$PUBLIC_IPV4} ~all
TXT|$DKIM_SELECTOR._domainkey.$DOMAIN|$dkim_value
TXT|_dmarc.$DOMAIN|v=DMARC1; p=none; adkim=s; aspf=s; pct=100

# No publicar todavia:
# MX|$DOMAIN|10 $MAIL_HOST
# La recepcion publica requiere antes puerto 25, destinos, antispam, rebotes,
# lista de supresion y una prueba controlada contra relay abierto.
EOF
  chown root:root "$DNS_MANIFEST"
  chmod 0644 "$DNS_MANIFEST"
}

check_infrastructure() {
  require_command postfix
  require_command postconf
  require_command opendkim
  require_command systemctl
  require_command systemd-analyze
  [ -r "$DKIM_CONFIG" ] || fail "falta $DKIM_CONFIG"
  [ -r "$KEY_ROOT/$DKIM_SELECTOR.private" ] || fail "falta la clave DKIM privada"
  [ "$(postconf -h inet_interfaces)" = "loopback-only" ] ||
    fail "Postfix no esta limitado a loopback-only"
  [ "$(postconf -h myhostname)" = "$MAIL_HOST" ] ||
    fail "myhostname no coincide con $MAIL_HOST"
  [ "$(postconf -h inet_protocols)" = "ipv4" ] ||
    fail "Postfix debe usar IPv4 mientras IPv6 no tenga identidad SMTP completa"
  [ "$(postconf -h smtp_address_preference)" = "ipv4" ] ||
    fail "Postfix no prioriza IPv4 para la entrega saliente"
  postconf -h smtpd_milters | grep -F '127.0.0.1:8891' >/dev/null ||
    fail "Postfix no esta conectado al firmador DKIM"
  [ "$(postconf -h maximal_queue_lifetime)" = "1d" ] ||
    fail "Postfix no limita la vida maxima de la cola"
  [ "$(postconf -h bounce_queue_lifetime)" = "1d" ] ||
    fail "Postfix no limita la vida de los avisos de rebote"
  opendkim -n -x "$DKIM_CONFIG"
  postfix check
  systemctl is-active --quiet "$DKIM_SERVICE" || fail "$DKIM_SERVICE no esta activo"
  systemctl is-active --quiet postfix || fail "Postfix no esta activo"
  log "OK infraestructura saliente preparada y limitada a loopback"
  log "Manifiesto DNS publico: $DNS_MANIFEST"
}

validate_settings

case "$ACTION" in
  plan)
    print_plan
    ;;
  check)
    check_infrastructure
    ;;
  apply)
    [ "$(id -u)" -eq 0 ] || fail "apply debe ejecutarse como root"
    trap rollback_on_failure EXIT
    trap 'rollback_on_failure; exit 1' HUP INT TERM
    if systemctl is-active --quiet opendkim.service 2>/dev/null; then
      STOCK_OPENDKIM_WAS_ACTIVE=1
      fail "opendkim.service ya esta activo; se rechaza pisar una configuracion ajena"
    fi
    install_packages
    for command_name in postfix postconf opendkim opendkim-genkey systemctl systemd-analyze; do
      require_command "$command_name"
    done
    if [ "$STOCK_OPENDKIM_WAS_ACTIVE" -eq 0 ] && systemctl is-active --quiet opendkim.service 2>/dev/null; then
      systemctl disable --now opendkim.service
    fi
    backup_postfix
    write_dkim_files
    write_dkim_service
    configure_postfix
    write_dns_manifest
    systemctl daemon-reload
    systemctl enable --now "$DKIM_SERVICE"
    systemctl enable --now postfix
    systemctl restart postfix
    check_infrastructure
    APPLY_SUCCEEDED=1
    trap - EXIT HUP INT TERM
    log "OK configuracion aplicada sin publicar SMTP entrante"
    log "Para revisar los registros publicos: sudo cat $DNS_MANIFEST"
    ;;
  *)
    fail "uso: $0 [plan|apply|check]"
    ;;
esac

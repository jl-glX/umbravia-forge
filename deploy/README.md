# Despliegue protegido en un único servidor

Estos archivos preparan la topología inicial de Umbravia Forge:

```text
Internet -> Caddy :443 -> Node 127.0.0.1:3001 -> PostgreSQL 127.0.0.1:5432
```

Solo Caddy queda expuesto. Node y PostgreSQL permanecen en la interfaz local.
El paquete se orienta a distribuciones Linux con `systemd`; Ubuntu Server 24.04
es el primer entorno objetivo, no una dependencia. La secuencia portable se
documenta en `LINUX.md`.

Los archivos `/etc/umbravia-forge/umbravia-forge.env` y
`/etc/umbravia-forge/update.env` son estado persistente protegido. No forman
parte de una release y los scripts de instalación, actualización, reversión o
limpieza no deben eliminarlos. La rotación de una clave o la sustitución de uno
de estos archivos es una operación administrativa independiente, con copia
protegida y validación previa.

## Archivos

- `Caddyfile`: HTTPS, rechazo temprano de sondas automáticas, límite exterior
  de cuerpo, registro JSON rotado y proxy con comprobación de salud.
- `manage-caddy-diagnostics.sh`: instala una única extensión modular en Caddy y
  permite activar o retirar sondas aisladas sin volver a editar el sitio
  principal.
- `umbravia-forge.service`: servicio `systemd` sin privilegios, con reinicio
  limitado, cierre mediante `SIGTERM`, resolución portable de Node desde
  `/usr/local/bin` o `/usr/bin` y aislamiento del sistema de archivos.
- `auto-update.sh`: actualización ascendente y atómica desde `origin/main`,
  con bloqueo de concurrencia, compilación aislada, validación de salud y
  reversión si la release nueva no responde.
- `umbravia-forge-update.service` y `.timer`: comprobación periódica de cambios
  cada 15 minutos, con un retraso aleatorio corto para evitar ejecuciones
  simultáneas tras reinicios.
- `audit-deployment-package.mjs`: impide empaquetar por accidente repositorios,
  secretos, claves privadas o bases de datos locales.
- `configure-mail.sh`: prepara de forma explícita e idempotente Postfix y un
  firmador OpenDKIM aislado, sin abrir SMTP entrante ni modificar secretos de
  la aplicación.

## Instalación resumida

1. Crear el usuario y las carpetas:

   ```text
   sudo useradd --system --home /var/lib/umbravia-forge --shell /usr/sbin/nologin umbravia
   sudo install -d -o root -g root -m 0755 /opt/umbravia-forge/releases
   sudo install -d -o root -g umbravia -m 0750 /etc/umbravia-forge
   sudo install -d -o caddy -g caddy -m 0750 /var/log/caddy
   ```

2. Copiar una versión construida a
   `/opt/umbravia-forge/releases/<version>` y crear el enlace
   `/opt/umbravia-forge/current`.
   `npm run deploy:package` valida que el frontend reciba una clave pública real
   de Cloudflare Turnstile y que la configuración de producción mantenga
   activas la validación de Turnstile en la API y la verificación de correo.
   El paquete no contiene `node_modules`: dentro de la versión copiada debe
   ejecutarse `npm ci --omit=dev`. Esto es obligatorio aunque el paquete se
   haya construido en Windows, porque las dependencias nativas deben instalarse
   para Linux y desde el `package-lock.json` validado. A continuación se ejecuta
   `npm rebuild argon2 --foreground-scripts`, limitado al módulo nativo revisado.
   La preparación prueba Argon2id, AES-256-GCM y la lectura compatible de
   XChaCha20-Poly1305 con operaciones reales antes de activar la release.
3. Copiar `deploy/umbravia-forge.env.template` a
   `/etc/umbravia-forge/umbravia-forge.env`, sustituir todos los marcadores y
   aplicar permisos `0640` con grupo `umbravia`.
4. Copiar el servicio a `/etc/systemd/system/umbravia-forge.service`.
5. Copiar el `Caddyfile` a `/etc/caddy/Caddyfile`. El dominio no forma parte de
   las reglas de seguridad: puede sustituirse en el archivo o proporcionarse
   con `UMBRAVIA_DOMAIN` al servicio Caddy. Al cambiarlo también deben ajustarse
   `CLIENT_ORIGIN`, `WEBAUTHN_ORIGIN` y `WEBAUTHN_RP_ID`.
6. Validar antes de activar:

   ```text
   sudo systemd-analyze verify /etc/systemd/system/umbravia-forge.service
   sudo caddy fmt --overwrite /etc/caddy/Caddyfile
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl daemon-reload
   sudo systemctl enable --now umbravia-forge
   sudo systemctl reload caddy
   ```

   Después de instalar las dependencias y el archivo de entorno, ejecutar:

   ```text
   chmod +x deploy/check-linux-readiness.sh
   sudo UMBRAVIA_ENV_FILE=/etc/umbravia-forge/umbravia-forge.env \
     ./deploy/check-linux-readiness.sh
   ```

   El comprobador exige Linux, Node 24, npm 11.18.0 o posterior dentro de la
   rama 11, Caddy, `systemd`, los artefactos
   compilados, dependencias de producción instaladas, configuración sin
   marcadores y permisos `0600` o `0640` para los secretos. Si algo falla, la
   versión no debe activarse.

7. Comprobar la salud desde el servidor y mediante el dominio configurado:

   ```text
   curl --fail http://127.0.0.1:3001/api/health/live
   curl --fail http://127.0.0.1:3001/api/health
   curl --fail https://<dominio-configurado>/api/health
   ```

Las comprobaciones ofensivas del perímetro se harán más adelante sobre una
preproducción pública controlada. Los logs se consultan con
`journalctl -u umbravia-forge` y en
`/var/log/caddy/umbravia-forge-access.log`.

## Sondas independientes de Caddy

La configuración principal termina en un glob de importación estable:
`umbravia-diagnostics-enabled/*.caddy`. Caddy acepta que este glob esté vacío.
Por tanto, una futura sonda puede añadirse o retirarse como módulo sin volver a
modificar el sitio público ni sus reglas de proxy. Esta organización sigue el
mecanismo oficial de importación del Caddyfile.

La sonda temporal `cf-test.umbraviaforge.com` publica exclusivamente
`/api/health/live` y `/api/health/ready`. Rechaza cualquier otro método o ruta,
no permite indexación y mantiene un registro separado con una semana de
retención máxima. No contiene credenciales y no da acceso al resto de la
aplicación.

Activación inicial en el servidor:

```text
cd ~/umbravia-forge
sudo sh deploy/manage-caddy-diagnostics.sh enable
sudo sh deploy/manage-caddy-diagnostics.sh status
```

Una vez activada la sonda, la consola corporativa permite comprobarla sin
abrir un navegador. Desde la rama de soporte:

```text
use profile:manager-support
ufctl diagnose probe all
```

El diagnóstico es de solo lectura, usa el host configurado en
`UMBRAVIA_DIAGNOSTIC_PROBE_ORIGIN` (o `https://cf-test.umbraviaforge.com` por
defecto) y no permite indicar destinos arbitrarios.

El gestor conserva una copia del Caddyfile, valida la configuración candidata
antes de instalarla y restaura la anterior si Caddy no puede recargarse. La
activación no modifica claves existentes. Caddy obtiene y administra el
certificado TLS del subdominio mediante su flujo normal.

La sonda solo debe pasar a DNS directo después de que el servidor reconozca el
dominio. Entonces se deshabilitan su redirección y el proxy de Cloudflare, y se
verifican certificado, ambos endpoints de salud y el cierre `404` del resto de
rutas.

No debe retirarse por una única comprobación favorable. La salida segura exige
que el dominio público servido por el proxy mantenga durante siete días
consecutivos: acceso desde al menos dos redes, salud `live` y `ready`, ausencia
de errores 52x o tiempos de espera y configuración estable en Cloudflare. Al
cumplirse estas condiciones se retira solo la sonda actual, conservando el
punto modular para no tener que recrear la infraestructura:

```text
sudo sh deploy/manage-caddy-diagnostics.sh disable
```

Después se elimina el registro DNS temporal de Cloudflare. El import modular
permanece vacío e inactivo, preparado para futuras sondas autorizadas.

## Actualizaciones periódicas sin regresiones

El actualizador opcional consulta exclusivamente la punta configurada de
`origin/main`. Si el commit remoto coincide con el desplegado, no hace nada. Si
es anterior o pertenece a una historia divergente, rechaza la operación: una
comprobación automática nunca puede degradar el servidor a una versión vieja.

La construcción se realiza en un `worktree` temporal con el usuario aislado
`umbravia-updater`. Solo después de superar el empaquetado, la auditoría de la
release, la instalación Linux de dependencias y el comprobador de preparación
se cambia atómicamente el enlace `current`. La release anterior se conserva
como mecanismo de reversión y se restaura si falla la salud local o pública.

Cada release preparada termina con `.umbravia-release-complete`. Si una fase
falla después de crear el directorio de release y antes de activarlo, el
actualizador elimina ese directorio y también su `worktree` temporal. Al
arrancar, un directorio para el commit remoto sin ese marcador (o con metadatos
inconsistentes) se considera incompleto, se limpia y se reconstruye. Una
release marcada como completa que no sea la activa se conserva y provoca un
error explícito para permitir su revisión manual. Las protecciones de limpieza
rechazan siempre borrar el destino de `current` o la release anterior reservada
para rollback. Bajo el mismo `flock`, cada ejecución elimina además enlaces
`current.next`, builds abandonados y registros obsoletos de `git worktree`; solo
se consideran temporales los directorios `build-*` dentro del directorio fijo
del updater.

Antes del comprobador de preparación se normalizan también los permisos que
`cp -a` haya conservado del paquete: el propietario mantiene escritura, el
grupo de la aplicación obtiene lectura y acceso a directorios, y otros usuarios
no obtienen acceso. Así, systemd puede entrar en la nueva release aunque el
directorio empaquetado tuviera un modo más restrictivo.

Instalación inicial:

```text
sudo useradd --system --home /var/lib/umbravia-forge-updater \
  --create-home --shell /usr/sbin/nologin umbravia-updater
sudo install -m 0755 deploy/auto-update.sh /usr/local/sbin/umbravia-forge-update
sudo install -m 0644 deploy/umbravia-forge-update.service /etc/systemd/system/
sudo install -m 0644 deploy/umbravia-forge-update.timer /etc/systemd/system/
sudo install -m 0640 -o root -g root \
  deploy/umbravia-forge-update.env.template /etc/umbravia-forge/update.env
```

Antes de activarlo hay que sustituir los marcadores de configuración, incluida
la URL de salud pública y `VITE_TURNSTILE_SITE_KEY` en `update.env`. La clave
privada `TURNSTILE_SECRET_KEY` se guarda exclusivamente en
`/etc/umbravia-forge/umbravia-forge.env`. No intercambie ambas claves ni copie
la privada al entorno de compilación. Después se ejecuta una comprobación
manual:

```text
sudo systemctl daemon-reload
sudo systemctl start umbravia-forge-update.service
sudo systemctl status umbravia-forge-update.service --no-pager
sudo systemctl enable --now umbravia-forge-update.timer
systemctl list-timers umbravia-forge-update.timer
```

El intervalo predeterminado es de 15 minutos. Se cambia mediante un override de
`systemd` sobre `OnUnitActiveSec`; no es necesario modificar el script ni la
aplicación. La ejecución usa un bloqueo exclusivo, por lo que una compilación
lenta nunca se solapa con la siguiente comprobación.

Para volver temporalmente a despliegues manuales, ejecute como root:

```text
sudo deploy/disable-automatic-updates.sh
```

El script desactiva y retira únicamente el temporizador y el área de trabajo
del actualizador. Conserva la release activa, el servicio principal, Caddy, la
base de datos y los archivos de entorno.

Los escaneos de Internet no se pueden impedir por completo. La defensa busca
que sean inofensivos y observables: Caddy corta las sondas conocidas, Express
normaliza y rechaza variantes codificadas o anidadas, limita métodos, tamaño de
URL, cuerpo, cabeceras, tiempos y reutilización de conexiones, y el paquete no
permite publicar archivos sensibles. Estas barreras se aplican igual con
cualquier dominio configurado. Peticiones legítimas a rutas inexistentes
siguen recibiendo la superficie genérica `404`.

## Red y base de datos

- El firewall solo debe permitir SSH administrado, HTTP 80 y HTTPS 443.
- `HOST` debe permanecer en `127.0.0.1`.
- PostgreSQL debe usar `listen_addresses = 'localhost'` y reglas `pg_hba.conf`
  limitadas al usuario y base de Umbravia.
- Una conexión PostgreSQL local puede usar `DATABASE_SSL=false`; una base
  remota debe usar TLS con verificación de certificado.
- Las copias PostgreSQL cifradas y los perfiles opcionales de volumen se
  describen en
  [`docs/ENCRYPTION-IN-TRANSIT-AND-AT-REST.md`](../docs/ENCRYPTION-IN-TRANSIT-AND-AT-REST.md).
- La política XTS-AES-256 para volúmenes y el comprobador no destructivo se
  describen en
  [`docs/STORAGE-ENCRYPTION-POLICY.md`](../docs/STORAGE-ENCRYPTION-POLICY.md).
- Antes de datos reales deben probarse copia, restauración y reversión de una
  versión completa.

# Despliegue en Linux

Esta guía complementa `README.md` para distribuciones Linux con `systemd`.
Ubuntu Server 24.04 es el primer entorno objetivo, pero el paquete, el proceso
Node y el comprobador no dependen de `apt` ni de una distribución concreta.
También son aplicables a Debian, Fedora/RHEL, openSUSE y Arch cuando dispongan
de las versiones requeridas. No se instalan ni activan servicios
automáticamente: cada fase se valida antes de abrir tráfico.

## 1. Requisitos

- Distribución Linux mantenida con `systemd` y herramientas GNU básicas.
- Node.js 24 y npm 11.18.0 o posterior dentro de la rama 11. Versiones
  anteriores no aplican de forma compatible la lista fijada de scripts nativos.
- Caddy 2.10 o posterior.
- PostgreSQL local restringido a `localhost`, o una instancia remota con TLS.
- Acceso SSH mediante clave y un usuario con `sudo`.
- DNS apuntando a la IP del servidor.

No se debe ejecutar Node como `root`. El paquete tampoco debe contener
`node_modules` creados en otro sistema: se instalan nuevamente en el Linux de
destino. La unidad localiza Node mediante un `PATH` explícito que admite tanto
`/usr/local/bin/node` como `/usr/bin/node`; no se deben crear enlaces globales
para adaptar el servidor al servicio.

## 2. Perímetro de red

Antes de habilitar el firewall, confirmar que el acceso SSH por clave funciona
en una segunda sesión. Después, permitir únicamente SSH administrado, HTTP y
HTTPS. En Ubuntu o Debian con UFW puede usarse:

```text
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

En una distribución que utilice `firewalld`, deben habilitarse los servicios
equivalentes `ssh`, `http` y `https` en la zona pública y hacer persistente la
configuración. No se deben mezclar UFW y `firewalld`; se usa la herramienta
propia de la distribución y se comprueba su estado antes de cerrar la segunda
sesión SSH.

Los puertos 3001 y 5432 no se publican. Node escucha en `127.0.0.1:3001` y,
cuando PostgreSQL comparte servidor, escucha únicamente en localhost.

## 3. Preparar la versión

Instalar Node y Caddy desde una fuente mantenida para la distribución o desde
los binarios oficiales verificando su integridad. Crear las cuentas y carpetas
descritas en `README.md`. Copiar
`.deployment-package` a una carpeta nueva bajo
`/opt/umbravia-forge/releases/<version>` y ejecutar allí:

```text
sudo npm ci --omit=dev
sudo npm rebuild argon2 --foreground-scripts
sudo chown -R root:umbravia /opt/umbravia-forge/releases/<version>
sudo chmod -R o-rwx /opt/umbravia-forge/releases/<version>
```

La reconstrucción se limita al módulo Argon2id revisado y fijado por versión en
`package.json`. La comprobación posterior realiza un hash y una verificación
reales antes de activar la versión.

El archivo de entorno se crea fuera de la versión, en
`/etc/umbravia-forge/umbravia-forge.env`, con propietario `root`, grupo
`umbravia` y modo `0640`. No se reutilizan secretos de desarrollo o staging.

## 4. Validar antes de activar

Copiar el servicio y el Caddyfile a sus destinos, pero no iniciar aún la
aplicación. Desde la carpeta de la versión ejecutar:

```text
sudo UMBRAVIA_ENV_FILE=/etc/umbravia-forge/umbravia-forge.env \
  ./deploy/check-linux-readiness.sh
```

No se continúa si el comprobador detecta una versión incompatible, artefactos
incompletos, dependencias ausentes, marcadores de ejemplo, permisos inseguros o
configuraciones inválidas de Caddy y `systemd`. Si se habilita Stripe Billing,
el modo Test o Live debe coincidir con el perfil, la clave debe ser restringida,
el secreto debe pertenecer al webhook y los Prices mensual y anual deben ser
distintos. El comprobador valida la forma sin mostrar secretos; no sustituye la
prueba humana del Checkout, portal, renovación, fallo y recuperación de cobro.

## 5. Activación y comprobación

Tras superar la validación, actualizar de forma atómica el enlace
`/opt/umbravia-forge/current`, recargar `systemd` y arrancar la aplicación.
Después recargar Caddy y comprobar:

```text
curl --fail http://127.0.0.1:3001/api/health/live
curl --fail http://127.0.0.1:3001/api/health
curl --fail https://<dominio-configurado>/api/health
```

Las comprobaciones ofensivas o de carga sobre el perímetro público se aplazan
hasta disponer de un entorno controlado y autorizado. La activación inicial
solo continúa si la salud local y la servida por el dominio configurado son
correctas.

## 6. Observación y reversión

- Revisar `journalctl -u umbravia-forge` sin registrar secretos.
- Revisar `/var/log/caddy/umbravia-forge-access.log` para detectar aumentos de
  sondas o errores.
- Verificar periódicamente espacio, memoria, certificado, copias y restauración.
- Conservar la versión anterior y revertir el enlace si la salud o los flujos
  esenciales fallan.

## 7. Actualización automática opcional

`auto-update.sh` y las unidades `umbravia-forge-update.*` permiten consultar
`origin/main` cada 15 minutos. El flujo solo acepta avances descendientes del
commit activo; nunca despliega una versión anterior ni una historia divergente.
Cada candidato se construye en un árbol aislado, se instala como una release
inmutable y debe superar las comprobaciones local y pública antes de quedar
activo. Consulte `README.md` para instalar el usuario de construcción, el
archivo `/etc/umbravia-forge/update.env` y el temporizador.

La automatización no sustituye las copias de seguridad ni autoriza cambios
incompatibles de esquema. Las migraciones destructivas deben seguir teniendo
un procedimiento explícito, probado y reversible antes de entrar en `main`.

Los escaneos automáticos continuarán existiendo mientras haya una IP pública.
El objetivo es que no alcancen datos ni procesos internos, respondan de forma
uniforme y queden observables. Ataques volumétricos superiores a la capacidad
del servidor requieren una futura capa exterior como WAF/CDN.

## Límites de portabilidad

El código y el paquete son portátiles entre arquitecturas soportadas por Node y
sus dependencias, siempre que `npm ci` se ejecute en el destino. La unidad
incluida usa `systemd`; distribuciones con OpenRC u otro supervisor necesitan un
adaptador de servicio equivalente antes de considerarse soportadas. Esa
diferencia no requiere cambiar la aplicación.

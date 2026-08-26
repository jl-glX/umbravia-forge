# Despliegue de Umbravia Forge en servidor propio

Fecha: 3 de agosto de 2026

## Arquitectura objetivo

- **Aplicación:** servidor Linux con Node.js 24 LTS.
- **Datos normales:** PostgreSQL en una instancia separada o en el mismo
  servidor con acceso restringido.
- **MVP autocontenido:** SQLite únicamente para demostraciones y pruebas sin
  requisitos de alta disponibilidad.
- **Entrada HTTPS:** proxy inverso como Nginx o Caddy.
- **Proceso:** servicio del sistema o gestor equivalente con reinicio
  controlado.
- **Interfaz:** React compilado y servido por Express desde `dist/public`.
- **API:** Express escuchando solo en la interfaz y puerto configurados.

## Preparación disponible

El proyecto incluye:

- controlador PostgreSQL y migraciones versionadas;
- pool con límites, tiempos de espera y TLS configurable;
- comprobación estricta de variables de producción;
- compilación reproducible de cliente y servidor;
- paquete de despliegue independiente del proveedor;
- endpoints `/api/health/live` y `/api/health`;
- validación local de la configuración PostgreSQL sin abrir conexiones.
- selección efectiva del cliente PostgreSQL compartido en `staging` y
  `production`;
- gestor coordinado para crear entornos SQLite aislados e inventariar su futura
  promoción.

El cliente compartido ya selecciona PostgreSQL cuando lo exige el perfil. Esto
no sustituye la prueba contra una instancia de staging autorizada: el despliegue
real sigue bloqueado hasta comprobar migraciones, persistencia y restauración.

## Perfiles de entorno

Los subdominios por centro y la frontera de varios nodos se documentan en
[`TENANT-SUBDOMAINS.md`](./TENANT-SUBDOMAINS.md) y
[`PORTABILITY-AND-MULTI-NODE.md`](./PORTABILITY-AND-MULTI-NODE.md). Mantener
`TENANT_SUBDOMAINS_ENABLED=false` hasta validar el wildcard completo. En la
topología vigente de un solo proceso, `BACKGROUND_JOBS_ENABLED=true`; una futura
réplica web debe usar `false` y dejar las tareas a un único nodo designado.

| Perfil        | Uso                            | Datos                     | Protección obligatoria                                                  |
| ------------- | ------------------------------ | ------------------------- | ----------------------------------------------------------------------- |
| `development` | trabajo local                  | SQLite y datos demo       | configuración local                                                     |
| `demo`        | MVP autocontenido y desechable | SQLite sin datos críticos | acceso restringido                                                      |
| `staging`     | ensayo previo al lanzamiento   | PostgreSQL independiente  | mismas barreras que producción                                          |
| `production`  | servicio real                  | PostgreSQL                | HTTPS, antiabuso, correo verificado, secretos y datos demo desactivados |

Los perfiles se seleccionan con `APP_ENV`. `staging` y `production` comparten
las mismas validaciones de seguridad para evitar que el lanzamiento dependa de
corregir diferencias de última hora. Cada entorno debe tener base de datos,
credenciales, dominio, cola de correo y secretos propios.

Las plantillas disponibles son:

- `.env.example` para desarrollo;
- `.env.staging.example` para el ensayo real;
- `.env.production.example` para producción.

No se debe copiar un `.env` entre entornos. Solo se copia la estructura y se
inyectan secretos diferentes desde el servidor.

## Construcción y paquete

```text
npm ci
npm run ci:validate
npm run deploy:package
npm ci --omit=dev --prefix .deployment-package
```

`deploy:package` comprueba que la compilación contiene la barrera antiabuso
propia y que no reaparecen dependencias de un CAPTCHA externo. Los secretos de
correo se inyectan únicamente en el servidor y nunca se incorporan al cliente.

El paquete resultante queda en `.deployment-package`. No contiene ningún
archivo `.env`, datos SQLite ni secretos. La plantilla neutral permanece bajo
`deploy/umbravia-forge.env.template` y se copia fuera de la versión antes de
introducir los secretos. El paquete debe copiarse a una nueva versión del
servidor y activarse mediante un enlace o cambio atómico que permita volver a
la versión anterior.
Nunca se deben copiar los `node_modules` generados en Windows: la instalación
`npm ci --omit=dev` se repite en Linux para obtener dependencias compatibles con
el servidor. Esto es obligatorio para Argon2id y `better-sqlite3`, cuyos
módulos nativos se resuelven para la plataforma donde se ejecuta `npm ci`.
Antes de activar la versión se ejecuta
`deploy/check-linux-readiness.sh` con el archivo de entorno definitivo.

### Continuidad de pestañas durante un despliegue

`index.html` se entrega con `Cache-Control: no-store`; los módulos Vite con hash
se entregan como inmutables. Una pestaña abierta antes del cambio atómico puede
seguir ejecutando el índice anterior y solicitar por primera vez un módulo
diferido que ya no está en la release activa. El cliente trata
`vite:preloadError` como una señal de cambio de release y recarga una sola vez.
El marcador temporal de `sessionStorage` impide bucles; si la nueva carga sigue
fallando, una barrera de errores presenta una acción de recarga traducida en
lugar de dejar el documento vacío.

Una pantalla en blanco tras un despliegue se diagnostica contrastando el
`script[src]` de la pestaña y el módulo que aparece en la consola con los
recursos de la release activa. Una recarga completa recupera una pestaña creada
antes de incorporar esta defensa, pero no sustituye la revisión del servicio,
la salud y el commit activo.

## Variables mínimas

```text
NODE_ENV=production
APP_ENV=production
PORT=3001
HOST=127.0.0.1
DATABASE_PROVIDER=postgresql
DATABASE_URL=<secreto de PostgreSQL>
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# Copias PostgreSQL cifradas; solo se guarda el destinatario publico age.
UMBRAVIA_BACKUP_AGE_RECIPIENT=age1...
UMBRAVIA_BACKUP_DIRECTORY=/var/backups/umbravia-forge/postgresql
UMBRAVIA_BACKUP_RETENTION_DAYS=30
CLIENT_ORIGIN=https://<dominio>
WEBAUTHN_ORIGIN=https://<dominio>
WEBAUTHN_RP_ID=<dominio sin protocolo>
TURNSTILE_SECRET_KEY=<clave privada de Cloudflare Turnstile>
MFA_ENCRYPTION_KEY=<clave aleatoria segura>
EMAIL_VERIFICATION_ENABLED=true
SMTP_HOST=<relay SMTP o 127.0.0.1>
SMTP_PORT=<puerto SMTP>
SMTP_SECURE=<true para TLS implicito>
SMTP_REQUIRE_TLS=<true para exigir STARTTLS>
SMTP_USER=<opcional; siempre junto a SMTP_PASSWORD>
SMTP_PASSWORD=<secreto opcional>
EMAIL_FROM=<remitente verificado>
EMAIL_QUEUE_ENCRYPTION_KEY=<clave aleatoria segura de 32 bytes en base64>
PRIVATE_CONTENT_ENCRYPTION_ENABLED=true
PRIVATE_CONTENT_ENCRYPTION_KEY=<clave nueva de 32 bytes en base64url>
EMAIL_PUBLIC_MAIL_HOST=<host publico del MTA propio>
EMAIL_DKIM_SELECTOR=<selector DKIM publicado>
EMAIL_PUBLIC_DNS_CHECK=<warn durante preparacion; strict antes de correo real>
EMAIL_PUBLIC_INBOUND_ENABLED=false
SUPPORT_NOTIFICATION_EMAIL=<buzon interno opcional>
SUPPORT_ATTACHMENT_MAX_BYTES=5242880
SUPPORT_MUTATION_RATE_LIMIT_MAX_REQUESTS=30
SEED_DEMO_DATA=false
COMMERCIAL_TRIALS_ENABLED=false
UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256=<sha256 del correo normalizado de la cuenta designada>

# Interfaz local de gestores: lista exacta de usuarios Linux no root.
UMF_MANAGER_ADMIN_LINUX_USERS=<usuario-operativo-autorizado>

# Suscripcion SaaS del centro; mantener cerrada hasta completar Stripe Live.
STRIPE_BILLING_ENABLED=false
STRIPE_BILLING_MODE=live
STRIPE_RESTRICTED_API_KEY=<clave restringida Live, solo en el gestor de secretos>
STRIPE_WEBHOOK_SECRET=<secreto del endpoint Live>
STRIPE_PRICE_FORGE_MONTHLY=<Price recurrente mensual Live>
STRIPE_PRICE_FORGE_ANNUAL=<Price recurrente anual Live distinto>
STRIPE_PORTAL_CONFIGURATION_ID=<configuracion Live opcional del portal>

# Cobros directos del centro; mantener cerrado hasta validar Accounts v2.
STRIPE_CONNECT_ENABLED=false
STRIPE_CONNECT_MODE=live
STRIPE_CONNECT_RESTRICTED_API_KEY=<clave restringida Connect Live>
STRIPE_CONNECT_WEBHOOK_SECRET=<secreto del endpoint Connect Live>
```

El hash de la jefatura inicial no es una contraseña ni concede acceso por sí
solo. Únicamente permite que ese buzón cree la primera identidad
`corporate_support` cuando no existe ninguna inicialización corporativa. Debe
calcularse fuera del repositorio e incorporarse al entorno protegido antes del
registro. La cuenta crea una contraseña propia y debe verificar el buzón con el
reto ordinario de seis cifras. Solo entonces se insertan dirección y jefatura.

El flujo falla cerrado si `corporateBootstrapState` o un cargo activo de
jefatura pertenecen a otra identidad. Puede completar de forma idempotente las
relaciones parciales de la misma cuenta designada, pero no migra autoridad
desde una identidad `commercial`, aunque el correo coincida. La comprobación se
ejecuta tras verificar el buzón y también al autenticar por contraseña, 2FA,
passkey o una sesión corporativa aún válida; esto permite recuperar una cuenta
ya verificada después de desplegar la corrección sin recrearla.

La única limpieza automática admitida es el caso histórico inequívoco en el
que `umfSupportStaff`, `companyStaffProfiles` o `corporateBootstrapState`
apuntan a la identidad `commercial` con exactamente el mismo correo que la
cuenta corporativa configurada y verificada. Se retiran solo esas relaciones;
el usuario comercial, su contraseña, membresías y borrado programado se
conservan. Los conflictos con otra dirección no se reparan automáticamente.
Antes de sanear una jefatura afectada por cualquier otro conflicto se ejecuta
primero, con el entorno real del servicio, la simulación:

```text
npm run company:reset-support-identity -- --corporate-email <correo-soporte> --confirm-corporate-email <correo-soporte> --legacy-commercial-email <correo-comercial-con-relaciones-mal-ubicadas> --confirm-legacy-commercial-email <mismo-correo-comercial>
```

El JSON debe indicar `commercialAccountDeleted: false` y unos recuentos
compatibles con la persona que se pretende sanear. Solo tras revisar esos
recuentos se repite el mismo comando con `--apply`. La herramienta exige
`DATABASE_PROVIDER=postgresql` y `DATABASE_URL`, no abre SQLite por omisión y
se bloquea si encuentra otra persona corporativa o una jefatura ajena. La
opción del correo comercial solo elimina relaciones corporativas históricas;
no elimina ni modifica la fila comercial, su contraseña, membresías, datos,
`platformOperators` o solicitudes de eliminación.

Después del saneamiento se registra la cuenta de soporte desde
`/umf-support/access` con el correo designado. Hay que comprobar la entrega del
código, su consumo, el inicio de sesión corporativo y la permanencia intacta de
la cuenta comercial antes de considerar terminada la intervención. Los
comandos antiguos de provisión o reanudación de jefatura ya no forman parte del
producto.
`UMF_MANAGER_ADMIN_LINUX_USERS` no concede por sí sola autoridad de aplicación.
El comando local comprueba primero Linux, el rechazo de `root` y la allowlist;
solo después abre la base y exige un operador comercial verificado para
`commercial`, o dirección corporativa y jefatura activas para `support`. No
publica una consola web, una API administrativa ni una terminal de red.

`DATABASE_SSL=false` solo corresponde a PostgreSQL en el mismo servidor y
limitado a `localhost`. Si la base está en otra máquina, debe usarse TLS con
verificación de certificado. `TURNSTILE_SECRET_KEY` es un secreto del servidor:
no debe incorporarse al frontend ni al repositorio. La clave pública
`VITE_TURNSTILE_SITE_KEY` se configura por separado en el entorno de
compilación del actualizador.

La puesta en marcha de las copias cifradas y los perfiles opcionales de
almacenamiento están documentados en
[`ENCRYPTION-IN-TRANSIT-AND-AT-REST.md`](ENCRYPTION-IN-TRANSIT-AND-AT-REST.md).
La clave de contenido privado es independiente de las claves MFA y de correo;
la automatización no la genera ni la rota. Su activación y la frontera futura
de Signal Protocol se documentan en
[`PRIVATE-COMMUNICATION-SECURITY.md`](PRIVATE-COMMUNICATION-SECURITY.md).

Stripe Billing no es un requisito para arrancar una instalación que todavía no
ofrece suscripciones SaaS: `STRIPE_BILLING_ENABLED=false` mantiene cerradas sus
rutas de pago. Si se activa, el arranque falla ante una clave, modo, Prices o
secreto incompletos. Staging solo admite objetos Test. Producción Live requiere
además el recorrido humano de pago, renovación, autenticación, impago,
cancelación, factura, webhook retrasado y reconciliación descrito en
[`STRIPE-BILLING.md`](STRIPE-BILLING.md).

Stripe Connect tampoco es requisito de arranque. Su interruptor, clave y
webhook son independientes de Stripe Billing. Antes de activarlo deben aplicarse
la migración 57 y el recorrido Sandbox descrito en
[`STRIPE-CONNECT.md`](STRIPE-CONNECT.md). No reutilizar el secreto del webhook
SaaS ni presentar una cuenta creada como lista para cobrar sin capacidades de
tarjeta y payouts activas.

## Verificación de correo y entrega transaccional

Producción exige `EMAIL_VERIFICATION_ENABLED=true`. Las altas permanecen
pendientes hasta completar el código enviado al buzón; el código se conserva
como hash, expira y limita los intentos. La cola cifra los destinatarios y el
contenido mediante AES-256-GCM, recupera trabajos interrumpidos y aplica
reintentos acotados con espera creciente. El historial técnico no almacena
credenciales SMTP.

Hay dos configuraciones compatibles:

- relay externo: puerto 587 con `SMTP_REQUIRE_TLS=true` y credenciales;
- MTA propio: Postfix en `127.0.0.1:25`, sin autenticacion y sin TLS en el salto
  de loopback. Postfix se responsabiliza de la cola, reintentos, TLS saliente y
  entrega.

El segundo modelo no elimina los requisitos operativos del correo publico. Se
necesitan dominio propio, PTR/rDNS, SPF, DKIM, DMARC, puerto saliente 25,
gestion de rebotes, lista de supresion, monitorizacion y reputacion de IP. El
relay local nunca debe escuchar como relay abierto en una interfaz publica.
La arquitectura y sus límites se detallan en `FORGE-NOTIFY.md`.

Para el MTA propio, publique un host de correo sin proxy y configure el
PTR/rDNS de la IP con el mismo nombre. Después publique SPF, DKIM y DMARC y
compruebe el conjunto con:

```text
npm run mail:dns:check -- --env /etc/umbravia-forge/umbravia-forge.env --strict
```

No active `EMAIL_PUBLIC_DNS_CHECK=strict` hasta haber publicado los registros;
una vez activo, una release no se declarará preparada si el DNS de correo deja
de ser coherente.

La entrega saliente propia no exige anunciar recepción. Mantenga
`EMAIL_PUBLIC_INBOUND_ENABLED=false` hasta que Postfix tenga destinos de
entrada, antispam, rebotes y supresiones. Publicar el MX y cambiar el valor a
`true` son la última acción de esa futura fase, no un requisito del transporte
saliente.

Antes del despliegue puede revisarse la configuración sin conectar:

```text
npm run db:postgres:validate-config
```

## Red y proxy

- Exponer públicamente solo los puertos 80 y 443.
- Mantener `HOST=127.0.0.1` para que el puerto de Node.js sea accesible
  únicamente desde el proxy local. Cambiarlo solo dentro de una red o contenedor
  expresamente aislado.
- Limitar PostgreSQL a la red privada o a `localhost` cuando comparta servidor.
- Configurar HTTPS, HSTS y renovación automática de certificados en el proxy.
- Mantener TLS 1.3 en el salto público y en el origen Caddy. La política TLS de
  Cloudflare se valida de forma independiente a la configuración del origen.
- Enviar al proceso Node.js un único salto de proxy de confianza.
- Restringir SSH por clave, usuario sin privilegios y firewall.

Los archivos aplicables están en `deploy/Caddyfile` y
`deploy/umbravia-forge.service`. La guía de instalación y verificación está en
`deploy/README.md`. El `Caddyfile` requiere Caddy 2.10 o posterior por el límite
exterior de cuerpo; siempre debe ejecutarse `caddy validate` antes de recargar.
Las defensas no dependen de un hostname fijo: el dominio se configura en Caddy
y debe coincidir con los orígenes confiables y el RP ID de WebAuthn. La
aplicación sigue escuchando exclusivamente en loopback.

## PostgreSQL

La primera prueba debe usar una base vacía de staging. El orden recomendado es:

1. crear usuario y base exclusivos con privilegios mínimos;
2. verificar TLS y conectividad desde la aplicación;
3. ejecutar y revisar las migraciones;
4. comprobar integridad referencial y recuentos;
5. validar autenticación, reservas, facturación y ciclo de cuentas;
6. reiniciar aplicación y base para comprobar persistencia;
7. ensayar copia de seguridad y restauración antes de admitir datos reales.

El gestor puede inspeccionar cada SQLite y preparar un plan por categorías. Los
datos no se transfieren automáticamente. Cualquier traslado requiere detener
escrituras, identificar el destino, respaldar, clasificar datos reales y
ficticios, excluir credenciales efímeras, cargar por dependencias, comparar
recuentos y conservar una vía de reversión.

## Operación y recuperación

- Ejecutar el proceso con un usuario del sistema sin acceso administrativo.
- Reiniciar ante fallos con límites para evitar bucles.
- Rotar y conservar logs sin incluir secretos ni datos sensibles.
- Monitorizar salud, espacio, memoria, certificados y conexiones de base.
- Hacer copias cifradas de PostgreSQL y probar periódicamente su restauración.
- Mantener al menos una versión anterior desplegable.
- Aplicar actualizaciones primero en staging y después en producción.

## Primera puesta en marcha

1. Preparar un servidor de staging independiente.
2. Instalar Node.js, PostgreSQL o su cliente, y el proxy HTTPS.
3. Crear usuarios del sistema y reglas de firewall.
4. Configurar secretos fuera del repositorio.
5. Validar el cliente PostgreSQL compartido y sus migraciones.
6. Construir y desplegar una versión inmutable.
7. Confirmar salud, autenticación, passkeys, antiabuso, correo y reservas.
8. Reiniciar todos los servicios y comprobar persistencia.
9. Probar copia, restauración y reversión de versión.

## Promoción de staging a producción

1. etiquetar el mismo commit validado en staging;
2. volver a construir desde el lockfile, sin copiar `node_modules`;
3. crear una copia de seguridad previa de producción;
4. revisar las migraciones pendientes y su reversibilidad;
5. desplegar una carpeta de versión nueva;
6. cambiar secretos y dominios mediante el entorno, nunca en el código;
7. ejecutar comprobaciones de salud antes de abrir tráfico;
8. mantener la versión anterior disponible para reversión rápida.

La promoción mueve código, no bases de datos ni archivos `.env`. Los datos de
staging nunca se convierten en datos de producción.

No se deben procesar datos reales ni abrir tráfico comercial antes de completar
estas comprobaciones.

## Perímetro Cloudflare

La base de Cloudflare para el dominio público y Turnstile está activada; las
decisiones verificadas y el endurecimiento todavía pendiente se mantienen en
[`FUTURE-CLOUDFLARE-EDGE.md`](./FUTURE-CLOUDFLARE-EDGE.md). El proxy no
sustituye los controles de Caddy y Express, ni demuestra la identidad de red
del correo saliente. El cierre directo del origen, las reglas WAF adicionales y
cualquier cambio DNS requieren comprobación operativa y reversión propia.

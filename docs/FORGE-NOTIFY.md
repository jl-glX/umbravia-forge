# Forge Notify: correo transaccional propio

## Propósito

Forge Notify es la frontera interna de correo transaccional de Umbravia Forge.
La aplicación controla las plantillas, la cola, el cifrado, los reintentos, la
trazabilidad y la coordinación con otros gestores. El transporte final se hace
mediante SMTP, tanto con un relay autorizado como con un MTA local.

```text
Cuenta o Forge Support
        -> plantilla localizada
        -> cola cifrada
        -> trabajador de entrega
        -> SMTP/MTA
        -> servidor de correo destinatario
```

Esta separación permite cambiar el transporte sin reescribir el registro, la
verificación o Forge Support.

## Capacidades implementadas

- verificación de correo mediante códigos de seis cifras;
- códigos almacenados como hashes, con caducidad y límite de intentos;
- plantillas de cuenta y soporte separadas del transporte;
- cola persistente con estados pendiente, procesando, enviado y fallido;
- cifrado AES-256-GCM del destinatario, asunto y cuerpo mientras están
  pendientes;
- reintentos acotados con espera creciente;
- recuperación de trabajos que quedaron en procesamiento por un cierre
  inesperado;
- purga de cargas cifradas ya entregadas o agotadas;
- registro técnico de intentos y errores sin almacenar la contraseña SMTP;
- avisos al gestor de seguridad y recursos cuando una entrega queda pendiente;
- notificaciones opcionales al buzón interno de Forge Support.

## Límite frente a Resend o Postmark

Forge Notify ya cubre la capa de aplicación que ofrecen esos servicios: API
interna, plantillas, cola, reintentos y observabilidad. No es por sí solo una
red pública de entrega de correo. La entrega fiable a Internet sigue necesitando
una de estas dos opciones:

1. un relay SMTP autorizado;
2. un MTA propio, por ejemplo Postfix, aislado y correctamente operado.

Un MTA propio requiere dominio, PTR/rDNS, SPF, DKIM, DMARC, TLS saliente,
gestión de rebotes y quejas, lista de supresión, reputación de IP y
monitorización. No debe exponerse como relay abierto. Hasta validar estas piezas
no se debe prometer una entregabilidad equivalente a un proveedor especializado.

## Configuración

Producción exige:

```text
EMAIL_VERIFICATION_ENABLED=true
SMTP_HOST=<relay o 127.0.0.1>
SMTP_PORT=<25, 465 o 587 según el transporte>
SMTP_SECURE=<true solo para TLS implícito>
SMTP_REQUIRE_TLS=<true para exigir STARTTLS>
SMTP_USER=<opcional, junto a SMTP_PASSWORD>
SMTP_PASSWORD=<opcional, junto a SMTP_USER>
EMAIL_FROM=<remitente válido del dominio>
EMAIL_QUEUE_ENCRYPTION_KEY=<32 bytes aleatorios en base64>
EMAIL_PUBLIC_MAIL_HOST=<host publico del MTA, por ejemplo mail.example.com>
EMAIL_DKIM_SELECTOR=<selector DKIM publicado>
EMAIL_PUBLIC_DNS_CHECK=<warn durante preparacion; strict antes de correo real>
EMAIL_PUBLIC_INBOUND_ENABLED=<false hasta preparar recepcion; true exige MX>
```

`EMAIL_QUEUE_ENCRYPTION_KEY` no debe reutilizarse como clave MFA ni guardarse
en Git. La rotación futura necesitará descifrar o agotar la cola anterior antes
de retirar la clave antigua.

Cuando se usa un MTA local, `npm run mail:dns:check -- --env <archivo>` revisa
MX, resolución directa, PTR/rDNS, SPF, DKIM y DMARC sin imprimir secretos. El
chequeo de Linux muestra avisos mientras se prepara el DNS y pasa a bloquear la
activación cuando `EMAIL_PUBLIC_DNS_CHECK=strict`.

## Preparación reproducible del MTA local

`deploy/configure-mail.sh` convierte la propuesta de infraestructura en una
operación verificable. Por defecto solo muestra el plan:

```text
./deploy/configure-mail.sh plan
```

La aplicación exige una ejecución explícita como `root` para instalar y
configurar. Mantiene Postfix en `loopback-only`, crea un firmador OpenDKIM
dedicado, conserva cualquier clave DKIM ya existente y genera un manifiesto
público en `/etc/umbravia-forge-mail/dns-records.txt`. La configuración del
firmador se mantiene fuera de `/etc/umbravia-forge`, porque ese directorio
contiene el entorno secreto de la aplicación y no debe hacerse accesible al
usuario `opendkim`. Si una instalación anterior dejó una clave en
`/etc/umbravia-forge/mail`, el instalador la copia de forma conservadora al
nuevo directorio, sin borrarla ni regenerarla. No edita el archivo de
entorno de la aplicación, no abre el puerto 25 y no activa la recepción de
correo.

Si detecta un `opendkim.service` ajeno ya activo, se detiene en lugar de
reemplazarlo. Antes de tocar Postfix conserva una copia de `main.cf` bajo
`/var/backups/umbravia-forge-mail/` y la restaura si falla la activación.

La cola de la aplicación limita cada entrega a cinco intentos antes de ceder el
mensaje al transporte. Una vez aceptado por Postfix, el MTA reintenta con una
espera progresiva de cinco minutos a una hora y elimina como no entregables los
mensajes que lleven un día en cola. Postfix controla esta segunda frontera por
antigüedad, no por un contador exacto, evitando colas permanentes sin convertir
una interrupción breve del destinatario en una pérdida inmediata.

Ejemplo de preparación del servidor, indicando la IP pública sin convertirla
en una constante del repositorio:

```text
sudo UMBRAVIA_PUBLIC_IPV4=<IP_PUBLICA> \
  ./deploy/configure-mail.sh apply
```

Después se revisa el manifiesto sin mostrar la clave privada:

```text
sudo cat /etc/umbravia-forge-mail/dns-records.txt
```

Los registros A, SPF, DKIM y DMARC se publican en Cloudflare solo después de
compararlos con los existentes. El host `mail` debe quedar en **DNS only**. El
MX se mantiene deliberadamente sin publicar hasta que la recepción tenga
destinos definidos, antispam, manejo de rebotes, supresiones y una prueba de
relay abierto. La clave privada permanece exclusivamente en el servidor.

El comprobador distingue las dos fronteras. Con
`EMAIL_PUBLIC_INBOUND_ENABLED=false` valida host, PTR, SPF, DKIM y DMARC sin
exigir un MX. Solo cuando el valor pasa explícitamente a `true` comprueba que
el MX apunta al MTA propio. Esto evita anunciar recepción antes de disponer de
destinos, antispam y tratamiento de rebotes.

## Ciclo de verificación

1. El registro supera la barrera antiabuso y las validaciones de cuenta.
2. La cuenta se crea como `pending_verification`.
3. Se genera un código ligado a la cuenta y con caducidad.
4. Forge Notify cifra y persiste el mensaje antes de intentar entregarlo.
5. El trabajador entrega o programa un nuevo intento.
6. El usuario presenta el código; la API verifica el hash, los intentos y la
   caducidad.
7. La cuenta pasa a activa y se registra el evento de seguridad.

Cambiar la configuración nunca activa silenciosamente cuentas pendientes.

## Mantenimiento y observabilidad

El gestor de recursos ejecuta el mantenimiento de la cola y publica señales
coordinadas. Deben vigilarse como mínimo:

- antigüedad del mensaje pendiente más antiguo;
- número de reintentos y trabajos agotados;
- porcentaje de entrega y latencia;
- fallos TLS o de autenticación SMTP;
- rebotes, quejas y supresiones cuando exista entrada de eventos del MTA;
- espacio ocupado por historial y cargas pendientes.

Los logs no deben contener códigos de verificación, contraseñas, cuerpos de
mensajes ni destinatarios completos.

## Trabajo futuro delimitado

- receptor autenticado de rebotes y quejas;
- lista de supresión por destinatario y motivo;
- gestión y rotación asistida de claves DKIM desde el gestor de entorno;
- métricas y panel operativo de entregabilidad;
- plantillas versionadas con previsualización;
- API para otros productos Umbravia con scopes, cuotas e idempotencia;
- rotación de claves de cola con envoltura de claves.

Estas ampliaciones deben conservar el transporte detrás de la misma interfaz;
no deben acoplar la lógica de cuenta o soporte a Postfix ni a un proveedor.

# Forge Notify: correo transaccional propio

## Propósito

Forge Notify es la frontera interna de correo transaccional de Umbravia Forge.
El gestor de correo controla las plantillas, la cola, el cifrado, los reintentos
y la trazabilidad. El coordinador de gestores administra sus conexiones con
cuentas, soporte, recursos y entornos, evita ámbitos solapados y distribuye las
confirmaciones o alertas saneadas. El transporte final se hace mediante SMTP,
tanto con un relay autorizado como con un MTA local.

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
- cifrado AES-256-GCM autenticado y versionado del destinatario, asunto y
  cuerpo mientras están pendientes, con lectura compatible del formato
  anterior;
- reintentos acotados con espera creciente;
- recuperación de trabajos que quedaron en procesamiento por un cierre
  inesperado;
- purga de cargas cifradas ya entregadas o agotadas;
- registro técnico de intentos y errores sin almacenar la contraseña SMTP;
- confirmaciones y avisos del gestor de correo distribuidos por el coordinador;
- notificaciones opcionales al buzón interno de Forge Support;
- panel administrativo del gestor de correo sin destinatarios, cuerpos ni
  valores de claves;
- auditoría explícita de los canales y mantenimiento manual coordinado de la
  cola.

## Interconexión entre gestores

El coordinador conserva un registro cerrado de conexiones compatibles:

- Cuentas puede consultar si verificación y recuperación están disponibles;
- Soporte puede consultar recepción, respuestas y notificaciones;
- Entornos puede incorporar la preparación del correo a su diagnóstico;
- Recursos puede programar el mantenimiento de la cola en el ámbito compartido
  `notification-delivery`.

El gestor de correo gestiona, confirma y avisa. El coordinador valida cada
enlace, impide operaciones simultáneas sobre el mismo ámbito y distribuye sus
señales. Ninguna de estas conexiones autoriza leer o modificar archivos de
seguridad, material criptográfico o valores de secretos.

Los datos que atraviesan una conexión aprobada se encapsulan con
XChaCha20-Poly1305 y datos autenticados que fijan consumidor, proveedor y
capacidad. Los mensajes que el coordinador conserva para distribuir avisos
permanecen cifrados mientras están almacenados en memoria. La capacidad y el
estado de la clave pertenecen al gestor de cifrado; el coordinador aplica el
control sin obtener ni publicar el valor de la clave.

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
EMAIL_PUBLIC_INBOUND_PROVIDER=<cloudflare o postfix>
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

La configuración reproducible usa IPv4 para la entrega saliente mientras el
IPv6 del servidor no publique y valide su propia identidad SMTP completa
(AAAA, PTR/rDNS, autorización SPF y pruebas de recepción). Esta decisión no
afecta al proxy web de Cloudflare ni a Email Routing. Evita que una entrega
salga ocasionalmente por una dirección que no comparte la reputación y la
autenticación verificadas de IPv4.

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
destino, autenticación y una prueba controlada. Forge Support recibe mediante
Cloudflare Email Routing y un Email Worker; no necesita publicar Postfix ni
convertir el servidor en receptor SMTP. La clave privada permanece
exclusivamente en el servidor.

El comprobador distingue las dos fronteras. Con
`EMAIL_PUBLIC_INBOUND_ENABLED=false` valida host, PTR, SPF, DKIM y DMARC sin
exigir un MX. Cuando el valor pasa explícitamente a `true`, el proveedor
`postfix` exige que el MX apunte al MTA propio y el proveedor `cloudflare`
exige un MX de Email Routing, mientras las comprobaciones de salida siguen
validando el host, PTR, SPF y DKIM del MTA. Esto evita confundir la red proxy
web de Cloudflare, el IPv6 real del servidor y la identidad SMTP saliente.

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

El gestor de correo ejecuta y confirma el mantenimiento de la cola. El gestor de
recursos conserva únicamente la programación periódica, previa autorización del
coordinador. Deben vigilarse como mínimo:

- antigüedad del mensaje pendiente más antiguo;
- número de reintentos y trabajos agotados;
- porcentaje de entrega y latencia;
- fallos TLS o de autenticación SMTP;
- rebotes, quejas y supresiones cuando exista entrada de eventos del MTA;
- espacio ocupado por historial y cargas pendientes.

Los logs no deben contener códigos de verificación, contraseñas, cuerpos de
mensajes ni destinatarios completos.

Cada 30 días, el saneador conserva únicamente el resultado técnico mínimo de
las entregas terminadas y elimina su vínculo con la cuenta, destinatario,
idioma, carga cifrada, identificador SMTP, caducidad y próxima ejecución. Se
mantienen el tipo, estado, contador de intentos, código de error normalizado y
fechas necesarias para métricas agregadas y diagnóstico. Las entregas todavía
pendientes o en reintento no se alteran. La versión 2 del saneador fuerza una
ejecución única al desplegarse para retirar también los metadatos que la versión
anterior conservaba; después vuelve al intervalo normal de 30 días.

### Verificación con Outlook

La aceptación SMTP (`status=sent`) solo acredita que Microsoft recibió el
mensaje. Para verificar su clasificación hay que revisar el origen del mensaje
recibido y confirmar:

- `spf=pass`, `dkim=pass`, `dmarc=pass` y alineación del dominio;
- que la IP y el saludo SMTP corresponden al host de correo esperado;
- `BCL:0` para correo transaccional no masivo;
- el valor `X-MS-Exchange-Organization-SCL`: 5 o 6 significa que Microsoft lo
  clasificó como spam aunque la autenticación sea correcta.

Cuando la autenticación pasa y el SCL continúa alto, no se deben rotar claves
ni alterar DNS a ciegas. La causa restante es reputación o clasificación del
destinatario. El operador debe solicitar acceso a Microsoft SNDS para la IP
saliente, activar el programa de informes de correo no deseado y remitir a
Microsoft una muestra legítima clasificada por error. Esta gestión es manual y
no requiere guardar credenciales de Microsoft en el servidor ni en Git.

## Trabajo futuro delimitado

- receptor autenticado de rebotes y quejas;
- lista de supresión por destinatario y motivo;
- gestión y rotación asistida de claves DKIM desde el gestor de entorno;
- métricas avanzadas de entregabilidad;
- plantillas versionadas con previsualización;
- API para otros productos Umbravia con scopes, cuotas e idempotencia;
- rotación de claves de cola con envoltura de claves.

Estas ampliaciones deben conservar el transporte detrás de la misma interfaz;
no deben acoplar la lógica de cuenta o soporte a Postfix ni a un proveedor.

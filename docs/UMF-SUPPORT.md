# UMF Support

## Propósito y frontera

UMF Support es la aplicación corporativa para atender incidencias de la
plataforma Umbravia Forge y gestionar el canal de correo corporativo. No es el
panel que cada centro usa para atender a sus socios:

| Ámbito           | Aplicación                                          | Autoridad y datos                                                                                        |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Centro deportivo | Forge Support, `/support`, API `/api/support`       | Membresía activa del centro; tickets, agentes y conocimiento aislados por `facilityId`                   |
| Plataforma       | UMF Support, `/umf-support`, API `/api/umf-support` | Personal corporativo aprobado en `umfSupportStaff`; tablas y permisos independientes de cualquier centro |

Una cuenta administradora de centro no puede entrar en UMF Support. Pertenecer
a UMF Support tampoco concede acceso a un centro. La interfaz reutiliza
componentes técnicos básicos, pero usa una presentación sobria propia y no la
identidad visual de la pantalla comercial.

En `staging` y `production`, UMF Support reside en el PostgreSQL seleccionado
por la aplicación, igual que la parte comercial. No existe actualmente una
segunda base física. La separación es lógica y obligatoria: cuentas
clasificadas por realm, cookies distintas, relaciones corporativas propias y
tablas de tickets/correo de plataforma separadas de las tablas con
`facilityId`. Una consulta o relación cruzada sigue debiendo fallar cerrada
aunque ambas aplicaciones compartan el motor.

La autorización corporativa vuelve a comprobar el ámbito dentro del servicio:
una fila `umfSupportStaff` cruzada o corrupta no convierte una identidad
`commercial` en personal de soporte.

Las identidades pertenecen a ámbitos explícitos: `commercial` y
`corporate_support`. Un mismo correo puede existir en ambos, pero son dos filas
de cuenta, contraseñas, recuperaciones, retos y sesiones independientes. La
aplicación comercial usa `umbravia-forge_session` y UMF Support usa
`umf-support_session`; ninguna de las dos cookies se acepta en la otra API.

La aplicación sigue siendo web y no anuncia ni entrega actualmente un
instalador. El ZIP de lanzadores Windows se conserva únicamente como evidencia
histórica y reproducible de pruebas anteriores; no constituye un canal vigente
de UMF Support. Cualquier reapertura del empaquetado corporativo requiere una
decisión explícita, firma y nueva validación humana; véase
[Paquete de aplicaciones web para Windows](./WINDOWS-WEB-APP-PACKAGE.md).

## Capacidades implementadas

- inicio de sesión específico en el portal `support`, incluido el segundo
  factor cuando la cuenta lo tiene activo;
- creación de una identidad corporativa independiente mediante nombre,
  apellidos, correo y contraseña, sin consultar ni reutilizar cuentas del realm
  comercial;
- contraseña corporativa creada en el registro y reto ordinario de verificación
  del buzón, con código de seis cifras, hash en reposo, quince minutos de
  vigencia y cinco intentos;
- centro de cuenta reducido después de verificar el correo: la persona puede
  iniciar sesión para gestionar contraseña, MFA, passkeys, sesiones y correo
  de acceso, pero sigue sin permisos sobre tickets, correo operativo ni
  administración hasta que dirección la aprueba;
- bootstrap único de la primera jefatura para el correo corporativo cuya huella
  SHA-256 está declarada fuera del repositorio. Solo actúa después de verificar
  el buzón o de autenticar de nuevo una cuenta ya verificada, y rechaza otra
  identidad o una jefatura previamente reclamada;
- personal corporativo con roles `director` y `agent`, revocable sin alterar
  las membresías de centros;
- panel de altas y bajas de cuentas administrativas y espacios de colaboración
  con capacidades explícitas, reducidas y revocables;
- cola de tickets con categorías, prioridad, estado, asignación, objetivos de
  primera respuesta y resolución;
- categoría propia de privacidad y derechos;
- mensajes entrantes, salientes y notas internas cifrados con el dominio de
  contenido privado de UMF Support;
- bandejas de entrada, borradores, programados, salida y enviados, con redacción
  a múltiples destinatarios, CC/CCO, asuntos, texto e hiperenlaces HTTPS o
  `mailto:` saneados;
- borradores cifrados, envío inmediato o programado y cancelación segura antes
  de que una entrega haya comenzado;
- respuestas por la cola transaccional existente, sin guardar tarjetas ni
  credenciales de proveedor;
- preferencias personales de alertas por tipo de evento y canal, desactivadas
  por defecto; el correo es el canal prioritario y Web Push permanece opcional;
- receptor servidor-a-servidor con firma HMAC reciente, deduplicación por
  `Message-ID`, rechazo de adjuntos y alias de respuesta ligados al ticket y al
  correo solicitante;
- eventos de seguridad sin correos en claro para invitaciones, registros,
  verificaciones, cambios de personal y accesos al contenido privado;
- cambio del correo de acceso mediante contraseña actual y código enviado al
  nuevo buzón, con aviso al anterior e invalidación de las demás sesiones y de
  retos temporales anteriores.

La dirección de UMF Support exige simultáneamente una fila activa de director
en `umfSupportStaff` y el cargo activo de jefatura en
`companyStaffProfiles`. `platformOperators` queda reservado a la autoridad de
la plataforma comercial y no permite iniciar sesión ni autorizar operaciones
corporativas. Ninguna ruta de soporte consulta una contraseña, cookie,
membresía o solicitud de eliminación comercial para completar el alta.

El registro y la verificación crean exclusivamente la identidad
`corporate_support`. Para cuentas ordinarias no crean `umfSupportStaff`,
`facilityMemberships`, `platformOperators` ni un cargo de empresa: una cuenta
verificada puede abrir una sesión corporativa limitada a su propio centro de
cuenta y la autorización operativa sigue fallando cerrada hasta que dirección
la aprueba. La única excepción es el bootstrap inicial descrito a continuación.
La cuenta comercial que use el mismo correo, incluida cualquier solicitud de
borrado programada, no se consulta ni se modifica durante estos flujos.

La excepción inicial no depende de una cuenta comercial, del orden de registro
ni de la antigüedad. `UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256` contiene fuera
del repositorio la huella del correo normalizado elegido por la instalación.
Tras verificar ese buzón, o en el siguiente acceso correcto si ya estaba
verificado, una transacción idempotente crea la dirección activa, el cargo
`platform_head` y el marcador singleton. Un valor ausente o inválido, otro
correo o una jefatura ya reclamada fallan cerrados. La contraseña, 2FA y
passkeys siguen siendo propios del realm corporativo.

Si una versión anterior dejó las tres relaciones de jefatura ligadas a la
identidad `commercial` del mismo correo, el bootstrap retira únicamente esas
relaciones corporativas inválidas antes de crear las correctas. La fila
comercial, sus credenciales, membresías y solicitud de borrado permanecen
intactas. Una relación perteneciente a otro correo o a otra identidad
corporativa no se sanea automáticamente y bloquea la operación.

`npm run company:designate-head -- --email <correo> --confirm-email <correo>`
permanece como herramienta local de diagnóstico y recuperación: solo muestra
el plan salvo que se añada `--apply`, exige PostgreSQL explícito y no puede
transferir una jefatura existente.

## Administración mínima y colaboración

El flujo vigente mantiene una administración deliberadamente pequeña. La
dirección consulta cuentas corporativas, aprueba las que ya verificaron su
buzón, cambia entre `director` y `agent` y puede revocar el acceso sin modificar
la identidad ni ninguna cuenta comercial. Los espacios de colaboración son
contenedores separados, desactivables y con capacidades seleccionadas por la
dirección; no convierten a la persona colaboradora en administradora general.

`companyStaffProfiles` conserva únicamente la señal de `platform_head` que
protege la jefatura inicial y la autoridad local de gestores. El organigrama
amplio, las áreas y las delegaciones quedan como modelo de datos histórico o
borrador futuro: no se publican como flujo vigente de la API ni de la interfaz.

Los gestores internos son infraestructura compartida por la plataforma
comercial y UMF Support. Tienen un único administrador local en Linux; no se
publica una consola web ni rutas `/umf-support/managers/*`. Cada operación del
administrador debe declarar de forma inequívoca el ámbito `commercial` o
`support`, y el gestor de dominio conserva la autorización y los datos de ese
ámbito. Las delegaciones corporativas no conceden por sí solas acceso al
administrador local de gestores. Para seleccionar `support`, el proceso debe
ejecutarse sin `root` por un usuario incluido en
`UMF_MANAGER_ADMIN_LINUX_USERS`, y la cuenta debe ser una identidad
`corporate_support` activa y verificada con dirección activa y cargo
`platform_head` activo. Las señales y operaciones mostradas quedan limitadas a
`support`.

La cola compartida de correo almacena también el ámbito. Las activaciones,
respuestas, recuperación y cambio de correo corporativos se encolan como
`support`; los flujos de centros y cuentas comerciales se encolan como
`commercial`. El trabajador conserva esa marca en reintentos y señales de
error. La migración PostgreSQL 44 prepara esta separación para datos
existentes, pero su aplicación en producción requiere una comprobación
operativa independiente.

Las migraciones PostgreSQL 45 y 46 y sus equivalentes de SQLite conservan las
solicitudes y estructuras organizativas anteriores para trazabilidad y
saneamiento. El flujo vigente no lee ni escribe
`umfSupportAccessCredentials`, no emite códigos de activación de 24 horas y no
traslada relaciones desde usuarios `commercial`. Las rutas públicas antiguas
de solicitud y activación y los comandos de provisión y reanudación siguen
retirados.

## Correo profesional y alertas

El panel no pretende sustituir a un cliente de correo generalista. Reúne las
operaciones necesarias para soporte: entrada, borradores, programados, salida,
enviados y respuestas asociadas a tickets. Los borradores almacenan cifrados el
asunto, el cuerpo y las listas Para/CC/CCO. Al enviar se crean entregas
individuales `platformScope = support`; CCO nunca se expone a otros
destinatarios. El editor acepta texto y enlaces Markdown controlados
`[etiqueta](https://...)` o `mailto:` y escapa HTML arbitrario.

La programación exige una fecha futura. La cancelación comprueba dentro de la
transacción que todas las entregas sigan en cola y no hayan alcanzado su hora;
si el trabajador ya comenzó una entrega, la operación falla cerrada. La
interfaz no muestra errores SMTP privados: solo un estado normalizado y el
número de incidencias de entrega.

La disponibilidad del correo se calcula por sentido y no mediante un aviso
genérico. El servidor distingue el transporte saliente, la protección cifrada
de su cola, la dirección corporativa entrante, Email Routing y el webhook. La
configuración tampoco se presenta como prueba operativa: una entrega
`platformScope = support` marcada como enviada aporta evidencia saliente y un
mensaje `email/inbound` aceptado y persistido aporta evidencia entrante. El
panel explica exactamente qué condición falta y deja de mostrar el aviso de un
sentido cuando existe configuración y evidencia para ese sentido. Ninguno de
estos estados expone secretos ni convierte una fila en prueba de que el correo
llegó a la bandeja final del destinatario.

Cada miembro corporativo configura sus propias alertas para tickets,
conversaciones, correo entrante, retroalimentación e informes de problema. El
interruptor general y todos los canales empiezan desactivados; verificar o
aprobar una cuenta no la suscribe. El correo se envía al buzón corporativo
verificado de esa persona. Web Push requiere además configuración VAPID fuera
del repositorio y autorización expresa de cada dispositivo; la lista de
navegadores compatibles es una comprobación de cliente, no una frontera de
autorización. No existe todavía una aplicación Android ni push nativo FCM/APNs.

## Saneamiento de una identidad corporativa anterior

El reinicio operativo es deliberadamente distinto de una migración o una
fusión de cuentas. Su simulación identifica únicamente la identidad
`corporate_support`, sus retos/sesiones por cascada, las invitaciones del
correo, entregas `platformScope = support` y relaciones corporativas. De forma
opcional puede retirar relaciones de soporte que una versión histórica dejó en
un usuario `commercial`, pero la fila comercial, sus credenciales,
membresías, solicitudes de eliminación, datos de centro y
`platformOperators` se conservan.

El comando solo admite PostgreSQL configurado explícitamente, exige repetir los
correos y funciona en simulación salvo que se añada `--apply`:

```text
npm run company:reset-support-identity -- --corporate-email <correo-soporte> --confirm-corporate-email <correo-soporte>
npm run company:reset-support-identity -- --corporate-email <correo-soporte> --confirm-corporate-email <correo-soporte> --legacy-commercial-email <correo-comercial-con-relaciones-mal-ubicadas> --confirm-legacy-commercial-email <mismo-correo-comercial>
```

Solo después de revisar el JSON de simulación se repite el comando exacto con
`--apply`. Falla sin modificar datos si detecta otra persona corporativa, si
la jefatura pertenece a una identidad distinta de las declaradas o si no puede
resolver con precisión el propietario del estado. Tras el saneamiento, la
cuenta corporativa se registra desde cero, verifica su buzón por el flujo web
vigente y, si su correo coincide con la huella configurada y no existe otra
jefatura, completa automáticamente el bootstrap. La orden local queda como vía
de recuperación explícita si el automatismo no puede aplicarse.

## Flujo de una solicitud de privacidad

```text
persona interesada
  -> correo corporativo publicado
  -> Cloudflare Email Routing y Worker dedicado
  -> webhook HTTPS firmado
  -> ticket UMF-* de privacidad
  -> revisión por personal corporativo autorizado
  -> respuesta en UMF Support
  -> cola cifrada y transporte saliente
  -> estado de entrega disponible en Enviados
```

El asunto se clasifica como privacidad cuando contiene expresiones inequívocas
de acceso, rectificación, supresión, oposición, portabilidad o protección de
datos en los idiomas mantenidos. El personal puede corregir la categoría. La
clasificación ayuda al enrutamiento, pero no decide si el derecho procede ni
sustituye la verificación de identidad y la revisión humana.

No se debe publicar una dirección de privacidad hasta demostrar el circuito de
extremo a extremo con correo externo: recepción, deduplicación, creación de un
único ticket, respuesta, autenticación del alias, entrega, rebote y registro de
la actuación. Aceptar un mensaje en la cola no demuestra que haya llegado a la
bandeja de entrada.

## Configuración desactivada por defecto

La salida utiliza Forge Notify y su transporte configurado. La entrada
corporativa permanece cerrada mientras no se habiliten estos nombres en el
entorno autorizado, con valores reales fuera de Git:

```text
EMAIL_PUBLIC_INBOUND_ENABLED=true
EMAIL_PUBLIC_INBOUND_PROVIDER=cloudflare
UMF_SUPPORT_EMAIL_INBOUND_ENABLED=true
UMF_SUPPORT_EMAIL_ADDRESS=privacy@example.com
UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY=<32 bytes aleatorios en base64>
UMF_SUPPORT_EMAIL_WEBHOOK_SECRET=<otros 32 bytes aleatorios en base64>
```

Los dos secretos deben ser exclusivos de UMF Support. No se reutilizan las
claves del soporte de centros, MFA, contenido privado, cola, DKIM ni gestores.

Las lecturas y escrituras de mensajes fallan cerradas en un perfil de
producción si el cifrado de contenido privado no está habilitado. El código no
genera ni rota la clave: el entorno debe activar y validar el material ya
gestionado conforme a la documentación de cifrado.

El Worker de `cloudflare/support-email/` es deliberadamente genérico y puede
desplegarse como una instancia corporativa separada con:

```text
SUPPORT_INBOUND_ENDPOINT=https://app.example.com/api/internal/umf-support-email
SUPPORT_INBOUND_WEBHOOK_SECRET=<mismo secreto corporativo del webhook>
```

La instancia y la regla de Email Routing de UMF Support deben estar separadas
de las usadas por Forge Support. No se habilita un `catch-all`. Configurar estos
nombres no autoriza a crear o rotar secretos desde el repositorio.

## API

```text
GET    /api/umf-support/distribution
GET    /api/umf-support/recovery/capabilities
POST   /api/umf-support/recovery/request
POST   /api/umf-support/recovery/reset-password
POST   /api/umf-support/register
POST   /api/umf-support/verify-email
POST   /api/umf-support/resend-verification
POST   /api/umf-support/login
POST   /api/umf-support/mfa/verify
POST   /api/umf-support/passkeys/options
POST   /api/umf-support/passkeys/verify
GET    /api/umf-support/session
POST   /api/umf-support/logout
GET    /api/umf-support/capabilities
GET    /api/umf-support/staff
GET    /api/umf-support/administrator-accounts
POST   /api/umf-support/administrator-accounts/:userId/approve
PATCH  /api/umf-support/staff/:userId
GET    /api/umf-support/collaboration-spaces
POST   /api/umf-support/collaboration-spaces
PATCH  /api/umf-support/collaboration-spaces/:spaceId
GET    /api/umf-support/tickets
POST   /api/umf-support/tickets
GET    /api/umf-support/tickets/:ticketId
PATCH  /api/umf-support/tickets/:ticketId
POST   /api/umf-support/tickets/:ticketId/messages
GET    /api/umf-support/mailbox/:direction
GET    /api/umf-support/mail/drafts
POST   /api/umf-support/mail/drafts
PUT    /api/umf-support/mail/drafts/:draftId
POST   /api/umf-support/mail/drafts/:draftId/send
POST   /api/umf-support/mail/drafts/:draftId/cancel
GET    /api/umf-support/notification-settings
PUT    /api/umf-support/notification-settings
POST   /api/umf-support/push-subscriptions
DELETE /api/umf-support/push-subscriptions/:subscriptionId
POST   /api/internal/umf-support-email
POST   /api/umf-support/account/security/email-change/request
POST   /api/umf-support/account/security/email-change/confirm
```

Las mutaciones rechazan campos desconocidos y tienen límites específicos. Las
aprobaciones, rechazos y cambios de personal exigen una sesión autenticada con
verificación humana reciente. El webhook interno no utiliza sesión del
navegador: valida la firma sobre los bytes exactos y su antigüedad.
La edición de usuarios de un centro no puede sustituir el correo de acceso:
ese cambio pertenece exclusivamente al flujo verificado de la propia cuenta.
La interfaz se ofrece tanto en `Cuenta > Seguridad` como en la vista de
plantilla de UMF Support, sin que su disponibilidad dependa de ocupar un cargo
corporativo.

## Validación y límites operativos

Las pruebas del repositorio demuestran la separación frente a administradores
de centros, la independencia de credenciales y cookies, la aprobación separada
del buzón verificado, el bootstrap configurado e idempotente de jefatura y su
recuperación local, el cifrado de
borradores, la programación y cancelación, el saneamiento de hiperenlaces, el
ámbito de las entregas, la separación de preparación entrante/saliente y las
preferencias de alertas por persona. Las
migraciones PostgreSQL 47 y 48 incorporan borradores, preferencias y
suscripciones, y el puente de datos incluye las tres tablas. Nada de ello
demuestra que esas migraciones estén aplicadas en una base viva ni que DNS,
Worker, SMTP, rebotes, Web Push o entregabilidad estén operativos en
producción.

Antes de operar públicamente siguen siendo necesarias:

1. la configuración de un buzón y una instancia corporativa del Worker;
2. la prueba externa de entrada, respuesta, duplicado, rechazo, rebote y
   entregabilidad;
3. una política aprobada de conservación, bloqueo, exportación y supresión de
   tickets y correo;
4. el procedimiento humano para verificar identidad, alcance y plazos de una
   solicitud de derechos;
5. completar los datos identificativos y la revisión descritos en
   [Política de privacidad](./PRIVACY-POLICY.md) y
   [Preparación legal](./LEGAL-READINESS.md).

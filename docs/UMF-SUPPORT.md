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
- registro cerrado: una dirección no preautorizada no crea cuenta, solicitud,
  contraseña retenida ni correo en cola;
- inicialización única de la primera jefatura únicamente para el correo cuyo
  SHA-256 normalizado está designado fuera del repositorio;
- contraseña corporativa creada en el registro y reto ordinario de verificación
  del buzón, con código de seis cifras, hash en reposo, quince minutos de
  vigencia y cinco intentos;
- preautorización posterior creada por dirección con correo, nombre, apellidos,
  idioma y rol exactos; la persona invitada no puede modificar el rol ni la
  identidad declarada al registrarse;
- personal corporativo con roles `director` y `agent`, revocable sin alterar
  las membresías de centros;
- directorio de plantilla con cargos empresariales separados de la
  autorización: jefe de plataforma, responsable de área, jefe de equipo,
  personal y colaboración externa;
- cola de tickets con categorías, prioridad, estado, asignación, objetivos de
  primera respuesta y resolución;
- categoría propia de privacidad y derechos;
- mensajes entrantes, salientes y notas internas cifrados con el dominio de
  contenido privado de UMF Support;
- bandejas de entrada y enviados con el estado disponible de la cola de
  entrega;
- respuestas por la cola transaccional existente, sin guardar tarjetas ni
  credenciales de proveedor;
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

Mientras no exista `corporateBootstrapState`, personal corporativo ni plantilla
corporativa, el correo que coincide con
`UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256` puede registrarse. El código enviado
al buzón verifica el correo y solo entonces se crean la dirección de soporte y
el cargo `platform_head`. Si ya existe cualquier inicialización corporativa,
la excepción falla cerrada: no traslada autoridad desde una cuenta comercial
ni ofrece un camino de recuperación por compatibilidad.

Las incorporaciones posteriores comienzan en el panel de dirección. La
preautorización fija correo, nombre, apellidos y rol. La persona invitada crea
su contraseña en la pantalla de registro y verifica ese mismo buzón. Disponer
de una identidad `corporate_support` no concede acceso hasta que la
verificación haya materializado la pertenencia autorizada.

## Plantilla, módulos y delegaciones

`companyStaffProfiles` describe el organigrama visible. El cargo empresarial no
abre rutas, no selecciona centros y no concede acceso a gestores. El trabajo
diario de soporte se autoriza con `umfSupportStaff` y las responsabilidades
corporativas delegadas se registran en `corporateRoleAssignments`.

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

La jefatura de plataforma cubre automáticamente los módulos sin responsable.
Una asignación activa o una delegación pendiente dirigida a personal activo
detiene esa cobertura solo para el módulo correspondiente. La persona receptora
puede aceptar o rechazar la delegación; después de aceptarla puede renunciar al
permiso. Al revocar, rechazar, renunciar o eliminar legítimamente la asignación,
el módulo vuelve a la cobertura automática si no existe otra persona capaz de
decidir sobre una delegación pendiente. La jefatura puede habilitarse también
de forma explícita en un módulo delegado.

Una cuenta de soporte aprobada no entra por sí sola en la plantilla. La
jefatura debe incorporarla desde el directorio y asignarle un cargo empresarial
que, por sí mismo, no abre ningún módulo. Retirar a una persona conserva la
trazabilidad, revoca sus asignaciones técnicas activas y retira sus delegaciones
pendientes o aceptadas; los módulos vuelven entonces a la cobertura vacante.
La jefatura inicial no puede modificarse desde este flujo ordinario.

La vía normal de incorporación posterior parte de una invitación creada por
dirección. No existe una solicitud pública de rol ni una pantalla que permita
a una persona elegir sus propios permisos. La invitación no guarda contraseña:
solo preautoriza la identidad declarada y el rol. El registro crea una fila
`corporate_support` pendiente, una contraseña independiente y una sesión
corporativa; la verificación del buzón activa la cuenta y materializa el rol
preautorizado. Nunca se crea una fila en `facilityMemberships`.

La migración PostgreSQL 45 y la equivalente de SQLite mantienen legibles las
solicitudes históricas para trazabilidad y saneamiento. El flujo vigente no
lee ni escribe `umfSupportAccessCredentials`, no emite códigos de activación de
24 horas y no traslada relaciones desde usuarios `commercial`. Las rutas
públicas antiguas de solicitud y activación, los comandos de provisión y
reanudación y sus servicios ejecutables se han retirado.

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
primera jefatura se registra desde cero con el correo designado y verifica su
buzón por el flujo web vigente.

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
UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256=<sha256 hexadecimal del correo normalizado>
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
GET    /api/umf-support/access-requests
POST   /api/umf-support/access-requests/invite
GET    /api/umf-support/staff
PATCH  /api/umf-support/staff/:userId
GET    /api/umf-support/company-staff
PATCH  /api/umf-support/company-staff/:userId
GET    /api/umf-support/company-delegations
POST   /api/umf-support/company-delegations
POST   /api/umf-support/company-delegations/:delegationId/respond
POST   /api/umf-support/company-roles/:profileId/renounce
POST   /api/umf-support/company-roles/:profileId/self-enable
GET    /api/umf-support/tickets
POST   /api/umf-support/tickets
GET    /api/umf-support/tickets/:ticketId
PATCH  /api/umf-support/tickets/:ticketId
POST   /api/umf-support/tickets/:ticketId/messages
GET    /api/umf-support/mailbox/:direction
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
de centros, el consumo único del código, el hash persistido, la independencia
de tablas, la firma del correo entrante, su deduplicación y la clasificación de
privacidad. No demuestran que DNS, Worker, SMTP, rebotes o entregabilidad estén
activos en producción.

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

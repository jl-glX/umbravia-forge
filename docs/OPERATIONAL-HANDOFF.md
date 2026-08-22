# Relevo operativo

Este documento define cómo retomar el trabajo en Umbravia Forge sin depender
del contexto de una conversación anterior. Es una referencia saneada y apta
para el repositorio: no debe contener direcciones de servidores, nombres del
panel del proveedor, tickets, rutas privadas, credenciales, secretos ni valores
de claves.

El estado vivo prevalece siempre sobre este documento y sobre cualquier
historial de trabajo.

## Continuidad del cambio activo — 22 de agosto de 2026

- El código activo ya no crea ni reconoce un centro implícito o privilegiado.
  Las rutas de tenant exigen un perfil y una membresía activos; los permisos de
  plataforma usan `platformOperators`, aprovisionado de forma controlada.
- Las rutas que necesitan un centro devuelven el código estable
  `FACILITY_MEMBERSHIP_REQUIRED` cuando la cuenta no tiene una membresía
  activa. Clases, reservas, pagos y Forge Support del centro lo traducen a una
  explicación equivalente en los cuatro catálogos, sin mostrar el texto técnico
  inglés del servidor. Un rol insuficiente conserva el código general
  `FORBIDDEN` y no se confunde con la ausencia de centro.
- Los perfiles de compatibilidad heredados quedan cerrados y con sus membresías
  suspendidas, conservando el identificador original para trazabilidad. Los
  backfills actuales sin destino usan `legacy-import-quarantine`, también
  cerrado. Antes de trasladar esos datos debe revisarse su propiedad; ninguno
  de esos ámbitos es un tenant operativo ni una vía de autorización.
- La base de Stripe admite un modo Test o Live explícito. Separa los Customers
  por modo, exige producción y HTTPS para Live, registra la sesión vigente y
  falla cerrado ante eventos o Prices ajenos. La preparación del código no
  demuestra que existan Prices, impuestos, credenciales o endpoints Live en el
  entorno operativo.
- Forge Analytics incorpora una línea base administrativa por centro con
  membresías activas, altas, participación y cancelación en el periodo. Esa
  vista permanece aislada por tenant y no se entrega al contrato del
  entrenador.
- El alta inicial de administradores y la creación posterior de pruebas usan
  el mismo interruptor `COMMERCIAL_TRIALS_ENABLED` en producción. La API
  pública expone solo su disponibilidad booleana para que la interfaz falle
  cerrada, sin revelar configuración privada.
- Los eventos operativos de factura de Stripe conservan solo una alerta mínima
  y reconcilian la Subscription actual. Analytics y CRM aplican en el servidor
  los permisos comerciales del centro; tarjetas, facturas, reintentos,
  reembolsos y disputas permanecen en Stripe.
- Las migraciones y pruebas del repositorio no demuestran que una base
  PostgreSQL externa se haya migrado. Siguen pendientes la copia/restauración y
  la validación cruzada en un entorno autorizado antes de producción.
- UMF Support es una aplicación web corporativa distinta del soporte de cada
  centro. Una identidad `corporate_support` activa y verificada puede iniciar
  sesión únicamente en su centro de cuenta y gestionar sus propios controles
  de seguridad. Tickets, correo operativo y administración exigen además una
  pertenencia activa en `umfSupportStaff`; `platformOperators` queda en el
  ámbito comercial. El registro crea una cuenta corporativa separada y exige
  verificar el buzón, pero no concede pertenencia ni rol a cuentas ordinarias.
  Dirección aprueba después las cuentas administrativas. La primera jefatura
  es la única excepción: el correo corporativo cuya huella SHA-256 está
  configurada fuera del repositorio recibe de forma transaccional `director` y
  `platform_head` tras verificar el correo o al volver a autenticarse si ya
  estaba verificado. Una cuenta administradora de centro no recibe acceso
  corporativo por su rol.
- Ambas aplicaciones usan el proveedor de datos configurado; en producción,
  UMF Support está dentro del mismo PostgreSQL, con realms, relaciones y tablas
  lógicamente separados. No debe afirmarse que existe una segunda base física.
  Compartir motor tampoco autoriza consultas cruzadas ni fusiona identidades.
- Un mismo correo puede corresponder a una identidad `commercial` y otra
  `corporate_support`, pero no comparten fila de usuario, contraseña,
  recuperación ni cookie. La aplicación principal usa
  `umbravia-forge_session` y soporte `umf-support_session`; las pruebas de
  aislamiento cubren el rechazo cruzado.
- El cierre y la eliminación física de cuenta pertenecen solo al realm
  `commercial`. El servicio rechaza identificadores corporativos y el ejecutor
  filtra también los trabajos vencidos por realm. La regresión automatizada
  elimina una cuenta comercial y confirma que la cuenta de UMF Support con el
  mismo correo permanece activa y puede iniciar sesión.
- La autenticación corporativa pendiente de aprobación tampoco consulta la
  solicitud de borrado comercial. La regresión específica mantiene el trabajo
  comercial en estado `scheduled`, abre solo el centro de cuenta corporativo y
  confirma que las capacidades operativas responden con acceso denegado hasta
  que dirección active la pertenencia de soporte.
- La administración corporativa vigente se limita a altas, bajas y roles
  `director`/`agent`, más espacios de colaboración de privilegio reducido. El
  organigrama amplio queda como borrador no publicado. `companyStaffProfiles`
  conserva la señal mínima `platform_head`, separada de los permisos diarios.
  El bootstrap automático exige una huella válida en
  `UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256`, falla cerrado ante otra jefatura y
  no consulta ni modifica identidades `commercial`. `company:designate-head`
  permanece como recuperación local: funciona primero en simulación, exige
  PostgreSQL, repite el correo y solo actúa sobre una identidad
  `corporate_support` activa y verificada. Si detecta relaciones de jefatura
  históricas en la identidad `commercial` del mismo correo, el bootstrap
  retira solo esas relaciones inválidas y conserva usuario, credenciales,
  membresías y borrado comercial. Cualquier otra persona sigue bloqueando la
  operación. Las rutas y
  comandos antiguos de solicitud, activación, provisión y reanudación se han
  retirado. El saneamiento
  `company:reset-support-identity` funciona primero en simulación, conserva
  expresamente la identidad comercial y se bloquea ante otra persona o
  jefatura no declarada.
- La interfaz ya no presenta esa compatibilidad como organigrama: UMF Support
  se muestra como un panel de trabajo individual cuyo nombre puede editar cada
  persona con acceso activo. La migración PostgreSQL 50 añade
  `umfSupportStaff.workspaceName`; un valor nulo conserva el nombre localizado
  predeterminado y no cambia permisos. `director`/`agent` quedan registrados
  como deuda técnica interna y no deben ampliarse; su retirada futura exige
  sustituirlos por propiedad del panel y capacidades explícitas sin romper el
  bootstrap ni las autorizaciones existentes.
- La terminal web/API de gestores y su tabla de credenciales se retiran. Los
  gestores son infraestructura interna compartida y disponen de un único
  administrador local Linux; cada flujo debe marcarse expresamente como
  `commercial` o `support`. No deben reaparecer enlaces de gestores en la
  cuenta comercial ni rutas `/umf-support/managers/*`.
- El administrador local rechaza `root` y exige que el usuario Linux figure en
  `UMF_MANAGER_ADMIN_LINUX_USERS` antes de inicializar, abrir o migrar la base
  y antes de resolver la cuenta. El ámbito
  `commercial` requiere identidad comercial verificada y operador comercial
  activo. El ámbito `support` requiere identidad corporativa verificada,
  dirección activa de UMF Support y cargo activo `platform_head`. Las vistas,
  operaciones y señales se filtran por el ámbito elegido; no existe una
  autoridad implícita compartida entre ambos.
- La cola de correo transaccional conserva `platformScope` en cada fila. Los
  flujos de cuentas y centros usan `commercial`; UMF Support usa `support`.
  Reintentos, caducidades y fallos publican señales con el ámbito persistido.
  La migración PostgreSQL 44 está preparada, pero debe aplicarse y comprobarse
  en el entorno autorizado antes de afirmar que la base viva está actualizada.
- El correo de una cuenta activa ya no puede cambiarse desde la administración
  de un centro. El flujo propio exige contraseña, verifica el nuevo buzón con
  un código temporal válido durante seis horas y mantiene el correo original
  hasta consumirlo. El correo actual recibe inmediatamente un aviso con enlace
  a recuperación. La caducidad cancela la solicitud mediante la limpieza de
  autenticación cada 30 minutos o al intentar confirmar; también puede
  cancelarse desde la interfaz. Al completar, cierra las demás sesiones,
  invalida retos anteriores y vuelve a avisar al correo sustituido. La interfaz
  pertenece a `Cuenta > Seguridad` para cualquier cuenta activa y verificada;
  no forma parte de la plantilla de UMF Support.
- UMF Support incorpora tickets, entrada, borradores, programados, salida y
  enviados; Para/CC/CCO; hiperenlaces HTTPS o `mailto:` saneados; contenido y
  borradores cifrados; categoría de privacidad y un webhook firmado. La barra
  superior incorpora un menú de funciones para que la jefatura consulte las
  altas administrativas comerciales de prueba y reenvíe su verificación sin
  conceder permisos comerciales a la identidad corporativa. Las
  alertas por tickets, conversaciones, entrada, retroalimentación e informes
  son preferencias personales y comienzan desactivadas. El correo es el canal
  prioritario; Web Push es opcional y requiere VAPID y autorización por
  dispositivo. Las migraciones 47 y 48 y el puente de datos cubren las tablas
  nuevas, pero el código y las pruebas no demuestran que el esquema vivo,
  buzón, DNS, Worker, SMTP, rebotes, push o entregabilidad estén configurados.
- La migración PostgreSQL 49 incorpora adjuntos salientes cifrados para el
  correo corporativo. Su tabla, almacenamiento y autorización están separados
  de los adjuntos de Forge Support de cada centro. La política común comprueba
  extensión y MIME, rechaza GIF y ejecutables y limita cada archivo y borrador.
  PDF e imágenes raster compatibles se previsualizan mediante descarga
  autenticada, `nosniff` y un visor no ejecutable; SVG, HTML, comprimidos y
  formatos sin renderizador seguro requieren descarga explícita. El webhook
  entrante todavía rechaza mensajes con adjuntos y no debe presentarse como una
  ingesta ya implementada.
- La actividad de seguridad visible conserva los últimos treinta días. La
  consulta aplica el mismo límite temporal y el planificador horario de ciclo
  de vida elimina del historial general los `securityEvents` anteriores, sin
  crear un temporizador adicional ni convertir este registro de producto en un
  archivo operativo indefinido.
- La preparación del correo corporativo se informa por sentido. El estado
  saliente separa transporte y cola cifrada; el entrante separa dirección,
  Email Routing, webhook y validez de configuración. Una entrega enviada con
  `platformScope = support` y un mensaje entrante persistido aportan evidencia
  operativa independiente, pero no sustituyen la prueba humana en el buzón
  final. La interfaz ya no presenta como fallo del envío una carencia exclusiva
  de recepción ni oculta una configuración inválida bajo un aviso genérico.
  La dirección mostrada se toma exclusivamente de
  `UMF_SUPPORT_EMAIL_ADDRESS`; nunca reutiliza `SUPPORT_EMAIL_ADDRESS`, que
  pertenece al soporte de los centros. Habilitar la entrada exige además los
  interruptores públicos, Email Routing y secretos corporativos exclusivos.
- Workers Builds dispone de una raíz reproducible en `cloudflare/` para la
  instancia `umbravia-forge-umf-support-email`. Reutiliza la entrada genérica
  de `cloudflare/support-email/src/index.ts`, mientras la configuración anidada
  conserva `umbravia-forge-support-email` para los centros. El proyecto se
  importa con raíz `/cloudflare`, sin comando de compilación ni Cloudflare
  Access; el endpoint se guarda como variable de ejecución y el secreto del
  webhook como secreto de ejecución. Esta preparación versionada no demuestra
  que el Worker, su regla de Email Routing o el flujo real estén activos.
- La política de privacidad mantenida está en `docs/PRIVACY-POLICY.md`, pero
  sigue pendiente completar el canal verificado, el domicilio publicable, el
  inventario de encargados y transferencias, los criterios de conservación y
  la revisión jurídica antes de un despliegue abierto.
- `npm run package:windows-web-apps` conserva un ZIP reproducible como evidencia
  de pruebas anteriores, pero no es un canal vigente de UMF Support. El portal
  corporativo declara distribución web en `/umf-support/access`, devuelve
  `installer: null` y no anuncia una descarga. La aplicación principal mantiene
  por separado su paquete portable. Cualquier reapertura del instalador
  corporativo exige una decisión explícita, firma y nueva validación humana.
- El HTML del cliente se sirve con `no-store` y los recursos con hash son
  inmutables. Una pestaña que permanece abierta durante un despliegue puede
  conservar el índice JavaScript anterior e intentar cargar después un módulo
  que ya no pertenece a la release activa. El arranque del cliente escucha
  `vite:preloadError`, realiza como máximo una recarga automática por ruta y
  minuto y deja una pantalla de recuperación traducida si el fallo persiste;
  así una transición de release no debe terminar en una pantalla en blanco ni
  en un bucle de recarga.
- La auditoría integral del cambio se conserva en
  `docs/UMF-SUPPORT-READINESS-AUDIT-2026-08-21.md`; la revisión específica de
  la credencial previa está en
  `docs/UMF-SUPPORT-PREAUTH-CREDENTIAL-AUDIT-2026-08-21.md`. La separación de
  identidades, gestores y correo se audita en
  `docs/IDENTITY-REALM-AND-MANAGER-BOUNDARY-AUDIT-2026-08-21.md`; el cambio de
  solicitudes de rol está en
  `docs/UMF-SUPPORT-ROLE-ACTIVATION-AUDIT-2026-08-22.md`; el registro cerrado y
  el reinicio de identidad se auditan en
  `docs/UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md`. La revisión
  vigente del correo y las alertas está en
  `docs/UMF-SUPPORT-MAIL-AND-NOTIFICATIONS-AUDIT-2026-08-22.md`. En esta sesión,
  `npm run ci:validate` pasó 49 controles de portabilidad, formato, lint, los
  tres `typecheck`, 119 archivos con 579 pruebas favorables y una prueba POSIX
  omitida por ejecutarse en Windows, las tres compilaciones, el paquete Windows
  y la auditoría de dependencias. La validación remota de cada publicación y la
  comprobación del entorno desplegado siguen siendo controles independientes.

## Fuentes y orden de autoridad

Antes de intervenir, contrastar las fuentes en este orden:

1. Estado vivo obtenido mediante comprobaciones de solo lectura.
2. Checkout y configuración versionada actuales.
3. Documentación mantenida en el repositorio.
4. Relevos, notas y conversaciones anteriores.

Una afirmación histórica nunca demuestra por sí sola que un commit esté
desplegado, un temporizador sea innecesario o una migración esté aplicada.

## Límites obligatorios

- No leer, copiar, registrar ni publicar valores de credenciales o claves.
- No sustituir, regenerar, mover ni eliminar archivos de entorno, claves
  privadas, certificados, material de firma o configuración de proveedores de
  seguridad como parte de una tarea ordinaria.
- No modificar controles de autenticación, cifrado, correo, CAPTCHA, proxy,
  cortafuegos o recuperación sin revisar primero su propósito, dependencias,
  impacto y vía de reversión.
- No modificar datos, migraciones, unidades del sistema ni temporizadores
  durante una inspección de estado.
- Preservar los cambios del usuario y separar cualquier trabajo ajeno al
  alcance solicitado.
- Detenerse y pedir una intervención humana concreta cuando hagan falta
  privilegios administrativos, acceso a un panel externo o decisiones sobre
  secretos.

Las reglas detalladas para configuración protegida están en
[AGENTS.md](../AGENTS.md) y [DEVELOPMENT.md](../DEVELOPMENT.md). El índice
[docs/README.md](./README.md) distingue documentación vigente de auditorías
históricas. Este relevo no los reemplaza.

## Comprobación inicial

Al empezar una tarea que pueda afectar al código o a producción:

1. Revisar la rama, el commit actual, el remoto, el estado del árbol de trabajo
   y el diff completo.
2. Buscar instrucciones y documentación existentes antes de crear archivos
   nuevos o duplicar reglas.
3. Determinar el alcance exacto del cambio y los archivos que podrían verse
   afectados.
4. Si la tarea afecta a producción, comprobar de forma no destructiva el
   servicio, su salud, la release activa y los mecanismos de actualización.
5. Si afecta a datos, comprobar el motor seleccionado y el esquema real de cada
   base implicada antes de editar migraciones.

Para activar Stripe Live, verificar además Product y Prices activos, portal,
endpoint y eventos Live —incluidos los estados de factura enumerados en
`docs/STRIPE-BILLING.md`—, permisos mínimos de la clave restringida, secreto de
firma, origen HTTPS y recorrido completo de pago, renovación, autenticación,
fallo, reconciliación y cancelación. Nunca reutilizar objetos ni Customers de
Test.

El hostname configurado dentro de Linux y el nombre del recurso en el panel del
proveedor son identificadores diferentes. Ambos pueden ser válidos y deben
registrarse por separado en el estado operativo privado.

## Servicio y despliegue activo

No considerar desplegado un commit solo porque esté en la rama remota o exista
un directorio de release. La comprobación debe relacionar, como mínimo:

- el commit publicado;
- la release seleccionada por el servicio;
- el proceso actualmente iniciado;
- la hora de activación;
- la respuesta del endpoint de salud correspondiente.

Cuando alguno de esos datos no sea accesible sin privilegios, registrar la
limitación y pedir la comprobación humana mínima. El procedimiento de despliegue
y reversión está documentado en [deploy/README.md](../deploy/README.md) y
[deploy/LINUX.md](../deploy/LINUX.md).

## Temporizadores y automatizaciones

Antes de calificar un temporizador como redundante u obsoleto, identificar:

- la unidad que activa y su comando efectivo;
- su frecuencia, próximo disparo y última ejecución;
- si está cargado, habilitado y activo;
- el checkout, release o datos sobre los que trabaja;
- sus validaciones, bloqueos y mecanismo de reversión;
- sus dependencias y posibles consumidores;
- el resultado de sus ejecuciones recientes.

La coincidencia parcial de nombres o finalidad no autoriza a desactivar una
unidad. Cualquier retirada requiere una decisión explícita después de comparar
los dos flujos completos.

## Bases de datos y migraciones

Mantener separadas estas tres realidades:

1. El esquema que declara el código actual.
2. Las versiones registradas por el historial de migraciones.
3. Las tablas, índices y restricciones presentes en cada base viva.

Antes de modificar una migración o declarar una incidencia, comprobar el motor
activo, inventariar las bases implicadas y consultar su historial y objetos
reales sin mostrar cadenas de conexión. PostgreSQL de staging y producción y
las bases SQLite aisladas no deben darse por equivalentes.

No ejecutar una migración manual, corregir datos ni crear objetos como parte de
la inspección. Las fronteras arquitectónicas están en
[docs/ARCHITECTURE.md](./ARCHITECTURE.md) y la gestión de entornos en
[docs/DATABASE-ENVIRONMENT-MANAGER.md](./DATABASE-ENVIRONMENT-MANAGER.md).

## Cambios y validación

- Preferir cambios pequeños, revisables y reversibles.
- Añadir o actualizar pruebas cuando cambie comportamiento ejecutable.
- Ejecutar la validación más estrecha durante el desarrollo y la puerta de CI
  completa antes de publicar cambios de código.
- Para cambios exclusivamente documentales, comprobar formato, enlaces, diff y
  limpieza del árbol; ampliar la validación si el documento modifica un
  procedimiento ejecutable.
- No presentar como verificado aquello que no se haya comprobado en la sesión
  actual.

Las órdenes de validación y convenciones del proyecto están en
[DEVELOPMENT.md](../DEVELOPMENT.md), y la política de dependencias en
[docs/dependency-policy.md](./dependency-policy.md).

## Publicación con Git

Antes de preparar un commit:

1. Volver a revisar `git status` y el diff.
2. Confirmar que solo se incluyen archivos del alcance aprobado.
3. Ejecutar las validaciones acordes al cambio.
4. Comprobar que el remoto y la sesión de GitHub están accesibles.
5. Crear un commit descriptivo en español y publicar únicamente cuando el
   usuario lo haya pedido expresamente.

Un push correcto confirma la publicación en Git, no el despliegue en el
servidor. El despliegue requiere la comprobación independiente descrita
anteriormente.

## Separación de la información

- **Repositorio:** arquitectura, reglas duraderas y procedimientos saneados.
- **Estado operativo local excluido de Git:** identificadores del proveedor,
  inventario vivo, incidencias, resultados administrativos y tareas pendientes.
- **Gestor de secretos o soporte físico protegido:** credenciales, claves y
  material necesario para recuperación.

El estado operativo privado debe mantenerse fuera del repositorio o bajo una
exclusión verificada antes de escribirlo. Nunca debe almacenarse dentro de la
misma copia cifrada que protege si eso impide su recuperación independiente.

## Cierre de una intervención

El relevo final debe indicar de forma explícita:

- resultado alcanzado y alcance real;
- archivos modificados;
- validaciones ejecutadas y su resultado;
- commit, rama y estado de publicación;
- estado de despliegue, solo si fue comprobado directamente;
- aspectos no verificados;
- acción humana pendiente, con la instrucción exacta y sin solicitar secretos.

Si no se modificó nada, también debe decirse. Esta separación evita convertir
suposiciones históricas en estado confirmado.

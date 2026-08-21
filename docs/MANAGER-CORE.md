# Núcleo de gestores

## Responsabilidades

Los gestores de Umbravia Forge conservan la responsabilidad de su dominio:
gestionan, confirman y avisan. El núcleo no ejecuta trabajo de cuentas,
seguridad, cifrado, correo, recursos, entornos ni soporte. Su administrador
solo regula el tráfico entre gestores para:

- aplicar prioridades estables (`critical`, `high`, `normal`, `low`);
- separar tráfico de control, interactivo, transaccional, mantenimiento y
  observación;
- impedir que dos operaciones usen simultáneamente un ámbito incompatible;
- limitar concurrencia y tamaño de cola global y por gestor;
- permitir trabajo independiente mientras haya capacidad libre;
- evitar inanición mediante envejecimiento gradual de prioridades;
- deduplicar avisos no críticos repetidos y limitar únicamente avisos
  informativos, sin descartar señales críticas ni deduplicar un aviso de
  `commercial` contra otro de `support`.

El coordinador mantiene el registro cerrado de conexiones compatibles, cifra
los mensajes autorizados y distribuye las notificaciones. El administrador del
núcleo no puede cambiar configuraciones de gestores, ejecutar sus tareas ni
mutar secretos.

## Ámbitos de plataforma obligatorios

Los gestores son una infraestructura única compartida. No existen un núcleo
comercial y otro de UMF Support. La separación se expresa en cada operación,
orden y señal mediante `platformScope`, cuyo valor debe ser exactamente
`commercial` o `support`.

El ámbito forma parte de las operaciones activas y en cola, de los descriptores
del canal prioritario, de las señales cifradas y de su clave de deduplicación.
La interfaz administrativa filtra operaciones y señales antes de mostrarlas;
una vista `commercial` no incorpora eventos `support` y viceversa. En la cola
de correo el ámbito se persiste para conservarlo también durante reintentos,
errores y trabajo programado. El ámbito dirige el flujo, pero no reemplaza la
autorización del gestor de dominio ni convierte una identidad de una
aplicación en identidad de la otra.

## Canal prioritario Coordinador a Núcleo

Las órdenes e instrucciones urgentes disponen de un canal de control separado
entre el coordinador y el administrador del núcleo. El coordinador valida el
gestor responsable, el identificador público y los ámbitos; cifra el descriptor
en tránsito y lo entrega al núcleo con prioridad `high` o `critical`. El núcleo
devuelve al coordinador un acuse cifrado cuando el gestor responsable termina.

```text
Coordinador -- orden/instrucción cifrada --> Administrador del núcleo
Coordinador <-- acuse de finalización cifrado -- Administrador del núcleo
```

El canal no es un atajo administrativo:

- solo acepta órdenes e instrucciones `high` o `critical`;
- usa exclusivamente la clase de tráfico `control`;
- una orden se adelanta al trabajo ordinario que ya espera en cola;
- no interrumpe una operación activa ni evita la exclusión de ámbitos;
- no evita los límites de concurrencia, capacidad o tiempo de espera;
- solo transporta identificadores públicos saneados, nunca secretos, claves,
  rutas de archivos ni cuerpos de tareas;
- el administrador regula la ejecución, pero el trabajo continúa perteneciendo
  al gestor de dominio indicado por el coordinador.

## Conexión Seguridad a Cifrado

La conexión directa tiene una sola capacidad registrada:
`security-hardening`.

```text
Gestor de seguridad
        -> solicita diagnóstico de endurecimiento
Coordinador
        -> valida conexión y ámbito encryption-readiness
        -> encapsula el resumen con AES-256-GCM
Gestor de cifrado
        -> devuelve capacidades, estado y códigos públicos saneados
```

Sus límites son deliberados:

- dirección única: Seguridad consume y Cifrado provee;
- modo de solo lectura;
- sin rutas, nombres de variables ni identificadores de claves;
- sin material criptográfico bruto;
- sin capacidad para rotar, activar, sustituir o eliminar claves;
- sin acceso de Seguridad al ámbito protegido `encryption-files`;
- toda modificación sigue requiriendo una acción explícita del operador.

Este canal solo permite que Seguridad incorpore el estado criptográfico a su
diagnóstico y priorice un hallazgo. No convierte al gestor de seguridad en
propietario del cifrado.

## Administrador local Linux compartido

Los doce perfiles de gestores se observan mediante un único administrador
interno, `shared-internal-manager-administrator`. La interfaz se ejecuta en el
servidor Linux con el comando mantenido `platform:managers`; no se publica en
el navegador ni mediante una API remota.

Antes de inicializar, abrir o migrar la base de datos, y por tanto antes de
consultar la autoridad de aplicación, se aplica la barrera del sistema
operativo:

1. el proceso debe ejecutarse en Linux;
2. `root` queda rechazado por UID y por nombre;
3. el usuario local debe figurar expresamente en la lista exacta y
   sensible a mayúsculas `UMF_MANAGER_ADMIN_LINUX_USERS`;
4. la lista debe configurarse en el entorno operativo; sus valores reales no
   se incorporan al repositorio.

Después se aplica una autoridad distinta para el ámbito solicitado:

- `commercial`: identidad comercial activa, correo verificado y relación
  activa en `platformOperators`;
- `support`: identidad `corporate_support` activa, correo verificado, rol
  `director` activo en `umfSupportStaff` y cargo `platform_head` activo en
  `companyStaffProfiles`.

Una autoridad no puede abrir la vista del otro ámbito. El cargo corporativo,
la pertenencia de soporte o una relación `platformOperators` aislada tampoco
evitan la allowlist de Linux.

```text
npm run platform:managers -- --email <cuenta-autorizada> --scope commercial overview
npm run platform:managers -- --email <cuenta-autorizada> --scope support profiles
npm run platform:managers -- --email <cuenta-autorizada> --scope commercial profile manager-resource
```

`--scope commercial|support` es obligatorio. `overview` muestra únicamente
contadores del runtime del ámbito elegido; `profiles` enumera las vistas
internas; y `profile` devuelve operaciones, señales y conexiones saneadas del
perfil. La interfaz no muestra valores secretos, no muta material
criptográfico, no ejecuta órdenes del host ni trabajo de dominio y no concede
acceso web. La consola anterior, `ufctl`, el ejecutor remoto y el sandbox se
retiran; este comando tampoco es una terminal genérica ni una herramienta de
red.

## Admisión y retroceso

Las operaciones interactivas conservan rechazo inmediato con conflicto, de
modo que una petición HTTP no queda esperando indefinidamente. Las tareas
internas programadas usan la cola priorizada. Una tarea que supera el límite o
el tiempo máximo falla de forma visible y conserva la responsabilidad en su
gestor de origen.

El núcleo mantiene operaciones y señales en memoria y no ejecuta migraciones.
La cola de correo sí persiste `platformScope` para conservar la dirección de
sus señales durante reintentos y recuperación del worker. Cualquier retroceso
de esa columna debe tratarse como una migración de datos y no como una simple
reversión de código. La terminal no crea secretos ni unidades del sistema.

## Comprobaciones

La validación debe demostrar:

1. rechazo inmediato de conflictos interactivos;
2. ejecución posterior de tareas internas en conflicto;
3. paralelismo de ámbitos independientes;
4. límites de cola por gestor;
5. señales críticas sin deduplicación ni limitación;
6. conexión Seguridad a Cifrado registrada y conexión inversa denegada;
7. ausencia de claves, nombres sensibles y cuerpos de tarea en el estado;
8. denegación cruzada de `security-files` y `encryption-files`.
9. prioridad efectiva de órdenes de control frente a trabajo ordinario en cola;
10. rechazo de prioridades rebajadas, extremos no autorizados y metadatos
    sensibles en el canal Coordinador a Núcleo;
11. acuse protegido Núcleo a Coordinador sin exponer el resultado del trabajo.
12. ámbito `commercial|support` obligatorio en operaciones, órdenes y señales;
13. deduplicación y vistas separadas por ámbito incluso con mensajes iguales;
14. rechazo de identidad o autoridad del ámbito contrario;
15. allowlist local aplicada a ambos ámbitos, con rechazo de `root`, de
    usuarios no permitidos y de sistemas no Linux;
16. ausencia de rutas web/API, `ufctl`, ejecutor remoto y terminal de red
    genérica.

La validación focalizada más reciente terminó favorablemente con nueve archivos
y 72 pruebas, incluida la barrera anterior a la base, el aislamiento de
identidades, el cierre comercial independiente, la retención por ámbito y la
cola de correo.

En el checkout final, portabilidad de 48 archivos, formato, lint y los tres
`typecheck` fueron favorables. Tras una terminación sin resumen del supervisor
paralelo de Vitest en Windows, la suite completa en un solo proceso pasó 112
archivos y 548 pruebas, sin fallos y con una prueba POSIX no aplicable en
Windows. Las tres compilaciones, el paquete Windows y la auditoría de
dependencias también fueron favorables. La auditoría del diff final y GitHub
Actions se completan después de cerrar la documentación y publicar el commit
autorizado.

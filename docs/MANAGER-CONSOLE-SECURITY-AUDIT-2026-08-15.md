# Auditoría de seguridad de la consola corporativa de gestores

> [!NOTE]
> Evidencia histórica del alcance indicado. El estado vigente del plano de
> gestión se mantiene en [MANAGER-CORE.md](./MANAGER-CORE.md).

**Fecha:** 15 de agosto de 2026

**Ámbito:** implementación local de la consola corporativa, jerarquía de
gestores, credenciales de terminal, separación comercial/corporativa y cifrado
asociado

**Rama evaluada:** `codex/dynamic-manager-workspaces`

**Modalidad:** caja blanca y pruebas locales no destructivas

**Estándar:** `docs/SECURITY-AUDIT-STANDARD.md`, versión 1.1

## 1. Resumen ejecutivo

La implementación local cumple la separación prevista entre la vista web y la
consola corporativa. La web autentica al usuario autorizado y emite una
credencial; no ejecuta órdenes ni representa una consola. La interacción se
realiza mediante un cliente de terminal portable que utiliza un conjunto
cerrado de órdenes virtuales inspiradas en Linux y no abre un shell del sistema
operativo.

La jerarquía queda fijada en código y persistencia: `umbravia-forge` conserva la
autoridad suprema no asignable; por debajo se sitúan el núcleo, el coordinador,
el administrador de flujo y los gestores de dominio. El gestor auxiliar de
sustitución de material criptográfico aparece exclusivamente bajo el gestor de
cifrado.

La base publicada anterior superó GitHub Actions y la migración 26 quedó
confirmada directamente sobre el esquema PostgreSQL. La ampliación evaluada en
esta rama añade espacios de trabajo dinámicos, separación por aplicación y
tenant, TLS moderno, sobres autenticados AES-256-GCM y una política verificable
de cifrado de volúmenes con AES-XTS. Su validación integral local fue favorable.
No se modificaron archivos de secretos, valores de claves, material
criptográfico ni unidades de servicio. La verificación operativa fue de solo
lectura y no acredita todavía un recorrido funcional con una cuenta corporativa
sintética ni el cifrado físico del volumen activo.

## 2. Alcance y exclusiones

### Incluido

- jerarquía y asignación de perfiles corporativos;
- autorización para consultar y administrar perfiles subordinados;
- emisión, almacenamiento, canje y revocación de credenciales;
- sesiones internas y externas;
- cierre universal mediante `exit`;
- revocación por inactividad, interrupción del latido, pérdida de rol o cambio
  del estado de la cuenta;
- cliente portable para Linux, macOS, WSL y PowerShell;
- rechazo de órdenes capaces de acceder al sistema operativo;
- consistencia de las tablas nuevas entre SQLite, PostgreSQL y el puente de
  datos;
- separación de aplicación y tenant entre producto comercial y soporte
  corporativo;
- cifrado autenticado AES-256-GCM de datos sensibles nuevos y lectura compatible
  de sobres heredados;
- política AES-XTS y comprobación no destructiva del cifrado de volúmenes;
- formato, análisis estático, tipos, pruebas, compilación y auditoría de
  dependencias.

### No evaluado o pendiente de validación funcional

- recorrido completo con credenciales internas y externas en una cuenta
  corporativa sintética;
- inspección privilegiada del actualizador heredado antes de decidir si sus
  funciones se solapan o siguen siendo necesarias;
- pruebas con cuentas corporativas reales;
- suspensión e hibernación en cada combinación física de sistema operativo;
- resistencia de red, pérdida prolongada de conectividad y concurrencia de
  varias instancias del servidor.
- migración física del volumen activo a LUKS2 con AES-XTS, que requiere ventana
  de mantenimiento, copia restaurable y acceso de recuperación.

No se realizaron ataques, pruebas destructivas, cambios de claves ni acciones
sobre producción.

## 3. Modelo de autoridad validado

| Prioridad | Perfil                                       | Asignable | Ámbito principal              |
| --------- | -------------------------------------------- | --------- | ----------------------------- |
| Suprema   | `umbravia-forge`                             | No        | Autoridad global              |
| 1         | `manager-core`                               | Sí        | Núcleo de gestores            |
| 2         | `manager-coordinator`                        | Sí        | Coordinación de gestores      |
| 3         | `manager-flow-administrator`                 | Sí        | Regulación del flujo          |
| 4         | gestores de dominio                          | Sí        | Área funcional delimitada     |
| 4         | gestor de sustitución criptográfica auxiliar | No        | Subrama del gestor de cifrado |

Un perfil solo puede administrar perfiles de prioridad estrictamente inferior.
La autoridad suprema y el gestor auxiliar no pueden asignarse mediante la
consola. Un gestor de dominio solo ve su área; el gestor de cifrado ve además su
subrama auxiliar.

## 4. Matriz de controles

| Control                          | Resultado esperado                                 | Evidencia observada                                       | Estado     |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ---------- |
| Separación web/terminal          | La web no ejecuta órdenes                          | Solo autentica, informa y emite credenciales              | `OK`       |
| Acceso al sistema operativo      | Ningún shell, proceso o ruta real                  | Conjunto virtual cerrado; acceso declarado como falso     | `OK`       |
| Sintaxis peligrosa               | Rechazar tuberías, redirecciones y encadenamiento  | Validación y regresiones específicas                      | `OK`       |
| Jerarquía                        | Prioridades fijas y autoridad suprema no asignable | Perfiles y relaciones verificados por pruebas             | `OK`       |
| Administración de roles          | Solo perfiles estrictamente inferiores             | Política cerrada en servidor                              | `OK`       |
| Credencial interna               | Duradera solo con actividad y confianza            | Hash persistido, inactividad de 15 minutos y rol activo   | `OK`       |
| Credencial externa               | Temporal y de un solo uso                          | Canje único de 5 minutos; sesión máxima de 30 minutos     | `OK`       |
| Pérdida de confianza             | Revocar por cuenta o rol inválido                  | Revocación inmediata comprobada                           | `OK`       |
| Suspensión o hibernación         | Invalidar al perder el latido portable             | Latido cada 30 s; tolerancia máxima de 90 s               | `OK local` |
| Cierre con `exit`                | Revocar en todos los modos                         | Desconexión explícita y prueba de reutilización rechazada | `OK`       |
| Material de credencial en reposo | No persistir el valor utilizable                   | Solo SHA-256 de credencial y sesión                       | `OK`       |
| Persistencia multiplataforma     | Esquema equivalente en SQLite y PostgreSQL         | Tablas, restricciones e índices equivalentes              | `OK local` |
| Migración del servidor           | Aplicación única y esquema real comprobado         | Versión, tablas, columnas e índices confirmados           | `OK`       |
| Canal público real               | TLS, proxy y origen verificados                    | Salud pública correcta y rutas sin credencial rechazadas  | `PARCIAL`  |

## 5. Diseño de sesión y revocación

### Canal interno

- la credencial no tiene caducidad absoluta mientras conserva actividad y
  confianza;
- el valor utilizable no se almacena, solo su huella;
- quince minutos sin una orden válida cierran el acceso;
- el cliente envía un latido cada treinta segundos sin convertirlo en actividad
  del usuario;
- una separación superior a noventa segundos se trata como suspensión,
  hibernación o pérdida de continuidad y revoca la sesión;
- cualquier pérdida del rol corporativo o cambio de la cuenta fuera de estado
  activo revoca el registro.

### Canal externo

- la credencial de acceso caduca a los cinco minutos;
- solo puede canjearse una vez;
- la sesión resultante tiene un máximo de treinta minutos;
- conserva las mismas comprobaciones de confianza, latido y `exit`.

El latido no amplía el límite de inactividad. Esta separación evita que una
terminal abandonada permanezca viva solo porque el proceso continúa conectado.

## 6. Superficie de órdenes

La consola declara `umbravia-sh` como interfaz virtual. Las órdenes admitidas
se resuelven dentro de la aplicación y no se pasan a `cmd.exe`, PowerShell,
WSL, Bash ni ningún otro intérprete del equipo.

Se rechazan expresamente:

- tuberías, redirecciones, separadores y sustituciones de comandos;
- saltos de línea y órdenes compuestas;
- rutas reales de Windows, recursos UNC y rutas sensibles de Linux;
- entradas vacías o superiores a 240 caracteres;
- perfiles fuera del árbol visible del actor;
- asignaciones de igual o mayor prioridad.

La compatibilidad con Windows significa que el cliente puede ejecutarse desde
PowerShell. No introduce extensiones automáticas, scripts exclusivos ni una
dependencia operativa de Windows.

## 7. Hallazgos corregidos durante la validación

### UF-MC-01 — Omisión de las tablas nuevas en el puente de datos

**Severidad:** alta para despliegue

**Estado:** corregido y validado

La primera ejecución integral detectó que las tablas de roles corporativos y
acceso de terminal no estaban incluidas en los grupos de migración del puente
SQLite/PostgreSQL. La omisión habría dejado una release aparentemente compilada
pero incompleta al preparar sus datos. Ambas tablas quedaron incorporadas al
grupo correspondiente y la validación integral posterior fue favorable.

### UF-MC-02 — Suspensión indistinguible de una pausa breve

**Severidad:** media

**Estado:** corregido localmente

La primera versión solo aplicaba el límite general de inactividad. Se añadió un
latido independiente de la actividad del usuario. El servidor rechaza y revoca
una sesión cuyo latido se interrumpe, mientras que el cliente detecta también
un salto temporal compatible con suspensión o hibernación.

### UF-MC-03 — Formato inconsistente en una integración de autenticación

**Severidad:** informativa

**Estado:** corregido

La puerta de formato detuvo la primera validación antes de continuar. El archivo
se normalizó sin cambiar la política de autenticación ni valores sensibles.

### UF-MC-04 — Sobres heredados sin una política criptográfica unificada

**Severidad:** alta para datos corporativos nuevos

**Estado:** corregido y compatible

Las escrituras nuevas de contenido privado y de interconexiones de gestores
usan AES-256-GCM con nonce de 96 bits, etiqueta de autenticación de 128 bits y
datos asociados que fijan versión, identificador de clave y contexto. Los sobres
heredados continúan siendo legibles y se reenvuelven de forma diferida cuando se
leen, sin generar ni rotar claves. Los cuerpos, contexto y adjuntos privados de
soporte corporativo aplican la misma protección en reposo.

### UF-MC-05 — Cifrado de volumen no verificable desde la aplicación

**Severidad:** alta para operación corporativa

**Estado:** control preparado; activación manual pendiente

Se definió LUKS2/dm-crypt con `aes-xts-plain64` y 512 bits totales de material
XTS, equivalentes a dos claves AES de 256 bits. El comprobador añadido solo lee
la topología y el estado del volumen; no formatea, abre, cierra ni migra discos.
La conversión del volumen activo se excluye deliberadamente del despliegue
automático.

## 8. Evidencia reproducible

Prueba dirigida:

```text
npx vitest run server/services/manager-console.test.ts \
  server/services/manager-core.test.ts --maxWorkers=1 --no-file-parallelism

2 archivos superados
14 pruebas superadas
```

Puerta integral:

```text
npm run ci:validate
```

Resultado observado:

- portabilidad operativa: 45 archivos revisados;
- formato: favorable;
- ESLint: favorable;
- tipos de cliente, servidor y Worker: favorables;
- pruebas: 101 archivos y 498 pruebas superadas;
- compilación del cliente: favorable;
- compilación del servidor: favorable;
- compilación del Worker de correo: favorable;
- auditoría de dependencias: sin vulnerabilidades fuera de una excepción
  explícita y acotada.

### Comprobación operativa saneada

La verificación de solo lectura sobre la release publicada confirmó:

- el repositorio del servidor, la release activa y `origin/main` apuntan al
  mismo commit integrado;
- el servicio de aplicación está activo;
- la comprobación local y la pública de vida responden con HTTP 200;
- la ruta de arranque de la consola sin autenticación responde con HTTP 401;
- el intento de conexión sin credencial responde con HTTP 400;
- la última ejecución observada del actualizador seguro terminó correctamente;
- GitHub Actions validó favorablemente el commit de la base publicada; la
  ampliación de esta rama debe superar de nuevo la misma puerta tras publicarse.

La consulta transaccional y de solo lectura de PostgreSQL confirmó:

| Comprobación                       | Observado | Esperado | Resultado |
| ---------------------------------- | --------: | -------: | --------- |
| Migración 26                       |         1 |        1 | `OK`      |
| Tabla de asignaciones corporativas |         1 |        1 | `OK`      |
| Tabla de accesos de terminal       |         1 |        1 | `OK`      |
| Columnas de asignaciones           |         8 |        8 | `OK`      |
| Columnas de accesos                |        12 |       12 | `OK`      |
| Columna de latido                  |         1 |        1 | `OK`      |
| Índices de asignaciones            |         2 |        2 | `OK`      |
| Índices de accesos                 |         2 |        2 | `OK`      |
| Modos de acceso inválidos          |         0 |        0 | `OK`      |
| Usuarios huérfanos en accesos      |         0 |        0 | `OK`      |

La ausencia de asignaciones y accesos almacenados es la línea base esperada
antes de crear perfiles corporativos o emitir credenciales de terminal. La
consulta finalizó con `ROLLBACK` y no alteró datos.

## 9. Riesgos residuales y pasos de activación

### UF-MC-R1 — Recorrido autenticado del canal en producción

**Estado:** `PARCIAL`

La release activa, la salud pública y el rechazo de peticiones sin credenciales
han quedado comprobados. Falta emitir credenciales internas y externas para una
cuenta corporativa sintética y verificar autorización, canje único, revocación y
ausencia de rutas alternativas.

### UF-MC-R2 — Migración real verificada

**Estado:** `RESUELTO`

PostgreSQL registra una única aplicación de la migración 26. Las dos tablas, el
número esperado de columnas, la columna de latido y los cuatro índices
requeridos están presentes. No se observaron modos inválidos ni referencias de
usuario huérfanas.

### UF-MC-R3 — Prueba física multiplataforma

**Estado:** `PARCIAL`

La portabilidad se verifica estáticamente y el cliente usa exclusivamente Node
y HTTP. Falta una prueba manual controlada de apertura, inactividad,
suspensión/reanudación y `exit` en PowerShell, WSL, Linux y macOS. Esa prueba no
requiere ni debe recibir acceso al shell del sistema desde Umbravia Forge.

### UF-MC-R4 — Temporizadores de actualización concurrentes

**Estado:** `REVISIÓN`

Hay dos temporizadores activos con frecuencias distintas: el actualizador seguro
de releases se ejecuta aproximadamente cada quince minutos y el mecanismo
heredado cada dos horas. El actualizador seguro mantiene construcción aislada,
comprobación de salud, reversión y limpieza de releases. No se ha desactivado
ninguna unidad: antes de declarar obsoleto el mecanismo heredado debe revisarse
con permisos administrativos su script efectivo, sus registros, su política de
reversión y cualquier función exclusiva.

### UF-MC-R5 — Cifrado físico del volumen corporativo

**Estado:** `PENDIENTE MANUAL`

La aplicación puede verificar de forma no destructiva una raíz protegida por
LUKS2 con AES-XTS, pero no debe convertir un sistema de archivos activo desde el
actualizador. La activación requiere una copia restaurable verificada, acceso a
la consola de recuperación, una ventana de mantenimiento y una comprobación
posterior independiente. Hasta entonces, el control AES-XTS es una política y
una puerta de verificación, no una afirmación sobre el disco de producción.

## 10. Criterio de cierre

La implementación, publicación, salud y persistencia quedan verificadas. Los
criterios de software deben completarse antes de publicar; los recorridos
funcionales y el cifrado físico permanecen como activaciones operativas:

1. el alcance del commit se revise y no incluya material sensible;
2. GitHub Actions termine favorablemente;
3. el actualizador despliegue exactamente el commit publicado;
4. el servicio activo y sus endpoints de salud respondan correctamente;
5. PostgreSQL confirme la migración y el esquema real;
6. una cuenta corporativa sintética pruebe cada prioridad, la pérdida de rol,
   la inactividad, el latido, la suspensión y `exit`;
7. se conserve evidencia saneada sin credenciales ni identificadores privados.
8. el volumen corporativo sea verificado como LUKS2/AES-XTS tras una migración
   manual recuperable.

Hasta completar los criterios 6 y 8, este informe acredita los controles de
software y su validación local, pero no acredita todavía la autorización
funcional de extremo a extremo de todos los perfiles corporativos ni el cifrado
físico del volumen de producción.

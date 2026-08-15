# Auditoría de seguridad de la consola corporativa de gestores

**Fecha:** 15 de agosto de 2026

**Ámbito:** implementación local de la consola corporativa, jerarquía de
gestores, credenciales de terminal y migración asociada

**Rama evaluada:** `codex/manager-console-hierarchy`

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

La validación integral local terminó favorablemente. No se modificaron archivos
de secretos, valores de claves, material criptográfico, unidades de servicio ni
configuración de producción. Este resultado no acredita todavía el despliegue
ni el esquema real del servidor.

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
- formato, análisis estático, tipos, pruebas, compilación y auditoría de
  dependencias.

### No evaluado

- despliegue de la migración en PostgreSQL del servidor;
- configuración del proxy y del canal de producción;
- comportamiento de la release activa y del actualizador;
- pruebas con cuentas corporativas reales;
- suspensión e hibernación en cada combinación física de sistema operativo;
- resistencia de red, pérdida prolongada de conectividad y concurrencia de
  varias instancias del servidor.

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
| Migración del servidor           | Aplicación única y esquema real comprobado         | No desplegada ni consultada en esta evaluación            | `NE`       |
| Canal público real               | TLS, proxy y origen verificados                    | Fuera de la validación local                              | `NE`       |

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

- portabilidad operativa: 41 archivos revisados;
- formato: favorable;
- ESLint: favorable;
- tipos de cliente, servidor y Worker: favorables;
- pruebas: 98 archivos y 486 pruebas superadas;
- compilación del cliente: favorable;
- compilación del servidor: favorable;
- compilación del Worker de correo: favorable;
- auditoría de dependencias: sin vulnerabilidades fuera de una excepción
  explícita y acotada.

## 9. Riesgos residuales y pasos de activación

### UF-MC-R1 — Comprobación de canal en producción

**Estado:** `NE`

La política local distingue los modos interno y externo y vincula cada token al
modo emitido. Aún debe comprobarse que el proxy y la release activa preservan
las cabeceras previstas, usan HTTPS y no exponen una ruta alternativa sin las
comprobaciones del servidor.

### UF-MC-R2 — Migración real pendiente

**Estado:** `NE`

La migración local es coherente, pero no se considera aplicada en el servidor.
Después de publicar una versión validada debe ejecutarse el actualizador y
consultarse directamente `schemaMigrations`, las dos tablas, sus columnas,
restricciones e índices. No debe darse por activa solo porque el código esté en
GitHub.

### UF-MC-R3 — Prueba física multiplataforma

**Estado:** `PARCIAL`

La portabilidad se verifica estáticamente y el cliente usa exclusivamente Node
y HTTP. Falta una prueba manual controlada de apertura, inactividad,
suspensión/reanudación y `exit` en PowerShell, WSL, Linux y macOS. Esa prueba no
requiere ni debe recibir acceso al shell del sistema desde Umbravia Forge.

## 10. Criterio de cierre

La superficie local queda apta para publicación controlada. La activación solo
podrá considerarse completa cuando:

1. el alcance del commit se revise y no incluya material sensible;
2. GitHub Actions termine favorablemente;
3. el actualizador despliegue exactamente el commit publicado;
4. el servicio activo y sus endpoints de salud respondan correctamente;
5. PostgreSQL confirme la migración y el esquema real;
6. una cuenta corporativa sintética pruebe cada prioridad, la pérdida de rol,
   la inactividad, el latido, la suspensión y `exit`;
7. se conserve evidencia saneada sin credenciales ni identificadores privados.

Hasta completar esos pasos, este informe acredita únicamente la implementación
y la validación local descritas; no acredita el estado de producción.

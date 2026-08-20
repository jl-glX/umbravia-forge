# Auditoría de la base CRM y de encuestas analíticas

> [!NOTE]
> Evidencia histórica de esta base. El estado vigente y sus límites operativos
> se mantienen en [FORGE-ANALYTICS.md](./FORGE-ANALYTICS.md).

**Fecha:** 16 de agosto de 2026

**Ámbito:** CRM por centro, encuestas analíticas periódicas, autorización,
aislamiento tenant, persistencia y experiencia web

**Rama evaluada:** `codex/forge-analytics-monthly-surveys`

**Modalidad:** caja blanca y pruebas locales no destructivas

**Estándar:** `docs/SECURITY-AUDIT-STANDARD.md`, versión vigente en el
repositorio

## 1. Resumen ejecutivo

La implementación incorpora una base CRM operativa y neutral respecto al tipo
de centro. Los administradores pueden consultar indicadores de actividad de sus
miembros, aplicar una segmentación manual, asignar responsables y programar o
completar seguimientos. Los segmentos sugeridos se calculan a partir de
actividad real de reservas y no sustituyen la decisión del centro.

La analítica incorpora encuestas periódicas creadas por cada centro. Un
administrador puede publicar una definición versionada, abrir una campaña para
un periodo concreto y consultar resultados agregados. Las personas invitadas
pueden responder una sola vez dentro del periodo abierto. El diseño evita
convertir respuestas individuales en una pantalla de vigilancia: la vista de
resultados se limita a agregados.

Los dos dominios quedan aislados por `facilityId`. Las rutas de administración
exigen el rol correspondiente y no aceptan que el cliente elija libremente otro
centro. Las pruebas dirigidas verifican denegación sin sesión, denegación a un
entrenador en el CRM administrativo, visibilidad limitada al centro activo y
rechazo de escrituras cruzadas.

No se modificaron secretos, valores de claves, archivos de seguridad ni
unidades de servicio. La validación es local: las migraciones PostgreSQL 29 y 30
no se consideran aplicadas en el servidor hasta que el actualizador normal las
ejecute y el esquema vivo se compruebe de forma independiente.

## 2. Decisiones de producto y vocabulario

Umbravia Forge ya admite centros de disciplinas distintas. Por ello, el código
nuevo usa conceptos neutros como centro, actividad, sesión, reserva, miembro y
personal. El CRM no presupone un gimnasio tradicional y las encuestas permiten
que cada administrador formule preguntas adecuadas a su servicio.

Se conservan nombres históricos como `GymClass`, `gymClasses` y `classId` donde
forman parte del esquema existente. Renombrarlos dentro de esta ampliación
habría añadido una migración transversal sin aportar valor inmediato al CRM.
La neutralización completa del vocabulario interno queda como evolución
separada y deberá mantener compatibilidad de datos y API.

## 3. Alcance implementado

### CRM por centro

- resumen de miembros en incorporación, activos, necesitados de atención y
  reactivación;
- actividad de reservas de los últimos treinta días y fecha de última
  actividad;
- segmento sugerido calculado y segmento manual administrable;
- asignación opcional de una persona responsable;
- creación y finalización de seguimientos de incorporación, contacto,
  retención o servicio;
- búsqueda y filtrado de la cartera del centro;
- interfaz traducida al español, inglés, alemán y alemán de Suiza;
- ruta administrativa propia dentro de la aplicación.

### Encuestas analíticas

- definiciones versionadas por centro;
- preguntas de escala, selección única y texto libre;
- campañas asociadas a un periodo único por centro;
- participación limitada a miembros activos del centro;
- una respuesta por campaña y miembro;
- apertura y cierre temporal comprobados en servidor;
- resultados agregados para administradores;
- integración en las vistas de analítica de administrador, entrenador y
  actividad del miembro según sus permisos;
- interfaz traducida a los cuatro idiomas disponibles.

## 4. Persistencia y migraciones

La migración PostgreSQL 29 crea las tablas de definiciones, preguntas,
campañas, participaciones, respuestas y respuestas por pregunta de las
encuestas. La migración 30 crea los perfiles CRM y los seguimientos.

SQLite contiene estructuras equivalentes para desarrollo y pruebas. Las ocho
tablas nuevas están declaradas en el puente de datos con una clasificación
explícita:

- configuración: definiciones, preguntas y campañas;
- identidad: perfiles CRM y seguimientos;
- datos retenidos: participaciones, respuestas y respuestas por pregunta.

Esta clasificación fue añadida después de que el primer pase integral detectara
que las tablas nuevas todavía no formaban parte de los grupos de migración del
puente. La puerta falló de forma segura y la omisión quedó corregida antes de la
publicación.

## 5. Matriz de controles

| Control                | Resultado esperado                                 | Evidencia local                                       | Estado      |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------- | ----------- |
| Sesión obligatoria     | Rechazar solicitudes anónimas                      | Rutas CRM y encuestas devuelven denegación            | `OK`        |
| Rol administrativo CRM | Solo administradores gestionan la cartera          | Entrenador rechazado por la ruta administrativa       | `OK`        |
| Contexto de centro     | El servidor obtiene el centro de la sesión         | No se admite `facilityId` arbitrario del cuerpo       | `OK`        |
| Lectura cruzada CRM    | Un centro no ve miembros de otro                   | Prueba con dos centros                                | `OK`        |
| Escritura cruzada CRM  | Un centro no modifica perfiles ajenos              | Actualización cruzada devuelve no encontrado          | `OK`        |
| Campañas de encuesta   | Una campaña por centro y periodo                   | Restricción de persistencia y servicio                | `OK`        |
| Respuesta única        | Un miembro responde una vez                        | Restricción y prueba de servicio                      | `OK`        |
| Resultados             | La administración recibe agregados                 | Servicio no expone una lista de respuestas personales | `OK local`  |
| Puente de datos        | Todas las tablas nuevas están clasificadas         | Cobertura de migración PostgreSQL                     | `OK`        |
| Esquema real           | Migraciones 29 y 30 aplicadas en PostgreSQL activo | Pendiente de actualizador y lectura del esquema vivo  | `PENDIENTE` |

## 6. Pruebas dirigidas

Las pruebas específicas cubren:

- servicio CRM: segmentación, aislamiento y ciclo de seguimientos;
- rutas CRM: autenticación, autorización y separación entre centros;
- servicio de encuestas: creación, respuesta única, periodos e aislamiento;
- rutas analíticas: permisos y contexto tenant;
- migraciones PostgreSQL: orden, definición y presencia en el puente.

En total, diecinueve casos dirigidos de estos cinco bloques fueron favorables.
La validación integral posterior superó portabilidad, formato, lint, tipos, 104
archivos de prueba con 507 pruebas favorables, compilación del cliente,
servidor y Worker de correo, y auditoría de dependencias.

## 7. Hallazgos y correcciones

### UF-CRM-01 — Tablas nuevas ausentes del puente de datos

**Severidad:** alta para despliegue

**Estado:** corregido y validado

El primer pase integral detectó ocho tablas sin grupo de migración. La release
no habría podido tratar sus datos de forma completa. Se añadieron a los grupos
de configuración, identidad y retención y la prueba de cobertura quedó
favorable.

### UF-CRM-02 — Riesgo de vigilancia mediante respuestas individuales

**Severidad:** media de privacidad

**Estado:** mitigado en la interfaz administrativa

La pantalla de resultados presenta conteos, promedios y distribuciones. No se
incorporó un listado nominal de respuestas. Cualquier análisis individual
futuro deberá definir finalidad, permisos, información al usuario y retención
antes de ampliar este límite.

### UF-CRM-03 — Vocabulario histórico específico de gimnasio

**Severidad:** baja funcional; media de mantenimiento a largo plazo

**Estado:** contenido

El dominio nuevo usa vocabulario neutral. Los nombres históricos permanecen
solo donde ya forman parte del modelo y no se han duplicado en el CRM. Su
eventual migración deberá tratarse como proyecto propio con compatibilidad hacia
atrás.

## 8. Límites y siguiente verificación

Antes de considerar la función desplegada se debe:

1. publicar el commit validado;
2. esperar una valoración favorable de GitHub Actions;
3. ejecutar el actualizador normal del servidor;
4. comprobar que las migraciones 29 y 30 figuran una sola vez;
5. verificar tablas, columnas, restricciones e índices con consultas de solo
   lectura;
6. realizar un recorrido con dos centros sintéticos y confirmar que ninguna
   lectura o escritura atraviesa el tenant;
7. validar la interfaz con administrador, entrenador y miembro sintéticos.

Esta auditoría no acredita todavía la aplicación de las migraciones en
producción ni sustituye la prueba posterior de aislamiento sobre PostgreSQL
real.

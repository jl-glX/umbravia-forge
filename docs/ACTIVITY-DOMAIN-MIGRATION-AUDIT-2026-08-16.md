# Auditoría de neutralización del dominio de actividades — 16 de agosto de 2026

> [!NOTE]
> Evidencia histórica del commit auditado. El estado vigente se mantiene en
> [ACTIVITY-DOMAIN-MIGRATION.md](./ACTIVITY-DOMAIN-MIGRATION.md).

**Identificador:** UF-ACTIVITY-DOMAIN-MIG-2026-08-16

**Estándar aplicado:** [Estándar interno de auditoría integral de seguridad](./SECURITY-AUDIT-STANDARD.md)

**Línea base:** `e449a9b`

**Punto de restauración:** `restore/pre-domain-neutralization-20260816`

**Rama aislada:** `codex/activity-domain-neutralization`

**Entorno:** Windows, Node.js 24.15.0, npm 11.18.0, SQLite temporal y análisis estático de la migración PostgreSQL

## 1. Resumen ejecutivo

La migración sustituye los identificadores técnicos ligados al concepto de
gimnasio por el dominio neutral `activitySession`. El cambio abarca tablas,
columnas, tipos, consultas, servicios, contratos del cliente y rutas API. Las
etiquetas visibles siguen siendo configurables para que cada centro pueda usar
clase, práctica, cita, curso u otra terminología apropiada.

Los clientes de la release inmediatamente anterior conservan una ventana de
compatibilidad mediante alias HTTP con cabeceras de deprecación. No se han
creado vistas, tipos ni consultas de compatibilidad en la base de datos; el
legado queda limitado al adaptador de migración, el historial SQL inmutable y
la frontera HTTP temporal.

La actualización SQLite se ha probado sobre un esquema heredado y es
idempotente. Mantiene identificadores, relaciones y datos, y termina sin
violaciones de claves foráneas. La migración PostgreSQL 31 renombra las tablas,
columnas, índices y restricciones de forma condicional.

No se modificaron secretos, claves, archivos de entorno ni configuración de
seguridad.

**Resultado:** superada para integración local. La aplicación sobre PostgreSQL
de preproducción, la copia restaurable y la observación posterior al despliegue
permanecen pendientes de validación operativa.

## 2. Alcance y límites

| Superficie                     | Estado  | Evidencia                                                           |
| ------------------------------ | ------- | ------------------------------------------------------------------- |
| SQLite nuevo                   | OK      | El esquema se crea directamente con nombres canónicos               |
| SQLite heredado                | OK      | Renombrado idempotente, filas preservadas y claves foráneas válidas |
| PostgreSQL                     | PARCIAL | SQL parseado y cubierto por pruebas; no aplicado a preproducción    |
| Servicios y tipos              | OK      | Consultas y contratos internos usan `activitySession`               |
| API canónica                   | OK      | Rutas neutrales cubiertas por pruebas de autorización tenant        |
| Compatibilidad HTTP            | OK      | Alias aislados con deprecación y enlace a la ruta sucesora          |
| Cliente                        | OK      | Consumo trasladado a las rutas y campos canónicos                   |
| Despliegue y restauración real | NE      | Requiere copia PostgreSQL verificada antes de ejecutar la migración |

## 3. Invariantes comprobadas

- Cada actividad conserva su identificador, centro, profesional, horario y
  aforo.
- Reservas, listas de espera, contenido, progreso y analítica permanecen
  vinculados a la misma actividad.
- No se sintetizan ni eliminan registros durante el renombrado.
- Las consultas y autorizaciones siguen filtrando por centro.
- No existen tablas, vistas ni tipos de aplicación con el nombre técnico
  `gymClasses` después de la migración.
- Las rutas antiguas y canónicas comparten el mismo router y, por tanto, la
  misma lógica de autorización.
- La migración SQLite puede ejecutarse dos veces sin alterar el resultado.
- El historial de migraciones PostgreSQL anterior no se reescribe.

## 4. Evidencia de validación

La puerta `npm run ci:validate` terminó favorablemente:

- portabilidad: 45 archivos revisados;
- formato y lint: favorables;
- tipos: cliente, servidor y Worker favorables;
- pruebas: 105 archivos y 510 casos favorables;
- compilación: cliente, servidor y Worker favorables;
- dependencias: sin vulnerabilidades fuera de excepciones explícitas y
  acotadas.

Las regresiones dirigidas cubren la actualización de un esquema heredado,
idempotencia, conservación de filas, claves foráneas, sintaxis PostgreSQL,
rutas canónicas, alias temporal y aislamiento por centro.

## 5. Riesgo residual y operación pendiente

Antes de declarar la migración desplegada se debe:

1. comprobar el commit y la release activos;
2. crear una copia PostgreSQL y demostrar que es restaurable;
3. conservar la release anterior y el punto de restauración Git;
4. ejecutar el actualizador normal sin editar unidades ni temporizadores;
5. comprobar que la migración 31 figura aplicada una sola vez;
6. verificar que no quedan tablas, vistas o columnas heredadas;
7. comprobar servicio activo y salud local y remota;
8. crear una actividad y una reserva sintéticas en un centro de prueba;
9. confirmar que otro centro no puede consultar ni modificar esos registros;
10. mantener los alias HTTP hasta verificar que la release cliente anterior ya
    no genera tráfico.

No se declara completado ningún paso operativo anterior en este informe.

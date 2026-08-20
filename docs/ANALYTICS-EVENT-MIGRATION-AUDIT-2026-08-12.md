# Auditoría de migración del historial analítico — 12 de agosto de 2026

> [!NOTE]
> Evidencia histórica del commit auditado. El estado vigente se mantiene en
> [FORGE-ANALYTICS.md](./FORGE-ANALYTICS.md).

**Identificador:** UF-ANALYTICS-MIG-2026-08-12

**Estándar aplicado:** [Estándar interno de auditoría integral de seguridad](./SECURITY-AUDIT-STANDARD.md)

**Línea base:** `dd1f75a59eb18d10b61f79661468710d3e37c596`

**Punto estable evaluado:** `3ae225d` más la corrección de minimización descrita en este informe

**Entorno:** Windows, Node.js 24.15.0, npm 11.18.0, SQLite temporal y análisis estático de la migración PostgreSQL

## 1. Resumen ejecutivo

La migración añade un historial de eventos de reservas separado por centro y
capturado dentro de la misma transacción que modifica la reserva. Permite
comparar reservas, listas de espera, promociones, cancelaciones y asistencias
con el periodo anterior sin reconstruir el pasado desde el estado actual.

La retrocarga se ejecuta una sola vez y marca las reservas existentes como
`baseline_import`. No presenta la instantánea inicial como una transición real.
Los eventos posteriores se distinguen mediante `source=live`.

La revisión confirmó y corrigió dos casos durante el desarrollo:

1. la migración SQLite debía ejecutarse después de crear la raíz tenant;
2. la baja de un usuario compartido en un solo centro debía anonimizar también
   los eventos de ese centro aunque la cuenta continuase activa en otro.

No se modificaron secretos, claves, archivos de entorno ni configuración de
seguridad. No se confirmó ninguna vulnerabilidad crítica o alta dentro del
alcance local evaluado.

**Resultado:** superada para integración local. La migración de producción,
su observación y la restauración real permanecen no evaluadas.

## 2. Alcance y límites

| Superficie                         | Estado  | Evidencia                                                         |
| ---------------------------------- | ------- | ----------------------------------------------------------------- |
| SQLite nuevo y heredado            | OK      | Migración íntegra, idempotencia de creación y retrocarga honesta  |
| PostgreSQL                         | PARCIAL | SQL analizado y parseado; no aplicado a una base de preproducción |
| Separación por centro              | OK      | Centro obligatorio, consultas filtradas y pruebas cruzadas        |
| Permisos entrenador/administración | OK      | El entrenador recibe solo eventos de sus sesiones                 |
| Privacidad de socio/entrenador     | OK      | Identificadores anulables y anonimización al salir del centro     |
| Eliminación de tenant              | OK      | El historial desaparece en cascada con el centro                  |
| Comparación de periodos            | OK      | Contrato y panel distinguen periodo actual/anterior               |
| Despliegue y rollback real         | NE      | No se modificó ni reinició producción                             |
| Copia y restauración PostgreSQL    | NE      | Requiere entorno operativo y copia verificada                     |

## 3. Invariantes comprobadas

- Cada evento contiene `facilityId`; no existe evento global sin tenant.
- La captura se realiza en la transacción de reserva, promoción, cancelación o
  asistencia; un fallo revierte tanto el estado como el evento.
- La clave de deduplicación es única y el escritor tolera el reintento.
- No se almacenan correo, teléfono, IP, credenciales, secretos, texto libre ni
  respuestas de encuesta.
- El nombre de la actividad, el horario y el aforo quedan como instantánea para
  conservar agregados después de eliminar una clase.
- Borrar una cuenta anula sus identificadores; eliminar solo su membresía
  anonimiza exclusivamente el historial del centro abandonado.
- Borrar el centro elimina su historial completo.
- La retrocarga no se repite en cada arranque SQLite.
- Los datos iniciales y los eventos reales se cuentan por separado en la API y
  se muestran como fuentes distintas en la interfaz.

## 4. Evidencia de validación

La puerta `npm run ci:validate` terminó favorablemente:

- portabilidad: 38 archivos revisados;
- formato y lint: favorables;
- tipos: cliente, servidor y Worker favorables;
- pruebas: 92 archivos y 447 casos favorables;
- compilación: cliente, servidor y Worker favorables;
- dependencias: sin vulnerabilidades fuera de excepciones explícitas y acotadas.

Las regresiones dirigidas cubren migración heredada íntegra, reservas nuevas,
intención, espera, promoción, expiración, cancelación, asistencia, corrección de
ausencia, filtro de entrenador, separación de centros, borrado de cuenta y baja
de una membresía compartida.

## 5. Riesgo residual y operación pendiente

Antes de considerar la migración desplegada se debe:

1. confirmar una copia PostgreSQL restaurable y el esquema activo;
2. ejecutar el actualizador normal, sin editar la unidad ni los temporizadores;
3. comprobar que la migración 25 figura aplicada una sola vez;
4. comparar el número de reservas migrables con los eventos `baseline_import`;
5. verificar servicio activo y salud local/remota;
6. crear una reserva sintética controlada y observar un evento `live`;
7. comprobar la vista de administración y entrenador sin datos cruzados;
8. conservar el punto de restauración hasta terminar el periodo de observación.

No se declara completado ningún paso operativo anterior en este informe. Las
encuestas, CRM, soporte analítico y Crashnalytics tienen contratos de datos y
retención diferentes y quedan fuera de esta migración.

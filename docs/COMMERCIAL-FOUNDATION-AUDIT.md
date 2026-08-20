# Auditoría de la base comercial — puntos 1 a 8

Fecha de revisión: 3 de agosto de 2026

> [!NOTE]
> Esta es una fotografía histórica. La base multi-tenant y sus salvaguardas se
> integraron después. El identificador `primary` descrito más abajo fue retirado
> del código activo el 20 de agosto de 2026; se conserva aquí únicamente como
> evidencia de la limitación que existía en la fecha de la auditoría. El estado vigente está en
> [MULTI-TENANT-MIGRATION.md](./MULTI-TENANT-MIGRATION.md) y
> [ARCHITECTURE.md](./ARCHITECTURE.md).

## Resultado

Los puntos 1 a 7 tienen una implementación demostrable y el punto 8 dispone de
una base de clasificación no destructiva. La base es adecuada para desarrollo y
validación guiada, pero todavía no constituye un sistema comercial multiempresa.

## Comprobación por punto

1. **Visión modular:** publicada por la API y representada en la página comercial.
2. **Producto primero:** no existe contacto comercial automático ni una llamada
   obligatoria para explorar el producto.
3. **Orden de desarrollo:** reservas, facturación, experiencia comercial y
   comunidad aparecen en un orden explícito y comprobable.
4. **Creación del centro:** existen catorce tipos de centro, plantillas editables y
   campos operativos opcionales.
5. **Entorno de prueba:** la configuración puede editarse y restaurarse. La
   restauración no borra cuentas, reservas ni facturas compartidas.
6. **Prueba de 31 días:** el plazo es fijo, no se renueva automáticamente y
   expone sus hitos sin descuentos artificiales ni bloqueos manipulativos.
7. **Declaración de datos reales:** admite exactamente `yes`, `no` y
   `assistance`. El cierre requiere declarar que no existen datos reales.
8. **Clasificación modular:** registra categoría, origen y decisión, pero no
   ejecuta todavía conversiones, migraciones ni eliminaciones.

## Controles reforzados

- Las operaciones de configuración requieren sesión administrativa y
  verificación reciente del formulario.
- Los campos desconocidos son rechazados.
- Los eventos comerciales quedan registrados para auditoría.
- El borrador de conversión no se expone en la vista general.
- En producción, `/api/commercial/trial` permanece desactivado salvo que
  `COMMERCIAL_TRIALS_ENABLED=true` se configure de forma consciente.

## Riesgo principal pendiente

La implementación actual usa el identificador único `primary` y comparte las
cuentas y datos operativos de la instalación. No hay aislamiento por gimnasio o
tenant. Por tanto:

- sirve para una demostración local o un único centro piloto;
- no debe ofrecerse todavía como autoservicio simultáneo para varios centros;
- no debe activarse en producción sin revisar aislamiento, propiedad de datos y
  restauración por tenant.

Esta limitación se muestra en la API como `isolatedTenantProvisioningAvailable:
false`; no debe ocultarse ni reinterpretarse como una función terminada.

## Criterio para continuar

El punto 8 completo podrá empezar cuando exista una política de conversión
reversible, una copia de seguridad verificada y aislamiento por centro. Hasta
entonces, la clasificación debe seguir siendo informativa y no destructiva.

# Índice de documentación

Estado revisado contra el código y las pruebas del cambio activo el 22 de agosto
de 2026. El índice evita fijar un SHA que quede obsoleto con cada actualización:
la sincronización se comprueba en el diff y en la validación del commit que se
publica. Esta referencia describe el repositorio; no demuestra por sí sola el
estado de un servidor, DNS, correo, copias, restauraciones ni datos reales.

## Cómo interpretar los documentos

- **Vigente:** se mantiene junto al código y define el estado o la frontera
  actual.
- **Operativo:** procedimiento que exige comprobar el entorno autorizado antes
  de afirmar que está aplicado.
- **Histórico:** auditoría o punto de restauración fechado. Conserva evidencia
  del momento y puede contener pendientes ya resueltos.
- **Futuro o legal:** decisión deliberadamente no cerrada o sujeta a validación
  externa.

El código, las migraciones y las pruebas del commit activo prevalecen si una
auditoría histórica entra en conflicto con un documento vigente.

## Estado vigente del producto

- [Arquitectura](./ARCHITECTURE.md)
- [Seguridad](./SECURITY.md)
- [Migración y aislamiento multi-tenant](./MULTI-TENANT-MIGRATION.md)
- [Ciclo de vida, recuperación y cambio verificado de correo](./ACCOUNT-LIFECYCLE.md)
- [Migración neutral del dominio de actividades](./ACTIVITY-DOMAIN-MIGRATION.md)
- [Núcleo de gestores](./MANAGER-CORE.md)
- [Forge Analytics](./FORGE-ANALYTICS.md)
- [Forge Support](./FORGE-SUPPORT.md)
- [UMF Support y su panel de trabajo](./UMF-SUPPORT.md), incluidas las cuentas
  independientes verificadas con centro de seguridad limitado antes de la
  aprobación humana, el bootstrap único de la jefatura configurada y su
  herramienta local de recuperación, el panel de trabajo individual con nombre
  editable, la compatibilidad interna `director`/`agent` documentada como deuda
  técnica, los espacios de
  colaboración de privilegio reducido, el panel de correo con preparación y
  evidencia operativa separadas para entrada y salida, los adjuntos salientes
  cifrados y aislados de cada centro, la administración limitada de altas
  comerciales de prueba, las alertas configurables, el historial de seguridad
  limitado a treinta días, el despliegue independiente y reproducible de su
  Worker de correo mediante Workers Builds, la entrega pública explícita del
  Worker al webhook de la misma zona, los realms independientes y el saneamiento
  que preserva la cuenta comercial y sus solicitudes de borrado
- [Forge Notify](./FORGE-NOTIFY.md), incluida la separación persistente de
  entregas y señales entre `commercial` y `support`
- [Gestor de bases y entornos](./DATABASE-ENVIRONMENT-MANAGER.md)
- [Política de dependencias](./dependency-policy.md)
- [Suscripciones y facturación con Stripe](./STRIPE-BILLING.md)
- [Política de privacidad](./PRIVACY-POLICY.md)

## Seguridad, cifrado y comunicaciones

- [Cifrado en tránsito y en reposo](./ENCRYPTION-IN-TRANSIT-AND-AT-REST.md)
- [Política de cifrado de almacenamiento](./STORAGE-ENCRYPTION-POLICY.md)
- [Seguridad de comunicaciones privadas](./PRIVATE-COMMUNICATION-SECURITY.md)
- [Correo entrante de Forge Support](./SUPPORT-EMAIL-INBOUND.md)
- [Transporte directo de correo](./FORGE-MAIL-DIRECT-TRANSPORT.md)
- [Estándar interno de auditoría](./SECURITY-AUDIT-STANDARD.md)

## Operación y despliegue

- [Relevo operativo](./OPERATIONAL-HANDOFF.md)
- [Preparación para producción propia](./SELF-HOSTED-PRODUCTION.md)
- [Despliegue protegido](../deploy/README.md)
- [Despliegue portable en Linux](../deploy/LINUX.md)

## Auditorías y puntos históricos

Estos documentos conservan el resultado de una fecha concreta; para conocer el
estado actual hay que volver a los documentos vigentes anteriores.

- [Evaluación extrema inicial, 2026-08-01](./SECURITY-ASSESSMENT-EXTREME-2026-08-01.md)
- [Auditoría de seguridad, 2026-08-01](./SECURITY-AUDIT-2026-08-01.md)
- [Auditoría de seguridad, 2026-08-05](./SECURITY-AUDIT-2026-08-05.md)
- [Auditoría de seguridad, 2026-08-09](./SECURITY-AUDIT-2026-08-09.md)
- [Auditoría de seguridad, 2026-08-12](./SECURITY-AUDIT-2026-08-12.md)
- [Auditoría de seguridad del gestor, 2026-08-15](./MANAGER-CONSOLE-SECURITY-AUDIT-2026-08-15.md)
- [Auditoría de migración de eventos Analytics, 2026-08-12](./ANALYTICS-EVENT-MIGRATION-AUDIT-2026-08-12.md)
- [Auditoría de CRM y encuestas, 2026-08-16](./FORGE-CRM-AND-SURVEYS-FOUNDATION-AUDIT-2026-08-16.md)
- [Auditoría integral de preparación del cambio, 2026-08-21](./INTEGRAL-READINESS-AUDIT-2026-08-21.md)
- [Auditoría integral de UMF Support, 2026-08-21](./UMF-SUPPORT-READINESS-AUDIT-2026-08-21.md)
- [Auditoría del acceso inicial y cambio de correo de UMF Support, 2026-08-21](./UMF-SUPPORT-ACCESS-AUDIT-2026-08-21.md)
- [Auditoría de la credencial previa de UMF Support, 2026-08-21](./UMF-SUPPORT-PREAUTH-CREDENTIAL-AUDIT-2026-08-21.md)
- [Auditoría de separación de identidades y plano de gestores, 2026-08-21](./IDENTITY-REALM-AND-MANAGER-BOUNDARY-AUDIT-2026-08-21.md)
- [Auditoría del flujo de rol y activación de UMF Support, 2026-08-22](./UMF-SUPPORT-ROLE-ACTIVATION-AUDIT-2026-08-22.md)
- [Auditoría del registro cerrado y reinicio de identidad de UMF Support, 2026-08-22](./UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md)
- [Auditoría de correo y alertas de UMF Support, 2026-08-22](./UMF-SUPPORT-MAIL-AND-NOTIFICATIONS-AUDIT-2026-08-22.md)
- [Paquete histórico de prueba de aplicaciones web para Windows](./WINDOWS-WEB-APP-PACKAGE.md)
- [Auditoría de neutralización del dominio, 2026-08-16](./ACTIVITY-DOMAIN-MIGRATION-AUDIT-2026-08-16.md)
- [Auditoría de la base comercial, 2026-08-03](./COMMERCIAL-FOUNDATION-AUDIT.md)
- [Decisiones comerciales 22-38, 2026-08-04](./COMMERCIAL-POINTS-22-38.md)

## Decisiones futuras o externas

- [Base futura de Cloudflare Edge](./FUTURE-CLOUDFLARE-EDGE.md)
- [Preparación legal](./LEGAL-READINESS.md)

## Disciplina de mantenimiento

Las reglas para agentes están en [`AGENTS.md`](../AGENTS.md) y las convenciones
de desarrollo en [`DEVELOPMENT.md`](../DEVELOPMENT.md). Todo cambio que altere
una capacidad, una frontera de seguridad, una migración o un procedimiento de
operación debe actualizar el documento vigente correspondiente y este índice
si cambia su clasificación.

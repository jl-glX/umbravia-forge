# Auditoría de correo y alertas de UMF Support, 2026-08-22

## Alcance

Esta evidencia fechada contrasta el panel corporativo de correo, las alertas y
la incorporación de administradores con el código, las migraciones y las
pruebas del cambio activo. No certifica el estado de una base, un buzón, DNS,
SMTP, Cloudflare, VAPID ni un despliegue vivo.

## Resultado del contraste

- Las cuentas `corporate_support` se crean con credenciales propias y verifican
  su buzón sin consultar una identidad `commercial` del mismo correo.
- La verificación no concede acceso. Una dirección activa debe aprobar la
  cuenta administrativa; la primera jefatura se designa mediante una orden
  local sobre una cuenta corporativa ya verificada.
- El panel ofrece entrada, borradores, programados, salida y enviados. Los
  borradores cifran Para, CC, CCO, asunto y cuerpo.
- El editor no acepta HTML arbitrario. Solo convierte enlaces controlados HTTPS
  o `mailto:` y escapa el resto del contenido.
- El envío inmediato y el programado usan la cola transaccional con
  `platformScope = support`. La cancelación falla si una entrega dejó la cola o
  alcanzó su hora de ejecución.
- Las preferencias son individuales y comienzan apagadas. Cada miembro decide
  si recibe por correo o Web Push avisos de tickets, conversaciones, entrada,
  retroalimentación e informes de problema.
- La selección de navegador no concede autoridad. Las suscripciones Push se
  cifran, pueden revocarse y solo se habilitan cuando existe configuración VAPID
  válida fuera de Git.
- Las migraciones PostgreSQL 47 y 48 y sus equivalentes SQLite incorporan
  `umfSupportMailDrafts`, `umfSupportNotificationPreferences` y
  `umfSupportPushSubscriptions`; el puente de datos incluye las tres tablas.

## Evidencia local

La puerta completa `npm run ci:validate` pasó 49 controles de portabilidad,
formato, lint, los tres `typecheck`, 114 archivos y 561 pruebas, las tres
compilaciones, el paquete Windows y la auditoría de dependencias. Una prueba de
servicio de despliegue quedó omitida deliberadamente porque requiere POSIX y la
ejecución se realizó en Windows. La revisión final del diff y GitHub Actions se
registran por separado cuando se completan.

## Límites operativos

Antes de afirmar que el canal está listo para uso real todavía hay que comprobar
en el entorno autorizado:

1. que las migraciones 47 y 48 están aplicadas;
2. que la entrada firmada crea una sola conversación ante duplicados;
3. que el envío inmediato y programado llega, rebota y reintenta como se espera;
4. que Para, CC y CCO cumplen el comportamiento operativo acordado;
5. que las alertas por correo llegan solo a quienes las activaron;
6. que las claves VAPID, si se decide usar Web Push, están gestionadas fuera del
   repositorio y cada dispositivo puede suscribirse y revocarse;
7. que la conservación, exportación y supresión de mensajes dispone de una
   política jurídica y operativa aprobada.

El documento vigente es [UMF Support](./UMF-SUPPORT.md); esta auditoría conserva
solo la evidencia de la fecha indicada.

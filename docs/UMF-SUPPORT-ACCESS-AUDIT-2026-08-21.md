# Auditoría del acceso inicial y cambio de correo de UMF Support

Fecha: 21 de agosto de 2026.

Esta auditoría conserva evidencia del cambio revisado en esta fecha. El estado
vigente se mantiene en [UMF Support](./UMF-SUPPORT.md),
[Arquitectura](./ARCHITECTURE.md) y
[Ciclo de vida de cuentas](./ACCOUNT-LIFECYCLE.md).

## Alcance

- inicio de la primera jefatura sin otra autoridad capaz de aprobarla;
- separación entre cuenta, cargo empresarial y permiso técnico;
- cambio del correo de acceso mediante verificación del nuevo buzón;
- disponibilidad del cambio en la seguridad de la cuenta, con independencia
  del cargo corporativo;
- cierre de la edición directa del correo desde la administración de centros;
- migraciones SQLite y PostgreSQL, sesiones, eventos y documentación.

## Riesgos encontrados y tratamiento

1. **Aprovisionamiento manual dependiente del entorno.** El comando podía
   ejecutarse contra una base distinta si no heredaba la configuración del
   servicio. La vía web usa la misma base de la aplicación y una transacción.
2. **Primero en llegar.** Permitir que cualquier cuenta verificada reclamara la
   jefatura habría abierto una carrera de toma de control. La elegibilidad
   exige el SHA-256 del correo designado en el entorno, sin incorporar su valor
   al repositorio.
3. **Reapertura por borrado.** Inferir la disponibilidad solo desde los roles
   permitiría reabrir el arranque al eliminarlos. `corporateBootstrapState`
   conserva un marcador único aunque la cuenta reclamada llegue a borrarse.
4. **Cambio directo de identidad.** La edición de usuarios de un centro podía
   sustituir el correo sin acreditar el nuevo buzón. Esa ruta ahora rechaza el
   cambio y la interfaz la presenta como solo lectura.
5. **Secuestro de una sesión viva.** Solicitar el cambio de correo exige la
   contraseña actual. Confirmarlo requiere un código hash, de seis cifras,
   quince minutos y cinco intentos enviado al nuevo buzón.
6. **Credenciales temporales antiguas.** Al completar el cambio se cierran las
   demás sesiones, se eliminan retos de recuperación, verificación y MFA de
   inicio pendientes, y se inutilizan correos temporales aún en cola.
7. **Falta de aviso.** Se encola una notificación al correo sustituido. Un fallo
   del transporte no revierte un cambio ya confirmado, pero queda reflejado en
   el evento de seguridad y exige supervisar la cola.

## Frontera de acceso resultante

La primera jefatura es una excepción de arranque, no un rol público. Después
del primer uso, las cuentas, la pertenencia al equipo, los cargos de plantilla
y los módulos siguen siendo estados separados y revocables. Este modelo toma
como referencia el patrón de agentes habilitados, equipos, roles y permisos
granulares de mesas de ayuda actuales, sin copiar su interfaz ni delegar la
autorización en el cliente.

Las referencias contrastadas fueron:

- [LibreDesk](https://libredesk.io/), por la separación explícita entre
  agentes habilitados, equipos, roles y permisos por acción;
- [Support Inbox](https://github.com/bookatechie/support-inbox), por el enfoque
  de bandeja compartida, correo primero y despliegue ligero;
- [Escalated](https://escalated.dev/), por mantener la aplicación anfitriona
  como fuente de identidad y permitir que soporte viva dentro de ella sin
  duplicar necesariamente la autenticación.

El nombre «Open Helpdesk» no identificó de forma inequívoca un único proyecto
oficial, por lo que no se atribuyó a esa referencia ninguna decisión concreta.
Estas fuentes orientan fronteras y accesibilidad; no se ha copiado código,
marca ni interfaz.

## Evidencia automatizada

Las pruebas específicas cubren la reclamación única, la persistencia del cierre
tras retirar los roles, el requisito de contraseña, el código del nuevo buzón,
el cambio efectivo de identidad, el rechazo del correo anterior y la presencia
del marcador en el aprovisionamiento operativo. La sintaxis y cobertura de la
migración PostgreSQL se validan junto al inventario portable.

La puerta integral `npm run ci:validate` terminó favorablemente con
portabilidad, formato, lint, tipos de los tres proyectos, 113 archivos de
prueba, 553 pruebas favorables, una omisión deliberada, compilaciones, paquete
Windows y auditoría de dependencias. El diff final y el resultado remoto se
revisan después de cerrar esta auditoría y no deben inferirse solo de ella.

# Auditoría del registro cerrado y reinicio de identidad de UMF Support

Fecha: 22 de agosto de 2026.

Este documento conserva la evidencia del cambio. El estado mantenido y los
procedimientos vigentes están en [UMF-SUPPORT.md](./UMF-SUPPORT.md),
[ACCOUNT-LIFECYCLE.md](./ACCOUNT-LIFECYCLE.md) y
[SELF-HOSTED-PRODUCTION.md](./SELF-HOSTED-PRODUCTION.md).

## Motivo

Una identidad comercial había acumulado relaciones de dirección y plantilla de
UMF Support. El flujo de compatibilidad posterior podía crear una identidad
corporativa y trasladar esas relaciones. Aunque preservaba los datos del
centro, mantenía una dependencia operativa entre dos cuentas que deben ser
independientes.

El modelo corregido elimina esa dependencia. La cuenta comercial y la cuenta
corporativa no comparten fila, contraseña, sesión, recuperación, verificación,
rol, cookie ni ciclo de eliminación.

## Frontera implementada

- La primera jefatura solo puede registrarse con el correo cuyo SHA-256 está
  designado en el entorno protegido y únicamente cuando no existe ninguna
  inicialización corporativa.
- El registro crea una identidad `corporate_support` pendiente con contraseña
  propia. La verificación del buzón usa el reto ordinario de seis cifras.
- Las cuentas posteriores requieren una preautorización de dirección que fija
  correo, nombre, apellidos, idioma y rol. La persona invitada no selecciona su
  autoridad.
- Un correo no preautorizado no crea usuario, solicitud ni entrega de correo.
- Las rutas públicas antiguas de solicitud y activación y los comandos de
  provisión o reanudación se han retirado junto con sus servicios.
- `platformOperators`, `facilityMemberships` y el ciclo de eliminación
  comercial no intervienen en el registro o inicio de sesión corporativo.
- La verificación de correo recibe el realm esperado. El flujo corporativo no
  ejecuta la provisión comercial asociada al alta de un centro.
- Una finalización interrumpida después de verificar el buzón puede reintentarse
  desde la misma sesión corporativa sin reutilizar ni reabrir el reto.

## Saneamiento seguro

`company:reset-support-identity` ofrece simulación por defecto y aplicación
explícita. Exige PostgreSQL configurado, repetición literal de los correos y
falla cerrada ante personal o jefatura distintos de los declarados.

El saneamiento elimina la identidad `corporate_support` objetivo, retos y
sesiones asociados, invitaciones y entregas de ámbito `support`, plantilla,
roles y marcador de inicialización. Si se declara un correo comercial con
relaciones de soporte mal ubicadas, elimina únicamente esas relaciones.

La herramienta no elimina ni modifica:

- la fila `commercial`;
- su contraseña, sesiones o recuperación;
- membresías y datos de centros;
- `platformOperators`;
- solicitudes o trabajos de eliminación comercial;
- entregas de correo con ámbito `commercial`.

La salida incluye `commercialAccountDeleted: false` para hacer visible esta
garantía durante la revisión humana del plan.

## Pruebas de regresión

Las pruebas focalizadas cubren:

1. rechazo de un correo no preautorizado sin datos retenidos;
2. alta de la primera jefatura designada, verificación y ausencia de membresía
   de centro u operador comercial;
3. preautorización de una persona y asignación exclusiva del rol fijado por
   dirección;
4. rechazo de contraseña y cookie comerciales en UMF Support;
5. mantenimiento de una eliminación comercial programada después de crear e
   iniciar sesión en la cuenta corporativa;
6. simulación y aplicación del saneamiento conservando identidad, membresía,
   operador y eliminación comercial;
7. bloqueo del saneamiento si la jefatura o el personal pertenecen a otra
   identidad;
8. persistencia del ámbito `support` en el correo de verificación;
9. reintento de la asignación corporativa tras una verificación ya consumida.

La puerta local `npm run ci:validate` terminó favorable: 48 archivos de
portabilidad, formato, lint, tres proyectos tipados, 112 archivos de pruebas
con 555 pruebas favorables y una prueba POSIX omitida en Windows, las tres
compilaciones, el paquete web de Windows y la auditoría de dependencias. La
comprobación de GitHub Actions se registra con la publicación correspondiente;
este documento no demuestra por sí solo el estado de producción ni autoriza
ejecutar el saneamiento.

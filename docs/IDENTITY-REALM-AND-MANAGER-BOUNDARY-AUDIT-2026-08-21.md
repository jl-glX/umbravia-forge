# Auditoría de separación de identidades y plano de gestores

> Nota de continuidad, 22 de agosto de 2026: la separación de realms descrita
> aquí sigue vigente, pero la contraseña de prealta ya no forma parte de las
> solicitudes nuevas de UMF Support. La activación actual crea una contraseña
> definitiva después de aprobar el rol y verificar el código del correo. El
> estado mantenido está en [UMF-SUPPORT.md](./UMF-SUPPORT.md).

Fecha: 21 de agosto de 2026.

## Motivo

La revisión partió de una cuenta comercial que había terminado reutilizada por
UMF Support. El diseño anterior permitía que la unicidad global del correo, la
cookie común y la aceptación de `platformOperators` en el portal corporativo
confundieran dos relaciones distintas: una persona usuaria o administradora de
un centro y una persona perteneciente a la plantilla de soporte de la
plataforma.

La misma revisión detectó que la consola web de gestores añadía credenciales,
sesiones, rutas y un ejecutor remoto que ya no eran necesarios para el modelo
operativo elegido.

## Frontera resultante

- `users.identityRealm` distingue `commercial` y `corporate_support`.
- La unicidad del correo se aplica a `(identityRealm, email)`. Un mismo buzón
  puede identificar dos cuentas, pero no comparte contraseña, recuperación,
  MFA, passkeys ni sesión.
- La aplicación comercial acepta `umbravia-forge_session`; UMF Support acepta
  `umf-support_session`. Los retos MFA y passkey tienen también cookies y rutas
  separadas.
- El alta comercial siempre crea una identidad `commercial`. La solicitud y
  activación de UMF Support crean una identidad `corporate_support` solo después
  de completar su aprobación y credencial previa.
- UMF Support exige una pertenencia activa en `umfSupportStaff`.
  `platformOperators` queda en el ámbito comercial y no constituye pertenencia
  ni dirección corporativa.
- La jefatura de UMF Support se representa con el rol `director` activo y el
  cargo `platform_head`; su inicialización no crea un operador comercial.

## Continuidad de una identidad anteriormente fusionada

El flujo designado de activación puede separar una jefatura histórica que aún
apunte a una identidad `commercial`. Crea la nueva identidad corporativa y
traslada únicamente las relaciones propias de soporte y empresa: plantilla,
personal de UMF Support, delegaciones corporativas, tickets, mensajes y
trazabilidad de la solicitud. Permanecen en la identidad comercial las
membresías de centros, su cierre o eliminación programada y
`platformOperators`.

No se realiza una copia masiva por correo ni una promoción implícita. La
separación exige el correo designado, la contraseña de prealta y el código
acotado de un solo uso.

## Gestores internos

Se retiran el cliente, la API y el ejecutor de la antigua terminal web. La
migración 42 elimina `managerTerminalAccess`, incluidos hashes de credenciales
y sesiones heredadas. Las migraciones históricas que crearon la tabla se
conservan para poder reproducir la secuencia y la migración de retirada la
purga al final.

Los gestores continúan siendo infraestructura compartida por la plataforma
comercial y UMF Support. Disponen de un único administrador local en Linux, no
de una consola del navegador. Cada orden o vista debe declarar explícitamente
el ámbito `commercial` o `support`; el ámbito dirige la operación al dominio
correcto y no convierte una cuenta de una aplicación en cuenta de la otra.

La admisión combina dos barreras independientes y ninguna sustituye a la otra:

1. el proceso debe ejecutarse en Linux, con un usuario local incluido
   expresamente en `UMF_MANAGER_ADMIN_LINUX_USERS`; `root` se rechaza antes de
   inicializar, abrir o migrar la base y antes de consultar una cuenta;
2. la cuenta indicada debe tener autoridad para el ámbito seleccionado.

Para `commercial` se exige una identidad `commercial` activa y verificada con
`platformOperators` activo. Para `support` se exige una identidad
`corporate_support` activa y verificada que sea simultáneamente directora
activa en `umfSupportStaff` y jefatura activa (`platform_head`) en
`companyStaffProfiles`. Una delegación de módulo, un cargo distinto o una
cuenta de centro no bastan. El administrador solo observa y coordina perfiles
registrados; no expone secretos, no ejecuta órdenes del host y no publica una
API remota.

La retirada comprende los antiguos montajes `/api/admin/*-manager`, la consola
corporativa, el ejecutor y el sandbox. Los servicios de dominio que siguen
siendo usados por tareas internas o por el administrador Linux se conservan;
la eliminación no equivale a borrar los gestores compartidos.

## Correo y señales por ámbito

La cola `emailDeliveries` conserva `platformScope` con los valores
`commercial` o `support`. Todas las funciones públicas que encolan correo
declaran el ámbito: cuentas, soporte de centros y ciclo de vida usan
`commercial`; altas, respuestas, recuperación y cambio de correo de UMF
Support usan `support`. Los reintentos, caducidades, fallos de autenticación de
la carga y errores inesperados del trabajador publican señales con el ámbito
almacenado en la fila, no con uno inferido por la vista que las consulta.

La migración PostgreSQL 44 y la inicialización SQLite equivalente asignan
`commercial` a filas históricas salvo evidencia inequívoca en relaciones de
mensajes de UMF Support. Un destinatario o un tipo de mensaje no se usan como
prueba suficiente porque el mismo correo puede existir en ambos ámbitos. La
migración preparada en el repositorio aún requiere aplicación y comprobación
controladas en el PostgreSQL autorizado.

## Evidencia automatizada del cambio

Las pruebas focalizadas del checkout comprueban:

1. migración SQLite desde la tabla global de usuarios y conservación de las
   relaciones existentes;
2. dos identidades con el mismo correo en ámbitos distintos;
3. retos de cambio de correo separados por ámbito;
4. retirada de `managerTerminalAccess` en SQLite y PostgreSQL;
5. activación de la jefatura corporativa sin crear `platformOperators`;
6. separación de la jefatura histórica sin mover membresías, cierre de cuenta
   ni autoridad comercial;
7. rechazo de contraseña y cookie comerciales en UMF Support;
8. rechazo de una identidad comercial aunque exista una relación activa
   `umfSupportStaff` cruzada o corrupta;
9. ausencia de rutas web de administración de gestores y de accesos a la
   terminal o a UMF Support desde el menú de la cuenta comercial; el único
   enlace de ayuda de ese menú es `/support`, identificado como ayuda del
   centro;
10. autoridad independiente para las vistas `commercial` y `support` del
    administrador Linux;
11. filtrado de operaciones y señales por `platformScope`;
12. persistencia del ámbito de correo en SQLite/PostgreSQL y conservación del
    ámbito en señales de fallo.
13. eliminación física de una identidad comercial sin alterar la identidad
    `corporate_support` del mismo correo ni su acceso posterior a UMF Support;
14. rechazo del identificador corporativo tanto al programar el cierre
    comercial como al seleccionar trabajos vencidos, incluso ante filas
    corruptas insertadas directamente;
15. conservación del cierre comercial programado después de iniciar sesión en
    UMF Support con la identidad corporativa del mismo correo;
16. código estable `FACILITY_MEMBERSHIP_REQUIRED` y explicación localizada en
    clases, reservas y pagos cuando la cuenta comercial no pertenece a un
    centro activo.

La validación focalizada más reciente incluye nueve archivos y 72 pruebas del
administrador compartido, los realms, el cierre comercial independiente y la
cola de correo, además del `typecheck` de cliente, servidor y trabajador.

En el checkout final, portabilidad de 48 archivos, formato, lint y los tres
`typecheck` fueron favorables. El supervisor paralelo de Vitest terminó en
Windows sin resumen, por lo que se repitió toda la suite en un solo proceso:
112 archivos, 548 pruebas superadas, ninguna fallida y una no aplicable en
Windows porque valida con `sh -n` un script POSIX. Las tres compilaciones, el
paquete Windows y la auditoría de dependencias también fueron favorables.
`git diff --check` debe repetirse tras cerrar la documentación y GitHub Actions
sigue pendiente de la publicación autorizada.

## Límites operativos

El repositorio no demuestra que las migraciones se hayan aplicado en la base
PostgreSQL autorizada ni que una identidad fusionada real haya completado el
flujo. Antes de desplegar se necesita copia recuperable, migración controlada,
comprobación de salud y prueba humana de ambos accesos. No se deben copiar al
repositorio correos reales, valores de entorno, códigos, hashes ni datos de la
cuenta afectada.

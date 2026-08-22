# Auditoría de la credencial previa de UMF Support, 2026-08-21

> Nota de continuidad, 22 de agosto de 2026: este documento conserva la
> evidencia histórica del modelo con contraseña de prealta. También ha quedado
> histórico el flujo posterior de solicitud pública y activación por código. El
> registro vigente está cerrado: dirección preautoriza la identidad y el rol,
> la persona crea una contraseña corporativa independiente y verifica el buzón
> con el reto ordinario. Véanse
> [UMF-SUPPORT.md](./UMF-SUPPORT.md) y
> [UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md](./UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md).

Esta auditoría conserva el alcance y las conclusiones del cambio revisado en
esta fecha. La descripción vigente del producto está en
[`UMF-SUPPORT.md`](./UMF-SUPPORT.md), y el código, las migraciones y las pruebas
del commit activo prevalecen si el sistema evoluciona.

La credencial de prealta sigue vigente, pero la activación posterior ya no
comparte una fila de usuario ni una sesión con la aplicación comercial: crea
una identidad `corporate_support` independiente. La continuidad y la migración
de cuentas anteriormente fusionadas se describen en la
[auditoría de separación](./IDENTITY-REALM-AND-MANAGER-BOUNDARY-AUDIT-2026-08-21.md).

## Alcance

Se revisaron el formulario público de solicitud, la aprobación corporativa, la
activación por código, la inicialización de la primera jefatura y la separación
entre una identidad de UMF Support y una membresía de centro deportivo.

## Hallazgo corregido

El flujo anterior pedía la contraseña únicamente al activar. Por tanto, el
código de aprobación confirmaba el acceso al buzón, pero no vinculaba la
activación con una credencial elegida al solicitar la cuenta. La interfaz y el
servidor podían reducir la superficie de error ligando ambos momentos sin
guardar una contraseña en claro ni convertir la solicitud en una cuenta
activa.

## Modelo aplicado

- La solicitud recibe correo y contraseña, valida la política común y conserva
  únicamente un hash Argon2id en una tabla separada de la solicitud.
- La credencial previa caduca a los siete días. Se elimina al activar, rechazar,
  caducar o agotar los intentos.
- La activación exige el mismo correo normalizado, la misma contraseña y el
  código de un solo uso enviado después de la aprobación.
- El código conserva el límite de cinco intentos y la caducidad de 24 horas. Un
  fallo de contraseña o código consume un intento sin revelar cuál falló.
- Las respuestas públicas no revelan si existe una cuenta, una solicitud o una
  dirección designada como primera jefatura.
- Solo la dirección designada para la primera jefatura puede recibir aprobación
  automática, y únicamente mientras nunca haya existido una inicialización
  corporativa. Las altas posteriores mantienen aprobación manual.
- La activación crea pertenencia corporativa y no inserta ninguna fila en
  `facilityMemberships`; compartir identidad y sesiones no convierte la cuenta
  en una cuenta de centro deportivo.
- Las solicitudes antiguas sin credencial previa no pueden aprobarse ni
  activarse con el nuevo protocolo: deben repetirse.

## Evidencias revisadas

Las pruebas de rutas cubren el almacenamiento del hash, el rechazo de una
contraseña distinta, el borrado tras la activación, la caducidad y la ausencia
de membresías de centro. Una prueba dedicada cubre además la aprobación
automática acotada de la primera jefatura, la verificación del buzón y la
creación de sus funciones corporativas.

Esta auditoría no demuestra por sí sola entrega SMTP, esquema aplicado en el
servidor ni despliegue operativo. Esas comprobaciones requieren el entorno
autorizado y una prueba humana de extremo a extremo después de publicar el
cambio validado.

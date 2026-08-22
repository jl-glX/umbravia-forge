# Auditoría del flujo de rol y activación de UMF Support, 2026-08-22

> Nota de continuidad, 22 de agosto de 2026: esta auditoría conserva el modelo
> revisado en su momento, pero ya no describe el flujo ejecutable. El registro
> vigente está cerrado, crea una identidad `corporate_support` independiente y
> verifica el buzón mediante el reto ordinario después de una preautorización
> exacta. No emite ni consume el código de activación aquí documentado. Véanse
> [UMF-SUPPORT.md](./UMF-SUPPORT.md) y
> [UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md](./UMF-SUPPORT-CLOSED-REGISTRATION-AUDIT-2026-08-22.md).

## Alcance

Esta auditoría contrasta el formulario público, la API, el servicio de dominio,
las migraciones SQLite/PostgreSQL y las pruebas del alta corporativa. No afirma
que el correo real, la migración PostgreSQL 45 ni la recuperación de una
solicitud concreta estén aplicados en producción.

## Problema corregido

El modelo anterior pedía una contraseña durante `Solicitar`, conservaba su hash
en `umfSupportAccessCredentials` y obligaba a repetirla después de la
aprobación. Eso mezclaba una petición de pertenencia con la credencial de una
cuenta que todavía no existía y podía dejar una prealta bloqueada por un dato
antiguo.

## Flujo vigente

1. `Solicitar` recibe nombre completo, apellidos, correo, idioma y rol pedido.
   No crea usuario, sesión ni contraseña.
2. Una solicitud ordinaria queda pendiente. La dirección ve expresamente el
   rol pedido antes de aprobar o rechazar.
3. La aprobación genera un código aleatorio de seis cifras, almacena solo su
   hash, limita su vigencia a 24 horas y su uso a cinco intentos, y lo encola
   exclusivamente al correo de la solicitud con ámbito `support`.
4. `Activar` exige ese correo, el código, una contraseña fuerte nueva con
   confirmación local y las aceptaciones legales.
5. Solo al consumir el código se crea la identidad `corporate_support`, se
   marca el correo como verificado y se asigna el rol aprobado. No se crea una
   membresía de centro ni autoridad comercial.

El nombre y los apellidos relacionan la solicitud con una persona y facilitan
la revisión humana. No demuestran control del buzón, no sustituyen el código y
no conceden permisos por coincidencia textual.

## Jefatura designada y compatibilidad

El correo cuyo SHA-256 normalizado está configurado fuera del repositorio puede
usar la excepción inicial controlada. En ese caso la solicitud se marca como
`director` y `designated_head`, pero la cuenta y la autoridad solo nacen al
consumir el código enviado al buzón.

La migración PostgreSQL 45 añade `requestedRole` y `activationKind` a
`umfSupportAccessRequests`; SQLite aplica el equivalente al inicializar. Para
prealtas antiguas, `activationKind` se copia desde
`umfSupportAccessCredentials`. El hash de contraseña heredado no se compara ni
autoriza la nueva cuenta y se elimina al consumir, rechazar o limpiar la
solicitud. La tabla histórica se conserva de momento para una transición
compatible, pero las solicitudes nuevas no escriben en ella.

La recuperación de una jefatura que quedó asociada a una identidad comercial
requiere correo designado, solicitud pendiente o aprobada y aplicación
operativa explícita. Renovar el código no transforma la cuenta comercial; la
autoridad se traslada a una fila corporativa independiente únicamente después
de completar la activación.

## Barreras verificadas en el repositorio

- la API rechaza campos ajenos y roles desconocidos;
- no existe una fila de usuario corporativo antes de consumir el código;
- una solicitud nueva no persiste un hash de contraseña previo;
- una credencial heredada caducada no invalida la petición de rol;
- un código consumido no puede reutilizarse;
- la contraseña definitiva cumple la política común y se crea al activar;
- el rol que se asigna es el rol revisado en la solicitud;
- las identidades comercial y corporativa pueden compartir correo sin compartir
  fila, contraseña, sesión, recuperación ni membresía;
- el correo de aprobación conserva `platformScope=support`.

## Validación

La tanda focalizada posterior al cambio pasó 8 archivos y 30 pruebas, incluidas
aprobación, activación, jefatura designada, separación de realms y migraciones
SQLite/PostgreSQL. La puerta integral `npm run ci:validate` pasó portabilidad de
49 archivos, formato, lint, los tres chequeos de tipos, 114 archivos de pruebas
con 556 pruebas favorables y una prueba POSIX omitida en Windows, las tres
compilaciones, el paquete Windows y la auditoría de dependencias. GitHub Actions
y el entorno desplegado se comprueban de forma independiente.

## Pendiente operativo

- desplegar el commit validado y aplicar la migración PostgreSQL 45;
- comprobar la solicitud designada en modo de solo lectura;
- renovar su activación con el comando documentado y verificar la entrega real
  del correo;
- crear la contraseña definitiva en `/umf-support/access` y confirmar que la
  nueva sesión usa exclusivamente `umf-support_session`;
- comprobar que la identidad comercial histórica no fue reactivada, convertida
  ni fusionada durante el proceso.

# Auditoría integral de comunidad, soporte y continuidad — 12 de agosto de 2026

> [!NOTE]
> Evidencia histórica del commit auditado. El estado vigente se mantiene en
> [SECURITY.md](./SECURITY.md) y en el [índice documental](./README.md).

**Identificador:** UF-SEC-2026-08-12-COMMUNITY-SUPPORT

**Estándar aplicado:** [Estándar interno de auditoría integral de seguridad](./SECURITY-AUDIT-STANDARD.md)

**Versión base evaluada:** `519434ef1240`, más las correcciones locales que
acompañan este informe

**Entorno:** Windows, Node.js 24.15.0, npm 11.18.0 fijado por el proyecto, API
local aislada, bases temporales y datos sintéticos desechables

## 1. Resumen ejecutivo

La revisión cubrió comunidad, contactos, mensajería, adjuntos, enlaces entre
centros, Forge Support, el selector de cuentas guardadas y la continuidad de la
validación local. También amplió el estándar interno para incorporar pruebas de
aislamiento multi-tenant, correo, pagos, privacidad, cadena de suministro,
resiliencia y observabilidad.

Se corrigieron los fallos reproducibles encontrados durante esta ronda:

1. el selector de cuentas mostraba «añadir o usar otra cuenta», pero no retiraba
   la lista para permitir introducir credenciales distintas;
2. la API de enlaces entre centros permitía que el centro solicitante intentara
   aplicar estados que deben depender de un flujo verificado del centro destino;
3. las comunidades personales no ofrecían de forma completa edición y borrado
   controlados, respuestas, miembros, adjuntos y sus operaciones de interfaz;
4. Forge Support carecía de eliminación autorizada de adjuntos y de una
   comprobación de integridad al descargarlos;
5. un miembro podía intentar asociar un adjunto comunitario a un mensaje ajeno
   dentro de la misma comunidad;
6. el borrado de un mensaje y sus adjuntos no estaba agrupado en una única
   transacción de datos con retirada reversible previa de los archivos;
7. las consultas de identidad de contactos crecían una por una en vez de
   resolverse en un lote;
8. los scripts compuestos podían empezar con el npm fijado por el proyecto y
   volver a resolver después un npm global distinto;
9. el cierre completo de cuenta se presentaba como una demostración y no
   ejecutaba la eliminación al finalizar el periodo de gracia;
10. la confirmación de cierre podía leer un valor antiguo del campo de
    contraseña cuando un gestor como Proton Pass completaba el formulario;
11. las cuentas sin una política de borrado automático no tenían un flujo
    verificable para detectar abandono después de seis meses;
12. un registro de retención ya marcado para eliminación se trataba como si
    fuera una retención legal activa.

Tras las correcciones, la validación integral supera 90 archivos y 439 pruebas,
formato, análisis estático, tipos, compilación de cliente, servidor y Worker de
correo, portabilidad y auditoría de dependencias. La sonda local supera 18 de
18 escenarios y la evaluación de contraseñas utiliza exclusivamente material
sintético generado para el laboratorio.

No se confirmó ninguna vulnerabilidad crítica ni alta explotable dentro del
alcance local. Permanece la excepción temporal y acotada de React Router ya
documentada, y continúa pendiente la coordinación del limitador entre varias
instancias antes de un futuro escalado horizontal.

**Resultado:** superada con excepciones para el árbol local evaluado. No se
consideran validados el despliegue, la release activa, el esquema real, el
correo externo ni los flujos con cuentas sintéticas persistentes hasta realizar
sus comprobaciones específicas después de publicar.

## 2. Ficha de alcance y reglas de intervención

| Campo               | Valor                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Activo autorizado   | Copia de trabajo local del repositorio Umbravia Forge                                |
| Superficie dinámica | API local enlazada únicamente a la interfaz de bucle local                           |
| Modalidades         | Caja blanca, caja gris automatizada, caja negra local y BAS limitado                 |
| Identidades         | Cuentas efímeras de socio, entrenador y administrador creadas por las pruebas        |
| Datos               | Bases temporales, archivos y credenciales exclusivamente sintéticos                  |
| Carga máxima        | 64 lecturas de salud y 14 intentos de acceso acotados                                |
| Parada              | Indisponibilidad, escritura fuera del área temporal o proceso no identificado        |
| Exclusiones         | Producción, servidor, DNS, correo externo, pagos reales, red interna, Wi-Fi y físico |

No se utilizaron credenciales reales, cuentas personales, códigos MFA, claves
de producción ni datos privados. No se modificaron secretos, valores de claves,
migraciones, temporizadores ni unidades de servicio.

## 3. Matriz de comprobaciones

| Control                             | Resultado esperado                                                    | Resultado observado                                                    | Estado                       |
| ----------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| Selector de cuentas                 | «Usar otra» deja disponible el formulario                             | Oculta el selector y limpia estado previo sin borrar cuentas guardadas | Superado por implementación  |
| Contactos                           | Mostrar identidad asociada sin consultas crecientes                   | Identidades resueltas en lote y decoradas para la interfaz             | Superado                     |
| Mensajes                            | Autor edita; autor o gestor elimina; denunciados pasan por moderación | Propiedad, estado y moderación comprobados con regresiones             | Superado                     |
| Mensajes privados administrados     | Contenido no legible en almacenamiento                                | Cuerpo protegido y revelado únicamente al miembro autorizado           | Superado                     |
| Miembros de comunidad               | Propietario invita contactos; salida y expulsión controladas          | Propietario no eliminable y acceso revocado al salir                   | Superado                     |
| Adjuntos de comunidad               | Tamaño, tipo, propiedad, cifrado e integridad                         | Asociación ajena rechazada; descarga e integridad verificadas          | Superado                     |
| Borrado mensaje-adjuntos            | Sin estado parcial si falla la actualización                          | Archivos preparados y operación de datos transaccional                 | Superado                     |
| Enlaces entre centros               | El solicitante no confirma al destino                                 | Estados del destino fallan de forma cerrada                            | Superado con flujo pendiente |
| Adjuntos de soporte                 | Uploader o personal autorizado; archivo físico y registro coherentes  | Eliminación escalonada, evento y regresión de acceso                   | Superado                     |
| Integridad de adjuntos de soporte   | Rechazar contenido que no coincide con su huella                      | Descarga alterada rechazada con error genérico                         | Superado                     |
| Limpieza física diferida            | No ocultar un fallo posterior a la confirmación lógica                | Señal saneada al coordinador sin restaurar una copia inaccesible       | Superado                     |
| Cierre completo de cuenta           | Gracia reversible y eliminación física posterior                      | Job ejecutable, doble preflight y retirada física escalonada           | Superado                     |
| Confirmación reforzada              | Contraseña real y TOTP cuando MFA está activo                         | Autorrelleno leído del formulario; TOTP específico y códigos estables  | Superado                     |
| Secretos durante la gracia          | Reducir superficie sin impedir recuperar la cuenta                    | Retira desafíos y otras sesiones; conserva contraseña, MFA y sesión    | Superado                     |
| Inactividad sin regla configurada   | Pregunta tras seis meses y decisiones no ambiguas                     | Correo, recordatorio, dos fases y gracia de 30 días                    | Superado localmente          |
| Retención legal                     | Bloquear retención real, no datos ya destinados a borrado             | `retained` y `legal_hold` bloquean; `scheduled_deletion` no            | Superado                     |
| Portabilidad del gestor de paquetes | Un solo npm durante toda la cadena                                    | Los scripts reutilizan el punto de entrada que inició la ejecución     | Superado                     |
| Caja negra local                    | Errores defensivos, CORS, límites y métodos seguros                   | 18 de 18 escenarios superados                                          | Superado                     |
| Dependencias                        | Ningún aviso fuera de excepción explícita                             | Auditoría CI favorable                                                 | Superado con excepción       |

## 4. Correcciones funcionales y de seguridad

### UF-2026-12 — Transiciones no verificadas en enlaces entre centros

**Severidad:** media

**Estado:** corregido de forma cerrada

El centro solicitante podía enviar estados que conceptualmente correspondían a
la aceptación, rechazo o suspensión por parte del centro destino. La ruta ahora
solo permite al origen terminar o retirar su propia conexión y rechaza el resto
con un código estable. La aceptación completa requiere modelar la identidad del
centro destino y su flujo verificado; no se ha simulado una aceptación sin ese
modelo.

### UF-2026-13 — Asociación de adjuntos a mensajes ajenos

**Severidad:** media

**Estado:** corregido

Un miembro de una comunidad podía indicar el identificador de un mensaje activo
del mismo canal al subir un archivo, aunque no fuera su autor. La asociación
ahora exige que el usuario sea autor del mensaje y que este continúe activo. La
prueba confirma que el intento ajeno se rechaza sin revelar el estado interno
del mensaje.

### UF-2026-14 — Borrado compuesto de mensaje y adjuntos

**Severidad:** media

**Estado:** corregido

La retirada anterior eliminaba adjuntos de uno en uno antes de actualizar el
mensaje. Un fallo intermedio podía dejar el conjunto parcialmente modificado.
Ahora los archivos se renombran primero a una ubicación de limpieza reversible,
las operaciones de base de datos se ejecutan en una transacción y cualquier
fallo restaura los archivos. La eliminación física posterior y los eventos de
auditoría no convierten una eliminación lógica confirmada en un falso fallo para
el usuario.

### UF-2026-15 — Integridad de adjuntos de soporte no comprobada al leer

**Severidad:** media

**Estado:** corregido

Forge Support almacenaba una huella SHA-256 del contenido original, pero la
descarga solo autenticaba el sobre cifrado. Ahora recalcula y compara la huella
después de descifrar. Una discrepancia devuelve un error interno genérico sin
entregar el archivo ni su contenido.

### UF-2026-16 — Resolución inconsistente de npm en scripts compuestos

**Severidad:** baja

**Estado:** corregido

En equipos con otra versión global de npm, los pasos escritos como `npm run`
podían abandonar npm 11.18.0 tras comenzar la validación. Un lanzador portable
reutiliza ahora `npm_execpath` mediante Node y ejecuta cada subscript sin shell.
Una regresión prohíbe volver a introducir invocaciones compuestas dependientes
del ejecutable global.

### UF-2026-17 — Acción decorativa en el selector de cuentas

**Severidad:** baja, funcional

**Estado:** corregido localmente; comprobación visual pública pendiente

La acción ya cambia el estado de la pantalla, oculta la lista y limpia los datos
de autenticación anteriores para mostrar el formulario normal. No borra las
cuentas recordadas ni conserva contraseñas. La comprobación en la web pública
queda pendiente de la publicación y activación de esta versión.

### UF-2026-18 — Cierre completo decorativo y confirmación inconsistente

**Severidad:** alta, privacidad y control de cuenta

**Estado:** corregido localmente; activación pública pendiente

El botón de cierre completo solo guardaba un borrador y el trabajo diferido no
estaba habilitado. Ahora una contraseña válida autoriza una solicitud única,
revocable durante 30 días, y el ejecutor elimina físicamente la cuenta cuando
vence la gracia. Si la cuenta tiene MFA, exige además un TOTP vigente; no acepta
códigos de recuperación como sustituto silencioso. El valor de la contraseña se
lee del formulario enviado para respetar el autorrelleno de gestores de
contraseñas, evitando el falso `Invalid security confirmation` observado.

Antes de destruir credenciales definitivas se repiten las comprobaciones de
propiedad, retención y referencias que requieren revisión. Los adjuntos se
preparan de forma reversible; si la transacción falla, los archivos vuelven a
su ubicación. Solo en la transacción final se inutiliza la contraseña y se
eliminan MFA, passkeys, sesiones y colas de correo, inmediatamente antes de
eliminar al usuario.

### UF-2026-19 — Limpieza anticipada sin garantía de notificación

**Severidad:** media

**Estado:** corregido

Durante la gracia solo se eliminan desafíos temporales y las demás sesiones; la
contraseña, los factores MFA, las passkeys y la sesión que confirma la operación
siguen disponibles para cancelar o recuperar la cuenta. La notificación cifrada
se encola antes de esa limpieza. Si la limpieza falla, la entrega se marca como
obsoleta y se destruye su carga cifrada para no afirmar que ocurrió algo que no
se completó.

### UF-2026-20 — Cuentas sin regla de inactividad

**Severidad:** media, higiene y privacidad

**Estado:** corregido localmente; entrega externa pendiente

Una cuenta activa sin borrado automático configurado entra en revisión después
de seis meses sin actividad significativa. El primer correo pregunta si sigue
en uso, concede 14 días y recuerda la decisión a mitad del plazo. «Sí» cierra la
revisión; «no» abre una segunda confirmación sin caducidad automática. Solo un
«sí» expreso a borrar, o el silencio ante la primera pregunta, inicia la gracia
reversible de 30 días. Un «no» en la segunda pregunta conserva la cuenta.

### UF-2026-21 — Confusión entre retención y eliminación programada

**Severidad:** media

**Estado:** corregido

El ejecutor consideraba bloqueante un registro cuyo estado ya era
`scheduled_deletion`. Ahora solo `retained` y `legal_hold` paralizan el cierre y
solicitan revisión. Una regresión confirma que el registro listo para eliminar
no impide el cierre y que su referencia al usuario queda disociada de acuerdo
con el esquema existente.

## 5. Cobertura funcional añadida

- contactos con nombre y alias visibles según la relación existente;
- edición, respuesta y borrado controlado de mensajes;
- protección contra la desaparición de contenido denunciado antes de moderar;
- comunidades personales con lista, alta y baja de miembros;
- carga, listado, descarga y eliminación de adjuntos cifrados;
- confirmaciones personalizadas en vez de diálogos nativos para las acciones
  nuevas de la interfaz;
- retirada autorizada de adjuntos de soporte;
- textos completos en español, inglés, alemán y alemán suizo;
- estados del enlace entre centros limitados al actor que realmente puede
  decidirlos;
- raíz pública servida por la experiencia comercial, conservando el inicio
  interno para sesiones activas;
- errores de ciclo de vida y cierre traducidos desde códigos estables, sin
  mostrar mensajes internos en la interfaz.

## 6. Evidencias reproducibles

```bash
npm run ci:validate
npm run security:probe
npm run security:password-resilience
npm test -- server/routes/community.test.ts server/routes/support.test.ts
```

Resultados observados:

- validación integral: 90 archivos y 439 pruebas superadas;
- pruebas dirigidas de comunidad y soporte: 2 archivos y 16 pruebas superadas;
- formato, lint y tipos: superados;
- compilación: cliente, servidor y Worker de correo completados;
- portabilidad: 38 archivos operativos revisados;
- sonda local: 18 de 18 escenarios superados;
- contraseñas: Argon2id con material exclusivamente sintético;
- dependencias: sin vulnerabilidades fuera de una excepción explícita,
  versionada y acotada.

## 7. Riesgos residuales y límites

### UF-2026-06 — Limitación no coordinada entre instancias

**Severidad:** media

**Estado:** heredado, no aplicable al despliegue de una sola instancia

La limitación funciona en la instancia evaluada, pero su estado no se comparte
entre varios procesos o servidores. Debe migrarse a almacenamiento coordinado
antes de un escalado horizontal. No se presenta como un fallo corregido porque
la arquitectura multiinstancia todavía no forma parte del entorno activo
validado.

### Excepción temporal de React Router

La política de dependencias conserva exclusivamente el aviso RSC documentado
para la versión fijada de React Router. La aplicación utiliza enrutamiento
declarativo del cliente y no activa el modo afectado. Cualquier otro aviso,
paquete o versión continúa bloqueando la validación.

### Flujo destino de enlaces entre centros

La ruta queda segura porque falla de forma cerrada, pero la aceptación real no
se considera implementada. Necesita identidad persistente del centro destino,
autorización de su administrador, notificación, caducidad y auditoría. No se
añadió una migración improvisada durante esta auditoría.

## 8. Superficies no evaluadas

No se consideran superadas:

- release activa, servicios y esquema de las bases de producción;
- temporizadores y proceso de actualización del servidor;
- entrega y recepción real de correo, SPF, DKIM, DMARC y reputación;
- Cloudflare, proxy, origen e IPv6 del entorno público;
- Stripe, webhooks, pagos, suscripciones, devoluciones y portal reales;
- selector de cuentas y flujos completos en la versión pública todavía activa;
- creación y ciclo de vida de nuevas cuentas sintéticas persistentes;
- fuerza bruta controlada, abuso entre cuentas sintéticas y aislamiento real
  posterior al despliegue;
- copias de seguridad y restauración bajo esta versión concreta;
- red interna, Active Directory, Wi-Fi y seguridad física.

## 9. Criterio de cierre

La implementación local queda apta para preparar su publicación cuando:

1. la validación integral vuelva a ejecutarse después de incorporar este
   informe y no cambie el resultado;
2. Git y GitHub estén autenticados y el alcance del commit sea exclusivamente
   el revisado;
3. GitHub Actions termine con resultado favorable;
4. el actualizador active la release y se comprueben servicio, salud y esquema;
5. se creen cuentas sintéticas recuperables de socio y administrador, con ciclo
   de vida de seis meses, para verificar los flujos públicos;
6. las pruebas de abuso autorizadas se limiten a esas cuentas desechables y no
   degraden el servicio.

Hasta completar esos pasos, este informe acredita únicamente la superficie
local descrita y no equivale a validación de producción.

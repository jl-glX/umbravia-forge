# Gestor de entornos y motores de datos

## Decisión de arquitectura

PostgreSQL es el motor principal de Umbravia Forge para `staging` y
`production`. SQLite se conserva únicamente para:

- desarrollo local;
- pruebas automatizadas;
- demostraciones aisladas para nuevos clientes;
- MVP comerciales autocontenidos sin alta disponibilidad.

La aplicación no mantiene dos lógicas de negocio independientes. Los servicios
usan una fachada Kysely común y el proveedor se decide antes de arrancar.

## Coordinación

El gestor de entornos forma parte del mismo coordinador que los gestores de
cuentas, seguridad y recursos. La creación y revisión de un entorno reclama los
ámbitos `database-maintenance` y `environment:<id>`. Una tarea de recursos no
puede modificar el mismo ámbito mientras esa operación esté activa.

El gestor de recursos ejecuta periódicamente una auditoría de preparación de
los entornos registrados. Solo inspecciona archivos administrados por Umbravia
Forge y no busca ni elimina bases externas.

## Creación de entornos SQLite

Cada entorno se crea bajo `ENVIRONMENT_DATA_ROOT` con:

- un directorio derivado de un identificador validado;
- una base `database.sqlite` con el esquema completo;
- un manifiesto `environment.json` sin secretos;
- nombre, idioma, tipo de entorno y plantilla de partida.

No se copian usuarios ni datos desde la base activa. Así se evita que una demo
nazca con información de otra instalación.

## Promoción a PostgreSQL

La fase disponible es deliberadamente no destructiva:

1. verifica que la base SQLite pertenece a un entorno administrado;
2. comprueba que contiene todas las tablas esperadas;
3. cuenta registros por tabla y por categoría;
4. identifica la presencia de identidad, facturación, comunidad o seguridad;
5. genera salvaguardas y exclusiones obligatorias.

La ejecución permanece desactivada hasta disponer de un destino PostgreSQL
concreto y autorizado. Como mínimo, el procedimiento futuro deberá:

- comprobar una huella inequívoca del destino;
- exigir una base operativa vacía;
- crear una copia SQLite restaurable;
- excluir sesiones, retos, MFA y passkeys por defecto;
- requerir aprobación explícita para identidad, facturación y conversaciones;
- ejecutar la carga en transacción y por orden de dependencias;
- comparar recuentos antes de confirmar;
- registrar auditoría sin guardar secretos ni cadenas de conexión.

## Límite multi-centro

El esquema actual incorpora perfiles y membresías de centro y aplica el tenant
resuelto por el servidor a las áreas operativas principales. `primary` se
conserva como compatibilidad, no como prueba de que el sistema siga limitado a
un único centro.

La promoción disponible sigue sirviendo para inventariar una instancia SQLite
completa y preparar su traslado a una base PostgreSQL vacía; no fusiona varios
clientes ni ejecuta transferencias. Antes de usarla con datos reales se debe
validar el esquema PostgreSQL, la separación de cada categoría, las claves y
adjuntos asociados, los recuentos, la restauración y los rechazos
cross-facility en el destino autorizado.

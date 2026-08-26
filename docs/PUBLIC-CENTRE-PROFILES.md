# Fichas públicas de centros

Estado vigente: **implementado y probado en el repositorio; pendiente de
validación visual y operativa en el entorno publicado**.

## Finalidad y control editorial

El alta comercial permite preparar una ficha para que una persona interesada
pueda consultar centros disponibles en Umbravia Forge. El recorrido separa
identidad, marca, ubicación, dirección digital, redes, actividad y las tarifas
o bonos del propio centro. Salvo los datos imprescindibles para crear la
prueba, el contenido público es opcional y puede completarse más tarde.

La ficha no se publica por terminar un paso ni por finalizar la prueba. La
jefatura o una administración autorizada revisa la vista previa y utiliza una
acción explícita de **Publicar ficha**. Puede seguir editándola durante y después
de la prueba, retirarla sin borrar el contenido o eliminar la ficha pública con
una confirmación diferenciada. Estas acciones no eliminan la cuenta comercial,
la prueba ni sus datos privados.

## Datos públicos y privados

La API pública solo devuelve fichas publicadas y campos destinados al público:
nombre, marca, tipo de centro, descripción, ubicación, actividades, horario,
tarifas y bonos del centro, enlaces elegidos y, cuando exista consentimiento
específico, el teléfono. No expone correo de acceso, identificadores internos,
estado de la prueba ni datos de soporte.

El teléfono tiene dos funciones independientes:

- puede emplearse como identificador de inicio de sesión de la cuenta;
- puede mostrarse voluntariamente en la ficha pública.

Guardar un teléfono no lo publica. La visibilidad está desactivada por defecto
y solo la jefatura puede activarla o retirarla. Cambiar el número de acceso
exige membresía de jefatura, contraseña actual, segundo factor cuando esté
habilitado y una verificación reciente del formulario. Si se elimina el número,
el servidor desactiva su publicación en la misma transacción.

## Dirección digital

Durante la prueba, el formulario presenta el slug editable junto al dominio
padre para que la dirección sea comprensible. El slug queda reservado y, al
terminar la prueba, deja de ser editable. Esta reserva no demuestra por sí sola
que DNS, TLS o el proxy wildcard estén activados; esa frontera se mantiene en
[Subdominios por centro](./TENANT-SUBDOMAINS.md).

## Fronteras de autorización

- Las mutaciones privadas exigen sesión, centro seleccionado y rol autorizado.
- La visibilidad del teléfono exige específicamente la jefatura.
- La selección por hostname nunca sustituye la membresía del servidor.
- Las acciones de UMF Support sobre una prueba requieren dirección corporativa
  y verificación reciente; borrar una prueba conserva la cuenta comercial.
- Una cuenta con borrado programado se muestra como tal y no se incluye en la
  métrica de administraciones comerciales activas.

## Validación pendiente

Las pruebas del repositorio cubren creación, edición, publicación, retirada,
consulta pública, teléfono privado por defecto, activación voluntaria,
eliminación del número y controles de soporte. Antes de presentar la capacidad
como disponible en producción deben comprobarse el esquema PostgreSQL aplicado,
la navegación pública, accesibilidad, DNS/TLS de subdominios y el recorrido
humano completo en el servidor autorizado.

# Migración segura del transporte de correo directo

## Alcance

Esta fase permite que Forge Notify entregue correo transaccional directamente
al servidor MX del destinatario sin depender de Postfix ni de un relay SMTP.
La lógica de producto no cambia: plantillas, cola cifrada, reintentos,
saneamiento y coordinación continúan perteneciendo al gestor de correo.

La migración es deliberadamente reversible. La incorporación del transporte
no activa el modo directo por sí sola y no modifica DNS, claves, Postfix ni el
archivo de entorno de producción.

```text
Cuenta o Forge Support
        -> plantilla localizada
        -> cola cifrada e idempotente
        -> trabajador de Forge Notify
        -> transporte seleccionado
             |-- smtp: Postfix o relay (retorno seguro)
             `-- direct_mx: MX remoto por IPv4 y STARTTLS obligatorio
```

La recepción de mensajes de soporte sigue en Cloudflare Email Routing y el
Worker firmado existente. Sustituir esa frontera por un receptor SMTP público
exigiría, como proyecto separado, filtrado antispam, límites de tamaño,
validación MIME, protección frente a relay abierto, gestión de abuso y alta
disponibilidad. No debe mezclarse con el cambio de salida.

## Garantías del modo `direct_mx`

- resuelve el MX según prioridad y aplica el MX implícito previsto por SMTP;
- respeta `Null MX` y no intenta entregar a dominios que rechazan correo;
- usa exclusivamente IPv4 mientras la identidad SMTP IPv6 no esté validada;
- conserva el nombre del MX para SNI y valida el certificado TLS;
- exige STARTTLS y aborta si el destinatario no ofrece una conexión cifrada;
- firma cada mensaje con DKIM en memoria;
- alinea el dominio del remitente y el dominio DKIM;
- usa un sobre SMTP explícito y no expone la clave en logs;
- diferencia rechazos permanentes de fallos temporales para no mantener colas
  imposibles de entregar.

Exigir STARTTLS mejora la confidencialidad del primer salto, pero puede impedir
la entrega a servidores antiguos sin TLS. Ese fallo se trata como temporal y
queda visible en el gestor de correo; no se degrada silenciosamente a texto
claro.

## Configuración declarativa

Los nombres necesarios son los siguientes. Los valores reales y el material
privado deben permanecer fuera de Git:

```text
EMAIL_TRANSPORT_MODE=direct_mx
EMAIL_FROM=<nombre y remitente alineado con el dominio DKIM>
EMAIL_DIRECT_HELO_NAME=<host con A y PTR coherentes>
EMAIL_DIRECT_LOCAL_ADDRESS=<IPv4 local opcional>
EMAIL_DKIM_DOMAIN=<dominio del remitente>
EMAIL_DKIM_SELECTOR=<selector publicado>
EMAIL_DKIM_PRIVATE_KEY_PATH=<ruta absoluta fuera del repositorio>
EMAIL_QUEUE_ENCRYPTION_KEY=<clave de cola ya existente>
```

El proceso de preparación de release comprueba únicamente la presencia de la
ruta DKIM, que sea un archivo regular sin enlace simbólico y que tenga permisos
`600` o `640`. El proceso Node abre el archivo sin seguir enlaces, limita su
tamaño, comprueba el formato PEM y rechaza permisos amplios en producción.
Ninguna comprobación imprime el contenido.

## Puntos de restauración

1. **Código disponible, transporte inactivo.** Producción continúa con
   `EMAIL_TRANSPORT_MODE=smtp` y Postfix. Es el estado de esta entrega.
2. **Prueba controlada.** Se habilita el modo directo únicamente después de
   validar la identidad pública y el acceso de solo lectura a la clave.
3. **Periodo de observación.** Postfix permanece instalado y disponible como
   retorno, sin eliminar configuración ni claves.
4. **Retirada futura.** Solo después de varias pruebas externas favorables se
   podrá dejar de depender operativamente de Postfix. Su desinstalación no
   forma parte de esta migración.

Para volver al transporte anterior se restaura el modo `smtp` y su
configuración previamente validada, y se reinicia únicamente la aplicación.
No hace falta revertir migraciones de base de datos porque este cambio no crea
ni altera tablas.

## Validación antes de activar

La activación requiere intervención humana porque el repositorio no debe
contener ni gestionar la clave DKIM real.

1. Confirmar que el hostname de saludo resuelve a la IPv4 de salida y que su
   PTR vuelve al mismo hostname.
2. Confirmar SPF, DKIM y DMARC alineados sin sustituir registros existentes a
   ciegas.
3. Dar al usuario del servicio acceso de solo lectura al archivo DKIM mediante
   un mecanismo de credenciales o permisos restringidos.
4. Ejecutar la comprobación de preparación y una entrega controlada a buzones
   de Outlook, Gmail, Proton y Tuta.
5. Verificar aceptación SMTP, llegada real, autenticación en el origen del
   mensaje, clasificación y latencia.
6. Comprobar reintentos, rechazo permanente, saneamiento y alertas del gestor.
7. Mantener el retorno a Postfix durante el periodo de observación.

Una respuesta SMTP `250` confirma que el servidor remoto aceptó el mensaje,
no que llegó a la bandeja de entrada. La sustitución se considera operativa
solo después de una prueba de extremo a extremo y de revisar la clasificación
del destinatario.

## Trabajo posterior delimitado

- dirección de retorno diferenciada para rebotes asíncronos;
- receptor autenticado de DSN y quejas;
- lista de supresión y política por motivo;
- métricas de reputación y entregabilidad por proveedor;
- rotación asistida de DKIM sin exponer la clave;
- evaluación independiente de un receptor SMTP propio para correo entrante.

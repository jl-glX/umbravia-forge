# Correo entrante de Forge Support

## Objetivo

Forge Support puede recibir correo sin exponer Postfix a Internet. La salida y
la entrada usan fronteras distintas:

```text
Salida
Aplicación -> cola cifrada -> Postfix local -> Internet por IPv4

Entrada
Internet -> Cloudflare Email Routing -> Email Worker
         -> webhook HTTPS firmado -> Forge Support
```

El proxy web de Cloudflare y sus direcciones IPv6 no son direcciones del MTA.
El host de correo saliente conserva su DNS sin proxy y no debe publicar un AAAA
hasta que la identidad y reputación SMTP de la IPv6 real estén preparadas.

## Alcance seguro inicial

- `support@dominio` crea un ticket solo para una cuenta activa cuyo correo ya
  está verificado.
- Las respuestas del equipo usan un `Reply-To` con subdireccionamiento. La
  etiqueta contiene el identificador público y un token HMAC ligado al ticket
  y al solicitante.
- Una respuesta se acepta solo si la firma del Worker es reciente, el token es
  correcto y el remitente coincide con la cuenta verificada del ticket.
- `Message-ID` se transforma en un hash y un identificador determinista para
  que un reintento no duplique el mensaje, sin añadir una migración.
- El cuerpo citado de respuestas anteriores se elimina antes de guardarlo.
- Las notas internas nunca se aceptan por correo.
- Los mensajes automáticos, masivos y con adjuntos se rechazan. Los adjuntos
  requieren antes cuarentena, límites y análisis antimalware.
- El Worker no escribe cuerpos ni remitentes en sus registros.

## Configuración de la aplicación

La recepción permanece cerrada con los valores predeterminados. Para activarla
se necesitan dos secretos independientes de 32 bytes en base64:

```text
EMAIL_PUBLIC_INBOUND_ENABLED=true
EMAIL_PUBLIC_INBOUND_PROVIDER=cloudflare
SUPPORT_EMAIL_INBOUND_ENABLED=true
SUPPORT_EMAIL_ADDRESS=support@example.com
SUPPORT_EMAIL_REPLY_TOKEN_KEY=<secreto exclusivo>
SUPPORT_EMAIL_WEBHOOK_SECRET=<otro secreto exclusivo>
```

No se deben reutilizar las claves de MFA, cifrado privado, interconexiones de
gestores, DKIM o cola de correo. Los valores reales viven en el entorno de
producción y en los secretos del Worker; nunca en Git.

El Worker necesita estos enlaces:

```text
SUPPORT_INBOUND_ENDPOINT=https://app.example.com/api/internal/support-email
SUPPORT_INBOUND_WEBHOOK_SECRET=<mismo secreto del webhook de la aplicación>
```

El código fuente está en `cloudflare/support-email/` y el artefacto se genera
con `npm run build:support-email-worker`.

## Orden de activación

1. Ejecutar `npm run ci:validate` y revisar el artefacto del Worker.
2. Guardar los dos secretos nuevos fuera de Git. No sustituir claves existentes.
3. Desplegar el Worker y configurar sus dos enlaces.
4. Incorporar Email Routing sin borrar DNS existente: conservar el SPF de
   salida y combinarlo con la autorización que exija Cloudflare en un único
   registro SPF; conservar el DKIM `forge` y añadir el DKIM administrado de
   Cloudflare.
5. Habilitar subdireccionamiento y crear únicamente la regla de
   `support@dominio` hacia el Worker. No habilitar un catch-all de entrega.
6. Publicar los MX de Cloudflare y comprobar que el host `mail` continúa como
   DNS-only. No abrir el puerto SMTP público del servidor.
7. Activar las variables de la aplicación, validar su configuración y reiniciar
   de forma controlada.
8. Probar desde una cuenta externa: ticket nuevo, respuesta válida, duplicado,
   remitente incorrecto, token incorrecto, mensaje automático y adjunto.
9. Confirmar que la salida sigue usando Postfix, que SPF/DKIM/DMARC pasan y que
   la respuesta aparece una sola vez en Forge Support.

La activación DNS debe hacerse al final porque anunciar MX antes de que el
Worker y la aplicación estén listos provocaría rechazos o pérdida de correo.

## Reversión

La entrada puede detenerse sin afectar al envío:

1. desactivar la regla de Email Routing;
2. establecer `SUPPORT_EMAIL_INBOUND_ENABLED=false` en la aplicación;
3. retirar los MX solo después de decidir qué respuesta deben recibir los
   remitentes durante la incidencia.

Postfix permanece local y Forge Notify conserva la cola saliente durante toda
la reversión.

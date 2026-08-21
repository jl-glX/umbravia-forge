# UMF Support

## Propósito y frontera

UMF Support es la aplicación corporativa para atender incidencias de la
plataforma Umbravia Forge y gestionar el canal de correo corporativo. No es el
panel que cada centro usa para atender a sus socios:

| Ámbito           | Aplicación                                          | Autoridad y datos                                                                                            |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Centro deportivo | Forge Support, `/support`, API `/api/support`       | Membresía activa del centro; tickets, agentes y conocimiento aislados por `facilityId`                       |
| Plataforma       | UMF Support, `/umf-support`, API `/api/umf-support` | Operador de plataforma o personal corporativo aprobado; tablas y permisos independientes de cualquier centro |

Una cuenta administradora de centro no puede entrar en UMF Support. Pertenecer
a UMF Support tampoco concede acceso a un centro. La interfaz reutiliza
componentes técnicos básicos, pero usa una presentación sobria propia y no la
identidad visual de la pantalla comercial.

La aplicación sigue siendo web. El repositorio prepara un ZIP de prueba para
instalar un lanzador Windows basado en el modo aplicación de Edge, también
reutilizable por la aplicación principal. No es todavía un cliente nativo ni
un modo sin conexión; véase
[Paquete de aplicaciones web para Windows](./WINDOWS-WEB-APP-PACKAGE.md).

## Capacidades implementadas

- inicio de sesión específico en el portal `support`, incluido el segundo
  factor cuando la cuenta lo tiene activo;
- solicitud pública de acceso protegida frente a abuso;
- aprobación o rechazo manual por dirección;
- código numérico de activación de un solo uso, válido durante 24 horas, con
  cinco intentos como máximo y persistido únicamente como hash;
- creación de cuenta solo después de consumir una solicitud aprobada y aceptar
  expresamente términos y privacidad;
- personal corporativo con roles `director` y `agent`, revocable sin alterar
  las membresías de centros;
- cola de tickets con categorías, prioridad, estado, asignación, objetivos de
  primera respuesta y resolución;
- categoría propia de privacidad y derechos;
- mensajes entrantes, salientes y notas internas cifrados con el dominio de
  contenido privado de UMF Support;
- bandejas de entrada y enviados con el estado disponible de la cola de
  entrega;
- respuestas por la cola transaccional existente, sin guardar tarjetas ni
  credenciales de proveedor;
- receptor servidor-a-servidor con firma HMAC reciente, deduplicación por
  `Message-ID`, rechazo de adjuntos y alias de respuesta ligados al ticket y al
  correo solicitante.
- eventos de seguridad sin correos en claro para solicitudes, aprobaciones,
  rechazos, activaciones fallidas o completadas y cambios de personal;
- registro de acceso al contenido privado al abrir tickets o bandejas.

Los operadores activos de `platformOperators` son la autoridad de dirección
inicial. No se fija en el código el nombre, el correo ni una contraseña de una
persona concreta. Las incorporaciones posteriores necesitan la aprobación de
esa autoridad y no pueden autoasignarse el rol de dirección.

## Flujo de una solicitud de privacidad

```text
persona interesada
  -> correo corporativo publicado
  -> Cloudflare Email Routing y Worker dedicado
  -> webhook HTTPS firmado
  -> ticket UMF-* de privacidad
  -> revisión por personal corporativo autorizado
  -> respuesta en UMF Support
  -> cola cifrada y transporte saliente
  -> estado de entrega disponible en Enviados
```

El asunto se clasifica como privacidad cuando contiene expresiones inequívocas
de acceso, rectificación, supresión, oposición, portabilidad o protección de
datos en los idiomas mantenidos. El personal puede corregir la categoría. La
clasificación ayuda al enrutamiento, pero no decide si el derecho procede ni
sustituye la verificación de identidad y la revisión humana.

No se debe publicar una dirección de privacidad hasta demostrar el circuito de
extremo a extremo con correo externo: recepción, deduplicación, creación de un
único ticket, respuesta, autenticación del alias, entrega, rebote y registro de
la actuación. Aceptar un mensaje en la cola no demuestra que haya llegado a la
bandeja de entrada.

## Configuración desactivada por defecto

La salida utiliza Forge Notify y su transporte configurado. La entrada
corporativa permanece cerrada mientras no se habiliten estos nombres en el
entorno autorizado, con valores reales fuera de Git:

```text
EMAIL_PUBLIC_INBOUND_ENABLED=true
EMAIL_PUBLIC_INBOUND_PROVIDER=cloudflare
UMF_SUPPORT_EMAIL_INBOUND_ENABLED=true
UMF_SUPPORT_EMAIL_ADDRESS=privacy@example.com
UMF_SUPPORT_EMAIL_REPLY_TOKEN_KEY=<32 bytes aleatorios en base64>
UMF_SUPPORT_EMAIL_WEBHOOK_SECRET=<otros 32 bytes aleatorios en base64>
```

Los dos secretos deben ser exclusivos de UMF Support. No se reutilizan las
claves del soporte de centros, MFA, contenido privado, cola, DKIM ni gestores.

Las lecturas y escrituras de mensajes fallan cerradas en un perfil de
producción si el cifrado de contenido privado no está habilitado. El código no
genera ni rota la clave: el entorno debe activar y validar el material ya
gestionado conforme a la documentación de cifrado.

El Worker de `cloudflare/support-email/` es deliberadamente genérico y puede
desplegarse como una instancia corporativa separada con:

```text
SUPPORT_INBOUND_ENDPOINT=https://app.example.com/api/internal/umf-support-email
SUPPORT_INBOUND_WEBHOOK_SECRET=<mismo secreto corporativo del webhook>
```

La instancia y la regla de Email Routing de UMF Support deben estar separadas
de las usadas por Forge Support. No se habilita un `catch-all`. Configurar estos
nombres no autoriza a crear o rotar secretos desde el repositorio.

## API

```text
POST   /api/umf-support/access-requests
POST   /api/umf-support/activate
GET    /api/umf-support/capabilities
GET    /api/umf-support/access-requests
POST   /api/umf-support/access-requests/:requestId/approve
POST   /api/umf-support/access-requests/:requestId/reject
GET    /api/umf-support/staff
PATCH  /api/umf-support/staff/:userId
GET    /api/umf-support/tickets
POST   /api/umf-support/tickets
GET    /api/umf-support/tickets/:ticketId
PATCH  /api/umf-support/tickets/:ticketId
POST   /api/umf-support/tickets/:ticketId/messages
GET    /api/umf-support/mailbox/:direction
POST   /api/internal/umf-support-email
```

Las mutaciones rechazan campos desconocidos y tienen límites específicos. Las
aprobaciones, rechazos y cambios de personal exigen una sesión autenticada con
verificación humana reciente. El webhook interno no utiliza sesión del
navegador: valida la firma sobre los bytes exactos y su antigüedad.

## Validación y límites operativos

Las pruebas del repositorio demuestran la separación frente a administradores
de centros, el consumo único del código, el hash persistido, la independencia
de tablas, la firma del correo entrante, su deduplicación y la clasificación de
privacidad. No demuestran que DNS, Worker, SMTP, rebotes o entregabilidad estén
activos en producción.

Antes de operar públicamente siguen siendo necesarias:

1. la configuración de un buzón y una instancia corporativa del Worker;
2. la prueba externa de entrada, respuesta, duplicado, rechazo, rebote y
   entregabilidad;
3. una política aprobada de conservación, bloqueo, exportación y supresión de
   tickets y correo;
4. el procedimiento humano para verificar identidad, alcance y plazos de una
   solicitud de derechos;
5. completar los datos identificativos y la revisión descritos en
   [Política de privacidad](./PRIVACY-POLICY.md) y
   [Preparación legal](./LEGAL-READINESS.md).

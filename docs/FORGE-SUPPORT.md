# Forge Support

> [!IMPORTANT]
> Este documento describe el soporte que cada centro presta dentro de su
> propio tenant. El soporte corporativo de la plataforma es una aplicación,
> una autoridad y un conjunto de tablas lógicamente separados dentro del
> proveedor de datos compartido; se documenta en
> [UMF Support](./UMF-SUPPORT.md).

> [!NOTE]
> El tablero interno y sus rutas de ticket están congelados temporalmente. Los
> datos existentes se conservan, pero `INTERNAL_SUPPORT_TICKETS_ENABLED=false`
> rechaza nuevas lecturas y mutaciones de tickets con un código estable. La
> pantalla `/support` muestra los canales externos vigentes: el portal
> `support.umbraviaforge.com` para tickets, incidencias y soporte;
> `umbraviaforge@gmail.com` para consultas generales; y un correo directo para
> ejercer derechos de protección de datos. Esta medida es reversible y no
> borra el módulo descrito en este documento.

## Propósito

Forge Support es el módulo de atención y conocimiento de Umbravia Forge. Su
objetivo es cubrir el núcleo replicable de un sistema como Zendesk sin mezclar
las conversaciones de soporte con la comunidad ni con la identidad de cuenta.

```text
Usuario -> ticket -> conversación pública -> agente
                  -> notas internas       -> equipo
                  -> adjuntos privados    -> almacenamiento
                  -> eventos auditables   -> Forge Audit
                  -> correo transaccional -> Forge Notify
                  -> búsqueda             -> Forge Search
```

## Capacidades implementadas

- tickets privados con identificador público `UFS-*`;
- categorías y prioridades configuradas por dominio;
- estados abierto, en curso, esperando al usuario, resuelto y cerrado;
- objetivos de primera respuesta y resolución según prioridad;
- cola de trabajo para agentes y vista limitada a los tickets propios para
  usuarios normales;
- respuestas visibles para el solicitante y notas internas solo para personal;
- asignación a agentes activos;
- roles de agente y responsable, independientes del rol comercial de la cuenta;
- adjuntos privados PNG, JPEG, WebP, PDF o texto, con límite de tamaño y hash;
- historial de cambios y eventos de SLA;
- base de conocimiento con borradores, artículos publicados y archivado;
- búsqueda combinada de tickets y conocimiento;
- correo opcional al equipo en altas y respuestas del solicitante;
- correo al solicitante cuando el equipo publica una respuesta;
- receptor de correo preparado para crear tickets de cuentas verificadas y
  añadir respuestas autenticadas mediante Cloudflare Email Routing;
- señales al gestor coordinador cuando hay fallos de notificación o SLA.

## Autorización

- El solicitante solo puede ver sus tickets, mensajes públicos y adjuntos
  públicos.
- Un solicitante no puede crear notas internas ni asociar archivos a una nota
  interna mediante un identificador adivinado.
- Un agente activo puede ver y atender la cola, redactar conocimiento y conocer
  los agentes disponibles para asignación.
- Solo un administrador puede incorporar, desactivar o cambiar el rol de un
  agente.
- La interfaz consulta capacidades explícitas, pero la API vuelve a comprobar
  cada permiso. Ocultar controles nunca funciona como autorización.

## Adjuntos

Los adjuntos se guardan fuera del árbol público con un nombre de almacenamiento
aleatorio y permisos restrictivos. La descarga pasa siempre por autenticación y
autorización. No se confía en la extensión facilitada por el navegador; el MIME
debe pertenecer a la lista permitida y el tamaño se valida antes de persistir.

La implementación actual no ofrece previsualización activa ni ejecuta contenido
subido. Antes de aceptar más formatos se necesita análisis antimalware,
cuarentena y políticas de conservación.

## SLA y automatización

La prioridad determina objetivos internos de primera respuesta y resolución.
El gestor de recursos audita periódicamente los tickets abiertos y publica una
señal cuando alguno supera su objetivo. Estos objetivos son operativos, no una
garantía contractual; cualquier SLA comercial debe definirse por separado.

## Integraciones

- **Forge Identity:** identidad del solicitante y capacidades del personal.
- **Forge Audit:** eventos de creación, cambio, respuesta, asignación y SLA.
- **Forge Notify:** correo mediante la cola cifrada compartida.
- **Forge Search:** búsqueda de tickets accesibles y artículos permitidos.
- **Gestor de seguridad:** límites de mutación, validación estricta y señales.
- **Gestor de recursos:** auditoría periódica y limpieza coordinada.

Todas las operaciones y señales de gestores originadas por este módulo, y sus
entregas de correo, usan `platformScope=commercial`. La infraestructura de
gestores y la cola son compartidas, pero ese ámbito impide que su estado se
presente como actividad de UMF Support. La identidad `corporate_support` no
sustituye una membresía activa del centro.

## Aislamiento y datos

Los tickets, la cola de trabajo, los permisos de agente y la base de
conocimiento están aislados por `facilityId`. La API obtiene el centro desde la
membresía activa seleccionada y vuelve a aplicar esa frontera en cada lectura,
escritura y búsqueda. Los mensajes, eventos y adjuntos heredan la frontera del
ticket y no pueden consultarse desde otro centro.

Los datos antiguos sin ámbito se clasifican en el perfil cerrado
`legacy-import-quarantine`; ese perfil no concede acceso ni recibe solicitudes
nuevas. El correo entrante solo puede crear un ticket cuando el solicitante
registrado resuelve una membresía activa de centro. Una respuesta posterior
conserva la frontera del ticket mediante su dirección firmada. Los alias o
subdominios de centro futuros deberán resolver el destino de forma explícita,
sin deducirlo únicamente a partir del remitente.

El historial de soporte puede contener datos personales. Los periodos de
retención, exportación, supresión, bloqueos legales y acceso del personal deben
aprobarse antes de producción comercial. Los adjuntos no deben copiarse a logs
ni a bases de datos de demostración.

## API interna actual

```text
GET    /api/support/capabilities
GET    /api/support/tickets
POST   /api/support/tickets
GET    /api/support/tickets/:ticketId
PATCH  /api/support/tickets/:ticketId
POST   /api/support/tickets/:ticketId/messages
POST   /api/support/tickets/:ticketId/attachments
GET    /api/support/tickets/:ticketId/attachments/:attachmentId
DELETE /api/support/tickets/:ticketId/attachments/:attachmentId
GET    /api/support/knowledge
POST   /api/support/knowledge
PUT    /api/support/knowledge/:articleId
GET    /api/support/agents
PUT    /api/support/agents
GET    /api/support/search
```

Las mutaciones usan límites específicos y rechazan campos JSON desconocidos.

El receptor servidor-a-servidor usa una ruta interna independiente. Exige una
firma HMAC reciente sobre los bytes exactos, no usa la sesión del navegador y
permanece cerrado mientras la recepción de correo no esté habilitada. Las
direcciones de respuesta incluyen una capacidad firmada ligada al ticket y al
solicitante; conocer el identificador público `UFS-*` no basta para publicar un
mensaje.

La arquitectura y el orden de activación están documentados en
[`SUPPORT-EMAIL-INBOUND.md`](./SUPPORT-EMAIL-INBOUND.md).

## Alcance pendiente

No se han fingido funciones que todavía no existen:

- activación y prueba real de recepción y respuesta por correo en producción;
- chat en tiempo real, bot o centro de llamadas;
- redes sociales o mensajería externa;
- reglas visuales de automatización;
- encuestas de satisfacción;
- macros, vistas guardadas y enrutamiento avanzado;
- firma de acuerdos de soporte;
- análisis antimalware de adjuntos;
- verificación del aislamiento multi-tenant sobre el esquema real de
  producción.

Estas piezas pueden añadirse por fases sobre los límites actuales sin convertir
Forge Support en un duplicado de la comunidad ni acoplarlo al proveedor SMTP.

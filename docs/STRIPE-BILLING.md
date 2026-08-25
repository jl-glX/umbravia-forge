# Suscripciones y facturación con Stripe

Este documento describe la integración vigente para cobrar la suscripción de
cada centro a Umbravia Forge. No describe los cobros que un centro realiza a
sus socios: ese libro operativo continúa separado y Stripe Connect queda fuera
de este bloque.

## Estado implementado

- Checkout alojado por Stripe para planes recurrentes mensual y anual.
- creación de un Customer por centro con una clave de idempotencia estable;
- portal de cliente de Stripe para gestionar método de pago, cancelación e
  historial de facturas según la configuración del Dashboard;
- webhook firmado sobre el cuerpo JSON exacto, montado antes del parser general;
- deduplicación transaccional por identificador de evento;
- seguimiento del Checkout vigente por centro, de forma que un evento tardío
  de una sesión anterior no pueda alterar un intento posterior;
- modos Test y Live explícitos, con rechazo de claves, Customers y eventos del
  modo contrario;
- rechazo de eventos antiguos, Prices no autorizados, suscripciones ajenas y
  asociaciones de Customer que no coincidan con el centro local;
- cambios de plan resueltos por el Price firmado de la suscripción, no por
  metadatos antiguos que puedan quedar tras usar el portal;
- estado comercial y permisos derivados en un servicio independiente de Forge
  Analytics y del CRM;
- interfaz administrativa en `/admin/subscription`;
- alertas comerciales mínimas para fallo de pago, autenticación requerida y
  fallo de finalización de factura, sin copiar el contenido financiero;
- reconciliación administrativa bajo demanda contra la suscripción vigente de
  Stripe;
- barreras de servidor para Analytics y CRM cuando la aplicación de permisos
  comerciales está activa.

Stripe es la autoridad del cobro. Volver desde Checkout con una URL de éxito no
activa capacidades: la aplicación espera un evento firmado de suscripción. No
se almacenan números de tarjeta ni cuerpos completos de webhook.

## Frontera Stripe / Umbravia Forge

Stripe gestiona el movimiento del dinero: métodos de pago, tarjetas,
autenticaciones, facturas alojadas, renovaciones, reintentos, cancelaciones y
operaciones de reembolso o disputa autorizadas. Umbravia Forge no replica ese
libro financiero.

Umbravia Forge conserva únicamente el vínculo necesario para decidir qué tiene
contratado el centro: `facility_id`, modo, Customer, Subscription, Price,
modalidad, estado, final del periodo, cancelación programada, identificador del
Checkout vigente, eventos mínimos para idempotencia y una alerta operativa sin
importe ni datos de pago. Una reconciliación lee la suscripción actual desde
Stripe y actualiza ese estado local; no crea cargos, facturas ni reembolsos.

## Configuración del servidor

La integración permanece cerrada mientras `STRIPE_BILLING_ENABLED` no sea
`true`. `STRIPE_BILLING_MODE` selecciona `test` o `live`; si no se declara,
conserva `test` como valor seguro y compatible. Cada modo exige su propia clave
restringida, Prices, secreto de webhook y Customer. Una clave secreta general,
una clave del modo contrario, dos modalidades enlazadas al mismo Price o Live
fuera del perfil `APP_ENV=production` provocan un fallo de configuración. El
arranque de staging/producción comprueba esta configuración cuando Billing está
activo. Live exige además un `CLIENT_ORIGIN` HTTPS.

Variables necesarias, sin incluir aquí ningún valor:

| Variable                         | Finalidad                                                |
| -------------------------------- | -------------------------------------------------------- |
| `STRIPE_BILLING_ENABLED`         | activación explícita (`true`)                            |
| `STRIPE_BILLING_MODE`            | entorno `test` o `live`; por defecto, `test`             |
| `STRIPE_RESTRICTED_API_KEY`      | clave `rk_test_…` o `rk_live_…` coherente con el modo    |
| `STRIPE_WEBHOOK_SECRET`          | secreto de firma `whsec_…`                               |
| `STRIPE_PRICE_FORGE_MONTHLY`     | Price recurrente mensual creado en Stripe                |
| `STRIPE_PRICE_FORGE_ANNUAL`      | Price recurrente anual creado en Stripe                  |
| `STRIPE_PORTAL_CONFIGURATION_ID` | configuración `bpc_…` del portal; es opcional            |
| `CLIENT_ORIGIN`                  | origen confiable usado para retornos; nunca llega del UI |

Las credenciales no pertenecen al repositorio. `.env.example`, las plantillas
de staging/producción y `deploy/umbravia-forge.env.template` documentan los
nombres con Billing desactivado y valores vacíos; los valores reales se deben
introducir mediante el mecanismo de secretos autorizado del entorno.

## Preparación de cada modo en Stripe

1. Crear el producto de Umbravia Forge y dos Prices recurrentes, mensual y
   anual, con moneda, importe y tratamiento fiscal revisados.
2. Crear una clave restringida con el mínimo acceso de escritura necesario para
   Customers, Checkout Sessions y Billing Portal Sessions, y lectura de
   Subscriptions para reconciliar el estado actual ante webhooks desordenados.
   No ampliar permisos sin una necesidad comprobada.
3. Configurar en el Dashboard los métodos de pago admitidos. El código no fija
   `payment_method_types`.
4. Configurar el portal de cliente para mostrar facturas y permitir las
   operaciones comerciales aprobadas.
5. Crear un endpoint de webhook hacia
   `POST /api/internal/stripe-billing` y suscribirlo a:
   - `checkout.session.completed`;
   - `checkout.session.expired`;
   - `checkout.session.async_payment_succeeded`;
   - `checkout.session.async_payment_failed`;
   - `customer.subscription.created`;
   - `customer.subscription.updated`;
   - `customer.subscription.deleted`;
   - `invoice.paid`;
   - `invoice.payment_succeeded`;
   - `invoice.payment_failed`;
   - `invoice.payment_action_required`;
   - `invoice.finalization_failed`;
   - `invoice.overdue`;
   - `invoice.marked_uncollectible`.
6. Introducir las variables del modo correspondiente en el servidor
   autorizado, reiniciar de forma controlada y ejecutar el recorrido completo.

Test debe validarse primero con tarjetas de prueba. Para Live hay que repetir la
creación de Product, Prices, portal, clave restringida y webhook en modo Live:
los objetos de Test no existen en Live aunque compartan la misma cuenta. La
transición local invalida el vínculo del modo anterior y crea un Customer nuevo
antes del primer Checkout real; un estado Test nunca concede acceso cuando el
servidor opera en Live.

No se activa `automatic_tax`: antes hacen falta registros fiscales reales y
una decisión jurídica/fiscal. Los importes tampoco se reciben del navegador;
cada modalidad se resuelve a un Price configurado en el servidor.

## Persistencia y aislamiento

La migración 32 añade:

- `facilityCommercialSubscriptions`, una fila por centro, con los
  identificadores de Customer, Subscription y Price y el estado comercial;
- `stripeWebhookEvents`, registro mínimo de eventos procesados para garantizar
  idempotencia sin conservar el payload.

La migración 33 añade el identificador de la Checkout Session vigente. La
migración 34 añade el modo del Customer y de la suscripción a la frontera local.
La migración 35 añade exclusivamente la alerta comercial mínima, la fecha del
último evento de factura y la fecha del último contraste directo con Stripe.
Los eventos de Checkout solo mantienen el intento pendiente o lo cierran como
fallido; nunca conceden capacidades de pago. La activación continúa dependiendo
de un evento firmado de suscripción, incluso si el navegador vuelve por la URL
de éxito.

Los eventos solo pueden actualizar una suscripción cuando el modo,
`facility_id`, el Customer firmado, la suscripción vigente y, para eventos de
Checkout, la sesión vigente coinciden con el vínculo local. Un Price ajeno al
catálogo configurado falla cerrado y no concede capacidades. El borrado de un
centro elimina su estado comercial y anonimiza la referencia retenida del
evento.

Los eventos de factura no convierten la base local en un libro contable. Se usa
su referencia de suscripción para consultar el estado actual en Stripe y se
guarda únicamente si el modo, centro, Customer, Subscription y Price coinciden
con el vínculo local. Un pago correcto limpia la alerta; un fallo, una
autenticación pendiente o una factura no finalizada se muestran al centro para
que actúe dentro del portal de Stripe.

Las actualizaciones de suscripción y los eventos de factura conservan relojes
de ordenación separados. Así, un webhook de factura retrasado no queda
descartado solo porque Stripe haya emitido después una actualización de la
suscripción; dentro de cada secuencia, un evento más antiguo no puede restaurar
un aviso o estado ya superado.

## Estados y degradación

`trialing` y `active` conceden las capacidades comerciales de pago. Una prueba
comercial vigente también puede concederlas. `past_due`, `unpaid`, `paused`,
`canceled`, `incomplete` e `incomplete_expired` no se convierten en acceso de
pago.

Un centro con una Subscription recuperable —por ejemplo `past_due`, `unpaid`,
`paused` o `incomplete`— debe resolverla en el portal y no puede abrir otro
Checkout paralelo. Una sesión Checkout pendiente también bloquea otro intento
hasta que el evento de expiración la cierre. Solo los estados terminales
`canceled` e `incomplete_expired` permiten iniciar una nueva contratación.

Si Stripe Billing no está activado, el proyecto conserva el comportamiento
previo y declara la aplicación de permisos deshabilitada. Esto permite preparar
la integración sin bloquear instalaciones existentes. Cuando está activado,
el servicio de permisos separa `operationalCore` de las capacidades de
analítica y CRM. Las rutas de Analytics y CRM consultan esa política en el
servidor: una suscripción o prueba comercial válida concede la capacidad y la
ausencia de derecho responde con `COMMERCIAL_CAPABILITY_REQUIRED`. Cuando
Stripe Billing está desactivado, la aplicación conserva de forma explícita el
comportamiento compatible sin aplicar la barrera.

La página de suscripción permite contrastar bajo demanda la Subscription local
con Stripe. Esta operación exige una sesión administrativa del centro y una
verificación reciente de formulario; solo lee Stripe y actualiza el estado
comercial local. No sustituye la observación de entregas fallidas del webhook.

## Activación y validación de Live

El código admite Live, pero eso no significa que un entorno esté cobrando. Antes
de activar cobros reales se debe:

- confirmar importes mensual y anual, moneda, tratamiento fiscal, razón social
  y textos de facturación;
- crear y activar Product y Prices Live, configurar el portal y crear el
  endpoint Live con los eventos enumerados;
- generar una clave restringida Live con permisos mínimos y cargarla, junto al
  secreto de webhook, mediante el gestor de secretos del servidor;
- ejecutar pagos, renovaciones, fallos, cancelaciones y descarga de factura de
  extremo a extremo en un entorno autorizado;
- observar reintentos y orden alterado de webhooks;
- comprobar alertas de pago fallido, autenticación requerida y finalización de
  factura, junto con los correos y reintentos configurados en Stripe;
- comprobar que una notificación antigua se reconcilia con la suscripción
  actual consultada a Stripe y no restaura permisos obsoletos;
- verificar el comportamiento durante una indisponibilidad de Stripe;
- completar la revisión legal y fiscal indicada en `LEGAL-READINESS.md`.

No se debe crear un Price ni activar el Product sin una decisión comercial
explícita sobre importe y moneda. Tampoco se activa `automatic_tax` hasta que
exista un registro fiscal real confirmado.

Antes del primer cobro debe existir además un procedimiento operativo para
cancelaciones, reembolsos, disputas y correcciones de factura. Puede ejecutarse
inicialmente por una persona autorizada desde Stripe; no requiere construir un
procesador propio ni almacenar datos financieros en Umbravia Forge. La decisión
fiscal, el código tributario del producto y el comportamiento fiscal del Price
deben confirmarse fuera del código antes de habilitar impuestos automáticos.

El alta de cuentas conectadas y los cobros directos a socios pertenecen a una
frontera separada descrita en [Stripe Connect](./STRIPE-CONNECT.md). No cambian
el Customer, la Subscription ni los Prices con los que Umbravia Forge factura
su SaaS al centro, y no convierten a la plataforma en comerciante de las cuotas.

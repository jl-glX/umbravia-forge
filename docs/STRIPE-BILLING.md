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
- rechazo de eventos Live, eventos antiguos y asociaciones de Customer que no
  coincidan con el centro local;
- estado comercial y permisos derivados en un servicio independiente de Forge
  Analytics y del CRM;
- interfaz administrativa en `/admin/subscription`.

Stripe es la autoridad del cobro. Volver desde Checkout con una URL de éxito no
activa capacidades: la aplicación espera un evento firmado de suscripción. No
se almacenan números de tarjeta ni cuerpos completos de webhook.

## Configuración del servidor

La integración permanece cerrada mientras `STRIPE_BILLING_ENABLED` no sea
`true`. La primera versión acepta exclusivamente una clave restringida de
Stripe Test; una clave secreta general o una clave Live provoca un fallo de
configuración.

Variables necesarias, sin incluir aquí ningún valor:

| Variable                         | Finalidad                                                |
| -------------------------------- | -------------------------------------------------------- |
| `STRIPE_BILLING_ENABLED`         | activación explícita (`true`)                            |
| `STRIPE_RESTRICTED_API_KEY`      | clave restringida `rk_test_…`                            |
| `STRIPE_WEBHOOK_SECRET`          | secreto de firma `whsec_…`                               |
| `STRIPE_PRICE_FORGE_MONTHLY`     | Price recurrente mensual creado en Stripe                |
| `STRIPE_PRICE_FORGE_ANNUAL`      | Price recurrente anual creado en Stripe                  |
| `STRIPE_PORTAL_CONFIGURATION_ID` | configuración `bpc_…` del portal; es opcional            |
| `CLIENT_ORIGIN`                  | origen confiable usado para retornos; nunca llega del UI |

Las credenciales y sus plantillas operativas no pertenecen al repositorio. Se
deben introducir mediante el mecanismo de secretos autorizado del entorno.

## Preparación en Stripe Test

1. Crear el producto de Umbravia Forge y dos Prices recurrentes, mensual y
   anual, con moneda, importe y tratamiento fiscal revisados.
2. Crear una clave restringida con el mínimo acceso de escritura necesario para
   Customers, Checkout Sessions y Billing Portal Sessions. No ampliar permisos
   sin una necesidad comprobada.
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
   - `customer.subscription.deleted`.
6. Introducir las variables en el servidor autorizado, reiniciar de forma
   controlada y ejecutar el recorrido completo con una tarjeta de prueba.

No se activa `automatic_tax`: antes hacen falta registros fiscales reales y
una decisión jurídica/fiscal. Los importes tampoco se reciben del navegador;
cada modalidad se resuelve a un Price configurado en el servidor.

## Persistencia y aislamiento

La migración 32 añade:

- `facilityCommercialSubscriptions`, una fila por centro, con los
  identificadores de Customer, Subscription y Price y el estado comercial;
- `stripeWebhookEvents`, registro mínimo de eventos procesados para garantizar
  idempotencia sin conservar el payload.

La migración 33 añade el identificador de la Checkout Session vigente. Los
eventos de Checkout solo mantienen el intento pendiente o lo cierran como
fallido; nunca conceden capacidades de pago. La activación continúa dependiendo
de un evento firmado de suscripción, incluso si el navegador vuelve por la URL
de éxito.

Los eventos solo pueden actualizar una suscripción cuando `facility_id`, el
Customer firmado y, para eventos de Checkout, la sesión vigente coinciden con
el vínculo local. El borrado de un centro elimina su estado comercial y
anonimiza la referencia retenida del evento.

## Estados y degradación

`trialing` y `active` conceden las capacidades comerciales de pago. Una prueba
comercial vigente también puede concederlas. `past_due`, `unpaid`, `paused`,
`canceled`, `incomplete` e `incomplete_expired` no se convierten en acceso de
pago.

Si Stripe Billing no está activado, el proyecto conserva el comportamiento
previo y declara la aplicación de permisos deshabilitada. Esto permite preparar
la integración sin bloquear instalaciones existentes. Cuando está activado,
el servicio de permisos separa `operationalCore` de las capacidades de
analítica y CRM; la conexión de cada ruta a esta política debe revisarse como
una decisión de producto antes de un lanzamiento.

## Validación antes de producción

Esta implementación no habilita cobros reales. Para pasar a Live aún se debe:

- autorizar explícitamente el cambio de modo y el manejo de credenciales Live;
- confirmar precios, moneda, impuestos, razón social y textos de facturación;
- ejecutar pagos, renovaciones, fallos, cancelaciones y descarga de factura de
  extremo a extremo en un entorno autorizado;
- observar reintentos y orden alterado de webhooks;
- verificar el comportamiento durante una indisponibilidad de Stripe;
- completar la revisión legal y fiscal indicada en `LEGAL-READINESS.md`.

Stripe Connect, reparto de pagos, onboarding de cuentas conectadas, cobros a
socios, reembolsos operativos y conciliación del libro interno son una fase
posterior y no deben confundirse con esta suscripción SaaS.

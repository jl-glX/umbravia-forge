# Cobros de centros con Stripe Connect

Este documento describe la frontera vigente para que un centro cobre a sus
socios. Es independiente de [Stripe Billing](./STRIPE-BILLING.md), que factura
la suscripción SaaS del centro a Umbravia Forge.

## Modelo comercial

- El centro es el comerciante frente al socio y recibe el cargo directamente.
- El centro aparece en Checkout, recibos y extractos y gestiona reembolsos y
  disputas desde su panel Stripe.
- Stripe cobra al centro la comisión de procesamiento y cubre sus saldos
  negativos según la configuración de la cuenta conectada.
- Umbravia Forge no envía `application_fee_amount`, no recibe una comisión por
  operación y no añade al socio un recargo separado por pagar con tarjeta.
- El centro puede fijar el precio final de la cuota, pero la plataforma no
  construye un reparto artificial de la comisión de Stripe.

## Implementación preparada

La jefatura puede preparar una cuenta Accounts v2 con configuración
`merchant`, responsabilidades de comisiones y pérdidas asignadas a Stripe y
panel completo. La información regulatoria se recoge mediante un Account Link
alojado por Stripe; Umbravia Forge no almacena documentos de verificación.

Una cuenta solo pasa a `ready` cuando las capacidades `card_payments` y
`stripe_balance.payouts` figuran activas. Hasta entonces permanece en
`onboarding_required` o `restricted` y el servidor rechaza Checkout.
También se solicita `sepa_debit_payments`, pero una denegación de SEPA no
bloquea los cobros con tarjeta cuando las dos capacidades básicas están
activas; simplemente impide que Checkout ofrezca el adeudo directo.

Los registros pendientes del libro del centro pueden abrir un Checkout directo
en esa cuenta conectada. Importe, moneda, concepto, centro y socio proceden de
la base del servidor. El navegador no puede proporcionar un precio ni una
cuenta Stripe arbitrarios. Un trabajador con afiliación de socio conserva sus
funciones laborales y puede pagar como socio; la jefatura no adquiere esa
dimensión automáticamente.

El endpoint Connect verifica la firma sobre el cuerpo exacto, exige el
identificador de la cuenta conectada, comprueba modo y tenant, deduplica el
evento y solo marca pagado el registro cuando Checkout informa
`payment_status=paid`. Volver a la URL de éxito nunca prueba un pago.
Los métodos de pago diferidos se completan o fallan mediante
`checkout.session.async_payment_succeeded` y
`checkout.session.async_payment_failed`; el retorno del navegador tampoco
decide su estado.

Para Checkout con adeudo directo SEPA, el destino de eventos debe ser de tipo
Connect y escuchar eventos de las cuentas conectadas. La lista procesada por
esta fase es:

- `checkout.session.completed`: el socio autorizó el adeudo; si
  `payment_status` sigue pendiente, no se marca el registro como pagado.
- `checkout.session.async_payment_succeeded`: el banco confirmó el adeudo y el
  registro pasa a pagado.
- `checkout.session.async_payment_failed`: el adeudo terminó fallando y puede
  volver a intentarse con otro método.
- `checkout.session.expired`: se cierra una sesión abandonada.

Stripe Checkout recoge el IBAN y el mandato. La cuenta conectada necesita la
capacidad `sepa_debit_payments`, el cobro debe estar denominado en EUR y el
método solo se mostrará cuando Stripe determine que el socio es elegible. No se
escucha `mandate.updated` porque esta fase no administra localmente mandatos
reutilizables.

## Configuración

| Variable                            | Función                                   |
| ----------------------------------- | ----------------------------------------- |
| `STRIPE_CONNECT_ENABLED`            | activación explícita; por defecto `false` |
| `STRIPE_CONNECT_MODE`               | `sandbox` o `live`                        |
| `STRIPE_CONNECT_RESTRICTED_API_KEY` | clave restringida coherente con el modo   |
| `STRIPE_CONNECT_WEBHOOK_SECRET`     | secreto del endpoint Connect              |

El webhook público del servidor es
`POST /api/internal/stripe-connect`. Debe configurarse como endpoint Connect,
no como sustituto del webhook de Stripe Billing de la plataforma.

Accounts v2 se valida primero en Stripe Sandbox. El código y las pruebas del
repositorio no demuestran que una cuenta, endpoint, secreto, capacidad, pago,
reembolso o disputa existan en un entorno externo. Producción permanece
cerrada hasta comprobar el recorrido de extremo a extremo con una persona
autorizada.

## Antes de activar producción

1. Confirmar acceso de la plataforma a Accounts v2 y preparar la clave
   restringida con el mínimo permiso necesario.
2. Aplicar y revisar la migración PostgreSQL 57.
3. Crear el endpoint Connect Live con firma independiente del webhook SaaS.
4. Completar un alta real controlada y comprobar requisitos, pagos y payouts.
5. Ejecutar un cobro, un fallo, un reintento, un reembolso y una disputa.
6. Confirmar nombre, datos de soporte y descriptor visibles del centro.
7. Verificar que ningún objeto Test o Sandbox se reutiliza en Live.

Stripe Tax sigue desactivado. Activarlo exige determinar antes la entidad
obligada, los registros fiscales y los códigos tributarios aplicables; no se
infiere a partir del país de la cuenta.

Para la suscripción que Umbravia Forge vende a los centros, el código de
producto de referencia en Stripe Tax es **Software as a Service (SaaS) -
Business Use** (`txcd_10103001`): software alojado, de uso empresarial y sin
descarga. La clasificación debe revisarse con asesoría fiscal antes de activar
el cálculo automático y, en ventas B2B intracomunitarias, requiere recoger y
validar el identificador fiscal del cliente cuando corresponda inversión del
sujeto pasivo.

## Radar

La cuenta de plataforma usa **Radar Standard** como punto de partida. Frente a
Lite, añade prevención de fraude para cuentas conectadas, métodos de pago no
limitados a tarjeta, reglas predeterminadas y analítica, sin asumir todavía la
operación manual que requieren Plus o Pro.

Esta elección no controla los cobros directos de los centros. Stripe aplica a
cada cargo directo la configuración Radar de la cuenta conectada que lo cobra;
como el centro tiene panel completo, gestiona allí su propio nivel y sus
reglas. Plus solo se justificará cuando exista una persona responsable de
mantener reglas, revisiones y umbrales; Pro queda reservado para señales reales
de abuso de pruebas, bots o multicuentas.

## Límite de esta entrega

La base operativa cubre alta, capacidad, Checkout directo, confirmación por
webhook e integración con el libro existente. Los planes recurrentes propios
de cada centro, recuperación automática de impagos y conciliación periódica de
invoices se mantienen como fase posterior explícita; no se simulan mediante un
estado local ni se presentan como capacidad activa.

# Auditoría integral de preparación del cambio — 2026-08-21

## Alcance y autoridad

Esta auditoría fechada conserva evidencia del cambio que completa la base de
suscripciones SaaS, el control comercial de Analytics y CRM y el saneamiento de
campos de acceso y administración. Se contrastaron el código, las migraciones,
las pruebas, las rutas, la configuración versionada, la documentación vigente y
la interfaz del commit de trabajo.

No se inspeccionó ni modificó un servidor de producción, una base PostgreSQL
real, DNS, correo, copias, secretos ni objetos de una cuenta Stripe. Por tanto,
el resultado podrá acreditar preparación del repositorio, pero no operación
Live ni validación humana de extremo a extremo.

## Frontera de pagos confirmada

- Stripe mantiene el movimiento del dinero, Checkout, métodos de pago,
  autenticaciones, suscripciones, facturas alojadas, portal, renovaciones,
  fallos y webhooks.
- Umbravia Forge conserva únicamente la relación centro-Customer-Subscription,
  el Price autorizado, el estado comercial mínimo, relojes de eventos e
  idempotencia necesarios para decidir capacidades.
- El libro de facturación de socios es administrativo: no cobra, no reembolsa y
  no convierte a Umbravia Forge en procesador de pagos.
- Impuestos, registros fiscales, moneda, precios Live, reembolsos y disputas
  siguen requiriendo una decisión empresarial y, cuando corresponda, operación
  en Stripe. `automatic_tax` no se activa sin esa base real.

## Hallazgos reparados antes de validar

1. Los eventos de Subscription e Invoice compartían un reloj capaz de descartar
   señales de factura válidas pero retrasadas. Se separó el reloj de facturas.
2. Un Checkout nuevo podía competir con una sesión pendiente o una suscripción
   recuperable. Ahora esos estados se recuperan mediante Stripe Portal y solo
   los terminales permiten contratar otra vez.
3. Analytics y CRM exponían rutas protegidas por tenant pero todavía no
   aplicaban el derecho comercial. Ambas capacidades se comprueban ahora en el
   servidor.
4. El modo Live podía depender solo de `NODE_ENV`. Ahora exige además el perfil
   de despliegue `production`; staging no puede cargar configuración Live.
5. Las plantillas de entorno no enumeraban la configuración Stripe y la sonda
   Linux no la contrastaba. Se añadieron nombres desactivados por defecto y
   comprobaciones que nunca imprimen valores.
6. CRM y las acciones de suscripción aceptaban contratos menos estrictos que el
   resto de la API. Se cerraron campos, parámetros y consultas desconocidos.
7. Acceso, alta, recuperación, MFA, passkeys, continuidad, usuarios internos,
   prueba comercial y facturación administrativa tenían límites o asociaciones
   de etiqueta que no coincidían siempre con el servidor. Se alinearon sin
   reducir las validaciones de seguridad.
8. La pantalla comercial afirmaba que no existían suscripciones reales aunque
   el código ya dispone de un modo Live controlado. El texto se actualiza para
   distinguir capacidad implementada de activación y validación Live.
9. El interruptor de aprovisionamiento comercial protegía la ruta de prueba,
   pero no el alta inicial de administradores. El servidor comparte ahora una
   única decisión y la interfaz desactiva esa modalidad cuando el entorno no
   autoriza crear centros.

## Comprobaciones de auditoría previas a la puerta de calidad

- No se encontraron secretos Stripe versionados; las variables añadidas son
  nombres y valores seguros desactivados en archivos de ejemplo.
- `primary` permanece solo en historia o contexto de migración; no concede un
  tenant ni permisos operativos.
- Los enlaces locales de la documentación fuente estaban resueltos y el índice
  incluía los documentos vigentes. Las copias parciales de paquetes generados
  no sustituyen a la fuente.
- El aislamiento efectivo continúa dependiendo de facility activa, membresía
  activa y autorización del servidor; los nuevos derechos comerciales no
  reemplazan esas comprobaciones.

## Resultado de validación

La validación local posterior a la auditoría obtuvo estos resultados:

- `npm run ci:validate`: favorable. Incluyó portabilidad sobre 47 archivos,
  formato, lint, tipos de cliente/servidor/Worker, 109 archivos de pruebas con
  539 pruebas superadas y 1 omitida, las tres compilaciones y la auditoría de
  dependencias sin vulnerabilidades fuera de las excepciones explícitas;
- `npm run security:probe`: 18 contrastes locales favorables sobre cabeceras,
  acceso anónimo, origen, validación, tamaño, traversal, límites y framing HTTP;
- `npm run security:password-resilience`: contraste favorable con credenciales
  sintéticas, Argon2id y diferenciación de entradas;
- `bash -n deploy/check-linux-readiness.sh`: sintaxis válida mediante el Bash
  distribuido con Git para Windows;
- `git diff --check`: favorable.

`npm run deploy:package` se detuvo antes de empaquetar porque el entorno local
no contiene una `VITE_TURNSTILE_SITE_KEY` real. Ese valor no se ha inventado ni
incorporado al repositorio: el paquete final debe generarse en el entorno
autorizado que inyecte la clave pública real del sitio. La compilación que forma parte de la
puerta completa sí fue favorable.

GitHub Actions validó favorablemente el commit publicado en la solicitud
[#15](https://github.com/jl-glX/umbravia-forge/pull/15): el trabajo
[`validate`](https://github.com/jl-glX/umbravia-forge/actions/runs/32471602847/job/96739371231)
completó en Ubuntu la instalación bloqueada, la sintaxis de los scripts, la
puerta `ci:validate` y el paquete Linux con una clave pública Turnstile
exclusiva de CI.

## Puertas humanas y Live posteriores

Incluso con el repositorio y CI favorables siguen siendo obligatorios, en el
entorno autorizado:

- migración PostgreSQL real, aislamiento cruzado y copia/restauración;
- Product y Prices Live aprobados, clave restringida, endpoint firmado y portal;
- ciclo Checkout → activación → renovación → fallo → autenticación →
  recuperación/cancelación, incluidos duplicados y eventos desordenados;
- precios, moneda, IVA/VAT ID, facturas, registros, contabilidad y revisión
  fiscal/legal;
- DNS, SMTP, rebotes y entregabilidad; observabilidad y respuesta a incidentes;
- comprobación física de passkeys y validación humana de los flujos de socio,
  entrenador, administrador y soporte.

Hasta completar esas puertas, el estado correcto es **candidato técnicamente
validado en el repositorio**, no **producción comercial demostrada**.

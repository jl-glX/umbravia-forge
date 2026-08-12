# Forge Analytics

Forge Analytics es la capa de lectura de datos operativos de Umbravia Forge.
Su primera vertical convierte clases, reservas, listas de espera y asistencias
en métricas comparables para administradores y entrenadores sin crear una
segunda fuente de verdad.

## Qué resuelve la base actual

- Usa la fecha real de la sesión para seleccionar el periodo; la fecha de alta
  de una reserva no cambia el mes al que pertenece la actividad.
- Calcula la ocupación ponderando las reservas confirmadas sobre todas las
  plazas ofertadas, en lugar de promediar porcentajes incompatibles.
- Distingue una reserva de una asistencia registrada.
- Muestra la cobertura de asistencia para que un resultado incompleto no se
  presente como una certeza.
- Agrupa sesiones por nombre de actividad y permite comparar ocupación,
  asistencia, cancelación y demanda todavía presente en lista de espera.
- Genera señales operativas mediante reglas transparentes. Las señales no
  aplican cambios ni se presentan como causalidad demostrada.

La lista de espera operativa sigue representando demanda actualmente pendiente.
La infraestructura histórica añade eventos de reserva, promoción, expiración,
cancelación, intención y asistencia dentro de la misma transacción que cambia
la reserva. Esto permite comparar periodos sin deducir el pasado de una fila
que ya cambió o fue eliminada.

## Historial, migración y privacidad

La migración 25 de PostgreSQL y la inicialización equivalente de SQLite crean
`bookingAnalyticsEvents` de forma aditiva. La primera ejecución importa una
única instantánea por reserva existente con `eventType=baseline_import` y
`source=baseline`. Esa instantánea expresa únicamente el estado observable en
el momento de migrar; no inventa promociones, cancelaciones ni asistencias
anteriores.

Los cambios posteriores se guardan con `source=live`. Cada evento conserva el
centro, la actividad, el horario y el aforo vigentes al producirse el cambio.
No incluye correo, teléfono, IP, texto libre, credenciales ni respuestas de
encuestas. La clave de deduplicación evita registrar dos veces una misma
transición reintentada.

El centro es obligatorio y se elimina en cascada al eliminar el tenant. Los
identificadores de socio, entrenador, reserva y clase son anulables: al borrar
la cuenta o el objeto operativo pasan a `NULL`, mientras la instantánea
agregable permanece. Esta es la excepción de privacidad deliberada al modelo
de solo añadir.

## Separación por consumidor

```text
Clases, reservas y asistencia
  -> servicio canónico de lectura
       -> administración: todo el centro seleccionado
       -> entrenador: únicamente sus sesiones y sus participantes
       -> futuro CRM: segmentos comerciales autorizados
       -> futuro soporte: salud y trazabilidad técnica saneada
       -> futuro Crashnalytics: fallos saneados por versión y entorno
```

El servidor filtra el centro y el entrenador antes de devolver datos. La vista
de participación no incluye correo, teléfono ni credenciales. Un operador de
soporte no obtiene acceso implícito a métricas comerciales y un consumidor CRM
no obtiene registros técnicos o secretos.

La dirección prevista para el producto técnico de fallos es
`crashnalytics.umbraviaforge.com`. Este documento no declara ese servicio como
implementado ni desplegado.

## Periodos y calidad

El cliente envía límites de calendario local para día, semana o mes y el
desfase UTC necesario para agrupar horas. La API rechaza intervalos inválidos y
periodos de más de 93 días en una única consulta. Ese límite protege la base
transaccional mientras no exista un almacén analítico agregado.

Las métricas responden **qué** ha ocurrido. Afirmar **por qué** una actividad
tiene más o menos demanda requiere contrastar el comportamiento con encuestas
mensuales versionadas. Hasta entonces, las recomendaciones deben hablar de
revisar o contrastar, no de una causa confirmada.

## Frontera comercial

La base técnica no concede ni revoca productos. La futura integración de
Stripe será autoridad de cobro y un servicio separado de permisos comerciales
traducirá el estado de la suscripción a capacidades del centro.

Una división inicial razonable es:

- base incluida: resumen reciente y métricas agregadas esenciales;
- Forge Analytics de pago: histórico amplio, comparaciones, participación por
  socio con permisos, recomendaciones, encuestas, segmentos y exportaciones;
- acceso de entrenadores incluido en la suscripción del centro y limitado a
  sus propias clases.

No se debe simular una suscripción activa ni introducir una barrera de pago
antes de disponer de precios, impuestos, facturación, renovaciones, reembolsos,
webhooks idempotentes y una política de degradación cuando Stripe no esté
disponible.

## Evolución prevista

1. Validar esta vertical con datos sintéticos y centros piloto.
2. Validar y observar la nueva historia transaccional en producción antes de
   ampliar los periodos disponibles.
3. Incorporar encuestas mensuales con modos anónimo, confidencial e
   identificado, umbral mínimo de agregación y preguntas versionadas.
4. Crear permisos comerciales independientes de la analítica.
5. Separar cargas pesadas en un almacén de lectura antes de habilitar históricos
   largos, cohortes, CRM, soporte técnico y Crashnalytics.

Cada nueva pantalla debe consumir contratos del servicio de lectura. No debe
consultar tablas directamente ni redefinir términos como socio activo,
ocupación, asistencia o ausencia.

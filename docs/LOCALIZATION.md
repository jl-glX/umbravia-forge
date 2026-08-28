# Localización e internacionalización

Estado revisado contra el código y las pruebas del cambio activo el 27 de
agosto de 2026. Este documento describe el repositorio. No demuestra que un
despliegue, una base real, el correo, Turnstile o Stripe hayan sido validados en
producción.

## Contrato de locales

| Locale persistido/HTML | Catálogo           | Fallback de texto    | Locale para `Intl` |
| ---------------------- | ------------------ | -------------------- | ------------------ |
| `es`                   | completo           | `es`                 | `es-ES`            |
| `en`                   | completo           | `en`                 | `en-GB`            |
| `de`                   | completo           | `de`                 | `de-DE`            |
| `de-CH`                | regional           | `de-CH` → `de`       | `de-CH`            |
| `fr`                   | completo requerido | `fr`                 | `fr-FR`            |
| `it`                   | completo requerido | `it`                 | `it-IT`            |
| `gl`                   | completo requerido | `gl`                 | `gl-ES`            |
| `ca`                   | completo requerido | `ca`                 | `ca-ES`            |
| `ca-valencia`          | regional           | `ca-valencia` → `ca` | `ca-ES-valencia`   |
| `eu`                   | completo requerido | `eu`                 | `eu-ES`            |
| `oc-aranes`            | completo requerido | `oc-aranes`          | `oc-ES`            |

La tabla define el contrato técnico objetivo; no afirma que un catálogo nuevo
esté disponible o aceptado. Su estado verificable figura en la sección
siguiente. Los códigos de persistencia son identificadores BCP 47/CLDR estables
de la plataforma. La resolución `Intl` es deliberadamente distinta cuando el
motor necesita una región compatible. `oc-aranes` conserva la identidad
aranesa en persistencia y HTML, pero usa `oc-ES` para formato porque no todos
los motores aceptan una variante aranesa específica.

Los canonicalizadores de cliente y servidor normalizan caso y `_` a `-`,
validan la sintaxis mediante `Intl.getCanonicalLocales` y reconocen solo los
subtags completos `valencia` y `aranes`. Por ejemplo, `ca_ES_valencia` se
persiste como `ca-valencia` y `oc-ES-aranes` como `oc-aranes`; entradas como
`ca-notvalencian`, variantes repetidas o extensiones no admitidas se rechazan en
la API. Un consumidor interno que necesita un valor seguro usa `es` únicamente
para ausente, desconocido o datos legados inválidos.

Las opciones visibles proceden de `client/src/i18n/language-options.ts`. Los
tres consumidores —selector, alta y prueba comercial— contienen exactamente
los once códigos, ordenan con `Intl.Collator` del locale activo y desempatan por
código canónico. El modo compacto ordena por su abreviatura visible, no por el
nombre largo oculto.

## Estado y procedencia lingüística

Un catálogo completo candidato debe contener exactamente las mismas claves que
el catálogo canónico `en`; a 2026-08-27 son 2.439. Cobertura
estructural significa que existen las claves y se conservan tokens; no
significa que la traducción sea natural, correcta jurídicamente ni revisada por
una persona nativa. Los nueve catálogos completos están materializados y
comparten las 2.439 claves; `de-CH` y `ca-valencia` continúan como recursos de
overrides. Francés, italiano, gallego, catalán, euskera, valenciano y aranés han
pasado revisiones independientes por bloques o por catálogo. Las coincidencias
exactas y los residuales quedan aprobados exclusivamente por locale, clave,
tipo, evidencia y SHA-256; la prueba exige correspondencia uno a uno entre los
1.434 hallazgos actuales y sus excepciones, sin entradas obsoletas ni
duplicadas. No hay una generación automática completa en curso.

| Locale        | Origen del texto                                       | Estado a 2026-08-27                                                                  | Revisión lingüística                                        |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `es`          | catálogo mantenido del producto                        | completo                                                                             | existente; sin auditoría lingüística externa en este cambio |
| `en`          | catálogo mantenido del producto y fuente de generación | completo                                                                             | existente; sin auditoría lingüística externa en este cambio |
| `de`          | catálogo mantenido del producto                        | completo                                                                             | existente; sin auditoría lingüística externa en este cambio |
| `de-CH`       | overrides regionales existentes                        | técnicamente activo; 1.803 overrides pendientes de reducir                           | sin nueva revisión nativa                                   |
| `fr`          | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, revisión y exactos cruzados cerrados          | revisión por bloques y postensamblado; sin revisión nativa  |
| `it`          | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, revisión y exactos cruzados cerrados          | revisión por bloques y postensamblado; sin revisión nativa  |
| `gl`          | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, revisión y exactos cruzados cerrados          | revisión independiente por bloques; sin revisión nativa     |
| `ca`          | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, revisión y exactos cruzados cerrados          | revisión independiente; sin revisión nativa                 |
| `ca-valencia` | 394 diferencias regionales sobre `ca`                  | merge de 2.439 claves; overrides reales y revisión regional materializada            | revisión independiente regional; sin revisión nativa        |
| `eu`          | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, correcciones y excepciones cerradas           | revisión independiente; sin revisión nativa                 |
| `oc-aranes`   | traducción por secciones ensamblada desde `en`         | candidato de 2.439 claves; estructura, correcciones, revisión y excepciones cerradas | revisión independiente; requiere revisión nativa aranesa    |

Las salidas francesas ensayadas con OPUS, M2M100 418M y SalamandraTA-2B se
descartaron al detectar contaminación o errores semánticos. No se repararon por
ejemplos ni siguen siendo recetas ejecutables. Los candidatos francés e
italiano se construyeron después por secciones independientes, con traducción
y auditoría separadas antes de unir el conjunto canónico y ejecutar las puertas
estructurales y semánticas. Los hashes anteriores a las últimas 22 claves
visibles son evidencia histórica y no se reutilizan como aprobación: las
huellas finales se fijan únicamente cuando todos los catálogos y excepciones
cruzadas permanecen inmóviles.
Las vías descartadas no disponían de un objetivo aranés fiable distinto de
occitano `oc`. La ficha de SalamandraTA anuncia capacidad para `Aranese`, pero
el adaptador temporal usado en esa evaluación habilitó únicamente el piloto
francés. No produjo el catálogo aranés actual y se eliminará antes del commit;
la salida aranesa materializada sigue requiriendo revisión regional nativa.

### Evidencia reproducible de generación

No existe todavía una receta aprobada para los seis catálogos ni una generación
completa en curso. La última vía local evaluada fue
[`BSC-LT/salamandraTA-2b-instruct`](https://huggingface.co/BSC-LT/salamandraTA-2b-instruct),
con licencia Apache-2.0 y revisión fijada
`bd61551e6b5b2ff486ea5e9fa0b39a7477f2edbc`. El peso efectivo
`model.safetensors` debe conservar el SHA-256
`b8040eab8c2fe404cc9be3e46559e77f95600f42ccbdd4ea62a728d774341f63`.
El modelo queda rechazado para esta entrega. El primer piloto (16.892 B,
SHA-256 `955ae0a5ee0dfbc34201aae94cf9ab1acc34f1ceed7a38d44df9267f0b65d11b`)
contaminó la salida con el glosario; el segundo, con el prompt oficial exacto
(16.978 B, SHA-256
`5f49e0679a4ab092ec59a6f840eb7c69101de6a9f04ae516c5fa9983f83697a4`),
eliminó esa fuga pero siguió invirtiendo una autorización y fallando PIN,
prueba comercial, pagos y terminología jurídica. Ninguno produjo catálogo.

- Ejecución: Windows, CPU, hasta 8 hilos; fuente `en.json`.
- Librerías: PyTorch `2.13.0+cpu`, Transformers `4.57.1` y SentencePiece
  `0.2.1`.
- Parámetros de la evidencia descartada: lote 1, ChatML y prompt oficial inglés→destino,
  `do_sample=false`, `num_beams=1`, fecha de prompt fijada y techo dinámico de
  32 a 256 tokens. El modo completo está deshabilitado y se exige
  explícitamente `--pilot` y un único locale. El host AVX2 ejecutó en BF16 las
  operaciones básicas de matriz y atención; esto demuestra compatibilidad del
  runtime, no rendimiento aceptable del modelo ni calidad lingüística.
- Ninguna salida futura será candidata hasta documentar por locale el hash exacto del
  snapshot, la integridad de sus artefactos, el glosario, el corpus sensible y
  el informe semántico antes de eliminar la caché temporal.
- El corpus piloto francés deriva de las 51 claves versionadas en
  `scripts/localization-policy.json`. Una vez materializado el JSON temporal,
  se audita con `LOCALIZATION_PILOT_PATH` y la prueba focal de
  `server/locales.test.ts`; sin esa ruta la prueba específica se omite, y con
  una ruta ausente o divergente falla cerrado antes de revisión lingüística.
- El generador protege antes de traducir interpolaciones `{{...}}`, etiquetas
  HTML, URL, correos, rutas, fragmentos entre comillas invertidas, entidades,
  saltos de línea, marcas y una allowlist versionada de tokens técnicos. Las
  palabras ordinarias en mayúsculas, como `MEMBER ACCOUNT`, permanecen
  traducibles. Separa además el
  núcleo lingüístico de la puntuación y el whitespace de sus dos bordes,
  descarta delimitadores externos añadidos por el modelo y restaura exactamente
  el envoltorio original. Antes de escribir, exige el mismo conjunto, recuento
  y orden de estructura ejecutable, marcas y tokens técnicos, además de los
  espacios y saltos significativos. La puntuación lingüística adyacente puede
  variar; una reordenación revisada requiere una excepción por locale y clave
  fijada por los hashes de las firmas de origen y destino.
- `For Time` y `Tabata` se consideran nombres de modalidad del producto y se
  conservan literalmente en todos los catálogos nuevos, igual que `AMRAP` y
  `EMOM`. `ID` no pertenece a la allowlist global: solo
  `support.addAgentDescription` exige su recuento exacto, de modo que el francés
  natural `l'ID` es válido y otras claves pueden usar `identifiant`. Esta
  protección de generación no se atribuye retroactivamente a los catálogos
  mantenidos `es`, `de` o `de-CH`.
- Generador, entorno Python, pesos y cachés son herramientas temporales fuera
  del producto y se eliminan antes del commit. No se incluyen rutas locales ni
  descargas en Git.

La página oficial de la última vía local evaluada es
[`BSC-LT/salamandraTA-2b-instruct`](https://huggingface.co/BSC-LT/salamandraTA-2b-instruct).
SalamandraTA-2B, OPUS y M2M100 418M permanecen documentados como evidencia
descartada, no como receta vigente.

## Puertas de calidad

`server/locales.test.ts` compara los catálogos completos con `en` y combina
`de-CH`/`de` y `ca-valencia`/`ca`. Por cada clave comprueba:

- igualdad exacta del conjunto de claves del catálogo canónico;
- nombres y sintaxis de interpolaciones, incluidos espacios significativos;
- etiquetas y fragmentos HTML;
- URL, correos, rutas y secuencias técnicas protegidas;
- saltos de línea, indentación y espacios iniciales/finales;
- fallback completo de las variantes regionales.

La revisión semántica añade un barrido reproducible de coincidencias completas
con `es` y contaminación cruzada, con una allowlist explícita por clave para
marcas, códigos, nombres propios y cognados realmente idénticos. El residual se
revisa clave por clave. El muestreo estratificado cubre al menos legal,
seguridad, pagos, soporte, invitaciones y analítica. Una nueva clave rompe la
igualdad de catálogos y no puede pasar la puerta completa sin traducción o una
decisión regional explícita.

En italiano, [`account`](https://www.treccani.it/enciclopedia/account_%28Lessico-del-XXI-Secolo%29/)
y [`password`](https://www.treccani.it/vocabolario/password/) son préstamos
informáticos documentados por Treccani y se excluyen del barrido residual solo
para `it`, con motivo y fuente versionados. Las coincidencias completas siguen necesitando una excepción por
clave, evidencia y hash; la dispensa no se propaga a otros idiomas ni oculta
otros términos ingleses.

Ninguno de estos controles sustituye una revisión profesional/nativa. Aunque
ya están materializados y sus auditorías internas quedan cerradas, `fr`, `it`,
`gl`, `ca`, `eu`, `ca-valencia` y especialmente `oc-aranes` siguen siendo
candidatos lingüísticos hasta completar esa revisión. La rama tampoco es
entregable hasta superar la validación global y la revisión final del diff;
ningún locale nuevo se presenta como validado en producción.

### Etiquetas manuales de idioma

Las claves `language.*` no se aceptan como un efecto secundario del modelo: se
mantienen en la tabla versionada y no ejecutable
`scripts/localization-policy.json` y se comprueban exactamente en cada
catálogo.
Para las dos decisiones que no eran evidentes por comparación entre los
catálogos existentes se fijan estos criterios reproducibles:

- Italiano usa `Valenziano`, que es la forma devuelta para la variante
  `ca-ES-valencia` por `Intl.DisplayNames` en el runtime fijado Node `24.15.0`.
- Aranés usa `Castelhan` como nombre principal del español. El
  [Conselh Generau d'Aran](https://aranes.conselharan.org/es/recorsi-linguistics/)
  emplea esa forma en sus recursos de traducción y
  [TERMCAT](https://www.termcat.cat/ca/cercaterm/castella?type=basic) registra
  `castelhan` como término principal y `espanhòu` como sinónimo complementario.
- Euskera conserva `Gaztelania`, `Galiziera`, `Katalana`, `Valentziera` y
  `Aranera`, de acuerdo con la
  [norma 38 de Euskaltzaindia](https://www.euskaltzaindia.eus/dok/arauak/Araua_0038.pdf).
  Las mayúsculas responden al uso de las etiquetas como nombres visibles de
  una lista, no a una transformación automática del modelo.

Estas decisiones fijan únicamente nombres de interfaz. No equivalen a una
revisión lingüística completa de los catálogos ni autorizan a traducir texto
introducido por usuarios.

## Proveedores externos

Los contratos de proveedor permanecen separados y nunca amplían por inferencia
sus idiomas:

- Turnstile inspecciona la etiqueta de interfaz con un validador BCP 47 neutral
  propio, sin pasar por el canonicalizador persistente ni heredar su fallback
  `es`. Solo después reduce `es`, `en`, `de`, `fr` e `it` a códigos admitidos;
  vacío, desconocido, etiqueta malformada y los cooficiales devuelven `auto`.
  Referencia oficial revisada el 27 de agosto de 2026, página actualizada por
  Cloudflare el 5 de mayo de 2026:
  <https://developers.cloudflare.com/turnstile/reference/supported-languages/>.
- Stripe Connect Accounts v2 recibe el locale de plataforma ya canónico o
  persistido. `es`, `en`, `de`, `fr` e `it` se envían cuando el contrato los
  admite; `de-CH` usa `de`; cooficiales y desconocidos omiten la preferencia
  para que Stripe aplique su comportamiento neutral. Integración fijada en
  Stripe SDK `22.5.0` y API `2026-07-29.dahlia`. Referencias revisadas el 27 de
  agosto de 2026:
  <https://docs.stripe.com/api/v2/core/accounts/create> y
  <https://docs.stripe.com/connect/get-started-connect-embedded-components>.

## Persistencia y actualizaciones

El esquema inicial y los contratos TypeScript aceptan los once locales. Para
instalaciones existentes:

- SQLite reconstruye transaccionalmente `commercialTrials`,
  `administratorSignupProvisioning` y `umfSupportAccessRequests`, conserva
  filas, relaciones, índices y triggers, comprueba claves foráneas y es
  idempotente.
- PostgreSQL migra las tres restricciones efectivas
  `commercialTrials_locale_check`,
  `administratorSignupProvisioning_locale_check` y
  `umfSupportAccessRequests_locale_check`. El historial contiene cuatro
  definiciones `CREATE ... CHECK` porque `administratorSignupProvisioning` se
  redeclara una vez; no existe una cuarta restricción real.

La prueba SQLite parte de un esquema con datos anteriores, ejecuta la
actualización dos veces, conserva registros, relaciones, índices y triggers y
permite persistir los once locales. La prueba PostgreSQL es estructural: revisa
el SQL, el historial y los tres nombres de restricción efectivos, pero no
ejecuta la migración contra un servidor PostgreSQL ni demuestra conservación de
filas o idempotencia real. Esa ejecución queda pendiente en staging autorizado;
ninguna de estas pruebas es una inspección de una base de producción.

Las releases nuevas declaran el conjunto admitido en
`deploy/release-capabilities.json`. El actualizador no interpreta una migración
ampliativa como reversible por sí sola: `check-locale-rollback-safety.mjs`
agrupa en modo de solo lectura las cinco columnas de locale y los manifiestos de
entorno, y solo permite seleccionar una release anterior cuando todos los
valores están incluidos en sus capacidades. Un marcador ausente, un inventario
incompleto o una ruta persistente que cambia entre releases bloquean la
reversión. La primera transición desde el artefacto histórico sin marcador es
manual; esta política está probada en repositorio, no validada en staging ni en
producción.

## Deuda de mantenimiento aceptada

| Deuda                                    | Alcance e impacto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Prioridad                                                                    | Área responsable                                      | Disparador de reactivación                                                                                                                                                         | Criterio verificable de cierre                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniones y listas duplicadas              | La auditoría inicial localizó unas 20 uniones de tipo y 11 listas; permanecen siete guardas literales de datos persistidos/cifrados y otros contratos tipados. Una ampliación puede derivar entre fronteras.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | alta antes del próximo locale; media mientras el conjunto permanezca estable | arquitectura de plataforma e i18n                     | añadir o retirar un locale, o crear otra frontera que valide/persista locale                                                                                                       | tipos y guardas derivados de las fuentes canónicas; cero arrays literales fuera de migraciones históricas/adaptadores; prueba de deriva verde                                                                                                                                                      |
| `de-CH` sobredimensionado                | 1.803 overrides (1.767 idénticos a `de` y 36 distintos) elevan deriva y coste de revisión.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | media                                                                        | localización alemana                                  | siguiente revisión lingüística alemana/suiza o nueva clave visible                                                                                                                 | auditoría clave por clave, solo diferencias suizas conservadas, fallback completo frente al catálogo canónico y ausencia de `ß` probados                                                                                                                                                           |
| Gestor local Linux (`es`, `en` y `de`)   | Consola/JSON de `internal-manager-administrators.ts` y `platform-manager-admin.ts`; no afecta API ni web, pero limita la experiencia del operador.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | baja                                                                         | operaciones y herramientas de plataforma              | solicitud operativa para otro idioma o ampliación del gestor más allá de uso local Linux                                                                                           | tipos, ayuda, mensajes y pruebas admiten el conjunto aprobado sin exponer una API web                                                                                                                                                                                                              |
| Estados prospectivos de prueba comercial | `CommercialTrialStatus` y algunos consumidores contemplan `trial_created`/`trial_converted`, pero los `CHECK` vigentes de SQLite y PostgreSQL admiten solo los cinco estados persistidos actuales. La conversión continúa desactivada; no es una regresión de esta entrega, pero activar una transición produciría un fallo de persistencia.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | media; alta antes de activar conversión                                      | dominio comercial y persistencia                      | implementar una escritura de `trial_created`/`trial_converted`, habilitar la conversión o añadir otro consumidor que asuma que esos estados son persistibles                       | decisión explícita de retirar los estados prospectivos o migraciones idempotentes de ambos motores con pruebas desde esquemas/datos anteriores y recorridos de transición                                                                                                                          |
| Locale de respuestas a tickets externos  | `replyToUmfSupportTicket` usa `es` porque el ticket externo no persiste idioma y `requesterUserId` es nulo. El builder y la cola admiten los once locales, pero este consumidor no dispone de una preferencia fiable; no debe presentarse como correo de soporte totalmente localizado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | media                                                                        | UMF Support y correo transaccional                    | incorporar detección fiable al alta/entrada del ticket, asociar una identidad con locale o exigir respuestas localizadas para remitentes externos                                  | capturar y persistir el locale canónico del ticket con migración segura, propagarlo al builder/cola y probar el consumidor completo hasta entrega sin degradación silenciosa                                                                                                                       |
| Fronteras históricas de error en cliente | El barrido actual localiza transporte potencial de `body.error`, `data.error`, `payload.error` o `cause.message` en familias de facturación/pagos, comunidad, carga inicial de seguridad de cuenta, gestión de usuarios y en hooks de clases, reservas y analítica. `AuthProvider`/Login/Signup y prueba comercial ya usan códigos admitidos con fallback localizado y no forman parte de esta deuda. Los grupos pendientes incluyen `BillingPage`/`MemberPaymentsPage`, `CommunityPage`, `AccountSecurityPage`, `UserManagement`/`useUsers`, `useAdminClasses`, `useBookings` y `useAnalytics`, además de consumidores de cuenta, perfil, soporte e invitaciones enumerables con `rg`; el patrón indica una frontera por clasificar, no demuestra por sí solo que cada respuesta llegue a exponerse. | alta para una fuga reproducible; media para clasificación preventiva         | seguridad de cliente y áreas propietarias de cada API | nueva ruta que renderice texto del servidor, prueba que reproduzca detalle interno/inglés, cambio del contrato de errores o trabajo funcional en una de las familias inventariadas | inventario clave por clave de códigos públicos por flujo, adaptadores tipados con allowlist/fallback, pruebas de respuesta conocida/desconocida/5xx/no JSON/red en consumidores reales y búsqueda residual sin texto remoto visible; consola y telemetría técnica quedan clasificadas por separado |

No se añaden `TODO` genéricos al código: cualquier seguimiento debe apuntar a
este inventario mantenido o a una incidencia concreta con el mismo criterio de
cierre.

### Contratos duplicados

La ampliación actual actualiza los consumidores web/API incluidos en esta
entrega, pero no refactoriza de forma masiva las uniones y listas inventariadas
ni el gestor Linux para no elevar el riesgo. Los
puntos canónicos por entorno son
`client/src/i18n/supported-locales.ts` y
`server/lib/supported-locales.ts`; una prueba de deriva exige que ambos
publiquen el mismo conjunto y que coincida con catálogos, fallbacks y
validadores de entrada. Permanecen guardas de datos persistidos o cargas
cifradas en:

- `server/services/account-deletion-confirmation.ts`;
- `server/services/account-recovery.ts`;
- `server/services/email-change.ts`;
- `server/services/email-verification.ts`;
- `server/services/environment-manager.ts`;
- `server/services/support.ts`;
- `server/services/umf-support.ts`.

También quedan uniones en contratos de contexto/hooks/servicios y en
`server/db/types.ts`. En particular, `server/services/auth.ts`,
`server/services/commercial-trial.ts` y
`server/services/facility-invitations.ts` mantienen contratos tipados propios;
son distintos de las siete guardas de datos persistidos/cifrados anteriores y de
los cuatro sanitizadores HTTP ya centralizados. Riesgo: una ampliación futura
puede aceptar un locale en una frontera y degradarlo en otra. Criterio de
cierre: derivar tipos y guardas de las fuentes canónicas, eliminar arrays
literales de once locales fuera de migraciones históricas o adaptadores de
proveedor y mantener una prueba que falle ante cualquier consumidor divergente.

### `de-CH`

`de-CH.json` conserva 1.803 claves históricas, aunque la política exige solo
diferencias regionales. Riesgo: duplicación y deriva frente a `de`. Criterio de
cierre: auditar cada valor contra `de`, conservar únicamente diferencias de
ortografía o contexto suizo y demostrar mediante prueba que el fallback sigue
cubriendo todas las claves canónicas sin `ß`.

### Herramienta local de operadores

`server/services/internal-manager-administrators.ts` y
`scripts/platform-manager-admin.ts` mantienen `--locale es|en|de`. Es una
herramienta local Linux, con salida visible de consola/JSON, `webAvailable=false`
y sin API ni recorrido web. No rechaza locales antes de un flujo público porque
queda fuera de él. Riesgo: experiencia incompleta para un operador que quiera
usar otro idioma. Criterio de cierre: ampliar tipos, ayuda, mensajes y pruebas
de la herramienta a los locales aprobados, sin conectarla a una API web.

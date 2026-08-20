# Umbravia Forge

## Una plataforma para gestionar el centro, mejorar las reservas y conectar a la comunidad

**Umbravia Forge** es una plataforma en desarrollo para gimnasios y centros deportivos que reúne en un mismo entorno las reservas, los socios, los entrenadores, la actividad del centro, la facturación administrativa, la comunicación, la comunidad, el soporte y el análisis del funcionamiento del negocio.

Está diseñada para adaptarse a distintas formas de entrenamiento y organización: gimnasios tradicionales, CrossFit, HYROX, entrenamiento funcional, entrenamiento personal, powerlifting, strongman, culturismo, artes marciales, yoga, pilates, ciclo indoor, centros multidisciplinares y otros modelos personalizados.

La idea es sencilla:

> **que cada centro pueda adaptar la plataforma a su forma de trabajar, en lugar de tener que adaptar su forma de trabajar al programa.**

## Qué puede comprobarse hoy

Las funciones descritas en esta página forman parte del producto y de sus pruebas automatizadas. Antes de un lanzamiento comercial general todavía deben validarse en un entorno PostgreSQL autorizado la migración, el aislamiento entre centros, las copias y la restauración, el correo de extremo a extremo y la operación continuada.

Los pagos, las suscripciones y los reembolsos reales no están activados. La prueba permite conocer el producto, pero no debe confundirse con una producción validada para datos reales.

---

# ¿Qué problema quiere resolver Umbravia Forge?

Gestionar un centro deportivo implica mucho más que publicar horarios.

Cada día hay que administrar:

- socios;
- entrenadores;
- clases y actividades;
- plazas disponibles;
- reservas;
- listas de espera;
- cancelaciones;
- ausencias;
- asistencia;
- facturación;
- comunicación;
- incidencias;
- soporte;
- privacidad;
- comunidad;
- análisis de ocupación y actividad.

Cuando estas funciones están repartidas entre diferentes aplicaciones, hojas de cálculo, grupos de mensajería y procesos manuales, aumenta el trabajo administrativo y resulta más difícil conocer qué está ocurriendo realmente en el centro.

Umbravia Forge busca concentrar todas estas operaciones en un único entorno conectado.

---

# Reservas que no terminan al pulsar “Reservar”

Uno de los principales elementos de Umbravia Forge es su sistema de reservas.

La plataforma no trata una reserva como un simple “sí” o “no”. Tiene en cuenta todo lo que ocurre desde que un socio solicita una plaza hasta que finalmente asiste a la actividad.

Una reserva puede pasar por diferentes situaciones:

- plaza reservada;
- lista de espera;
- pendiente de confirmación;
- asistencia confirmada;
- usuario que todavía no sabe si podrá asistir;
- cancelación con suficiente antelación;
- cancelación tardía;
- asistencia realizada;
- ausencia;
- ausencia justificada.

Esto permite representar mejor lo que ocurre en un centro real.

## Confirmación de asistencia

Antes de una actividad, el centro puede solicitar al socio que indique:

**Sí, asistiré**

**No asistiré**

**Todavía no estoy seguro**

La tercera respuesta es especialmente importante.

No obliga al usuario a cancelar una plaza cuando todavía desconoce si podrá asistir, pero permite que el centro conozca el nivel de incertidumbre existente.

El objetivo es reducir situaciones como:

> una clase aparece completa durante horas, varias personas se quedan fuera y finalmente quedan plazas vacías porque algunos usuarios no acudieron.

---

# Listas de espera más útiles

Cuando una clase alcanza su capacidad máxima, los usuarios pueden entrar en lista de espera.

Cuando queda una plaza libre, Umbravia Forge puede promover automáticamente a otra persona.

La prioridad puede combinar la posición de la cola con el comportamiento reciente de las reservas.

Así, cuando existe mucha demanda, el centro puede disponer de herramientas para dar prioridad a usuarios con un historial más fiable de asistencia.

---

# Reputación de reservas

Umbravia Forge incorpora un sistema de reputación relacionado con el comportamiento de las reservas.

No es una puntuación pública ni pretende castigar permanentemente a los socios.

Su finalidad es ayudar a utilizar mejor las plazas cuando existe escasez.

Puede tener en cuenta aspectos como:

- asistencia habitual;
- confirmaciones cumplidas;
- cancelaciones realizadas con suficiente antelación;
- cancelaciones tardías;
- ausencias;
- respuestas de incertidumbre;
- incidencias justificadas;
- comportamiento reciente.

Por ejemplo, si una persona reserva repetidamente una plaza y cancela pocos minutos antes de comenzar la actividad, puede perder temporalmente prioridad cuando exista una clase completamente llena.

En cambio, si hay plazas disponibles, no tiene sentido impedirle asistir.

La reputación es además **recuperable**.

Un usuario puede mejorarla mediante un comportamiento normal de asistencia y cancelación responsable.

El centro conserva capacidad de revisión para situaciones justificadas.

La filosofía es:

> **responsabilidad cuando existe escasez, flexibilidad cuando existe capacidad.**

---

# Gestión de actividades adaptable

Cada centro puede organizar sus propias actividades.

La plataforma permite trabajar con elementos como:

- nombre;
- descripción;
- entrenador;
- sala;
- fecha;
- horario;
- duración;
- aforo;
- nivel;
- material;
- visibilidad;
- reglas de reserva;
- apertura y cierre de reservas;
- lista de espera;
- recordatorios;
- cancelaciones;
- excepciones.

El centro puede crear actividades individuales o estructuras reutilizables para facilitar la programación habitual.

Umbravia Forge utiliza además una terminología flexible.

Una misma función puede presentarse como:

- sesión;
- entrenamiento;
- clase;
- práctica;
- rutina;
- WOD;
- contenido de la sesión;
- cualquier término personalizado.

Esto permite que un box de CrossFit y un centro de yoga utilicen la misma plataforma sin que ninguno tenga que trabajar con vocabulario propio de otra disciplina.

---

# Contenido de cada sesión

Las actividades pueden contener información adicional preparada por el entrenador.

Una sesión puede dividirse, por ejemplo, en:

- calentamiento;
- movilidad;
- fuerza;
- técnica;
- acondicionamiento;
- bloque principal;
- vuelta a la calma;
- bloques personalizados.

Dentro de ellos pueden añadirse ejercicios, repeticiones, series, tiempos, descansos, cargas, materiales, adaptaciones, notas y contenido multimedia.

El socio puede consultar el contenido y registrar su progreso.

Así, la reserva no desaparece después de terminar la clase.

Puede convertirse también en parte del historial de entrenamiento.

---

# Gestión de socios, entrenadores y administradores

Umbravia Forge distingue diferentes responsabilidades dentro del centro.

Los **socios** pueden acceder a sus actividades, reservas, datos personales, seguridad y comunidad.

Los **entrenadores** pueden gestionar las sesiones que les corresponden, consultar participantes y trabajar con el contenido deportivo.

Los **administradores del centro** disponen de herramientas para gestionar actividades, usuarios, facturación, analítica y configuración.

Además, Umbravia Forge separa la administración de cada centro de la administración interna de la propia plataforma.

Un administrador de un gimnasio no se convierte por ello en administrador global de Umbravia Forge.

---

# Una misma cuenta, diferentes centros

Umbravia Forge incorpora una arquitectura multi-centro con membresías y contexto de centro resuelto por el servidor.

Cada centro mantiene separados:

- sus socios;
- sus entrenadores;
- sus actividades;
- sus reservas;
- su facturación;
- su comunidad;
- sus datos operativos.

El código y las pruebas automatizadas rechazan accesos entre centros en las áreas operativas principales. Esa cobertura debe repetirse sobre el esquema PostgreSQL y el despliegue autorizados antes de presentar el aislamiento como validado en producción.

Al mismo tiempo, una misma persona puede conservar su identidad en Umbravia Forge y participar en diferentes centros cuando tenga autorización para hacerlo.

---

# Seguridad y control de la cuenta

La protección de la cuenta forma parte del servicio y no se trata como una función premium independiente.

Los usuarios disponen de medidas como:

- verificación de correo;
- recuperación de cuenta;
- sesiones que pueden cerrarse de forma remota;
- autenticación en dos pasos;
- códigos de recuperación;
- passkeys;
- historial reciente de seguridad;
- controles de privacidad.

El objetivo es ofrecer al usuario más control sobre quién puede entrar en su cuenta y qué hacer si pierde acceso o detecta actividad sospechosa.

Umbravia Forge también separa los accesos destinados a socios de los destinados al personal del centro.

---

# Comunidad dentro del propio centro

Umbravia Forge no quiere limitar la relación entre centro y socios a reservar una plaza.

La plataforma incorpora una capa de comunidad que puede incluir:

### Chat de una actividad

Los participantes pueden disponer de un espacio relacionado con una clase concreta para:

- resolver dudas;
- recibir avisos;
- coordinarse;
- comentar la sesión;
- compartir información permitida por el centro.

### Chat general del centro

El gimnasio puede mantener espacios para:

- avisos;
- entrenamiento;
- dudas;
- eventos;
- actividades;
- grupos;
- información general.

### Contactos y comunidades

Los usuarios pueden establecer contactos internos utilizando su identidad de Umbravia Forge sin tener que compartir automáticamente su número de teléfono o correo electrónico.

El sistema está concebido para permitir también comunidades y colaboraciones entre centros cuando ambas organizaciones lo autoricen.

---

# Privacidad configurable

La vida social del usuario y sus datos administrativos no son lo mismo.

Por eso Umbravia Forge mantiene separados ambos ámbitos.

El usuario puede controlar la visibilidad de diferentes elementos de su perfil y decidir qué información comparte.

Por ejemplo, una persona puede utilizar un nombre de usuario dentro de la comunidad sin hacer público automáticamente:

- su correo electrónico;
- su teléfono;
- su dirección;
- su nombre completo;
- su fecha completa de nacimiento.

Las conversaciones privadas, las justificaciones personales y los datos administrativos mantienen controles de acceso diferenciados.

---

# Moderación y convivencia

Una comunidad necesita herramientas de moderación.

Umbravia Forge incorpora funciones para:

- denunciar mensajes;
- denunciar usuarios;
- bloquear usuarios;
- gestionar incidencias;
- aplicar restricciones;
- conservar trazabilidad;
- revisar decisiones;
- presentar apelaciones.

La moderación se estructura en diferentes niveles.

El centro puede gestionar su propia comunidad, pero Umbravia Forge puede intervenir ante situaciones graves o abusos demostrados.

El objetivo no es controlar opiniones legítimas, sino actuar frente a comportamientos concretos que puedan perjudicar a usuarios o centros.

---

# Forge Support

Umbravia Forge incorpora su propio sistema de soporte.

Los usuarios pueden abrir incidencias y mantener conversaciones privadas con el equipo de atención.

El sistema permite gestionar:

- tickets;
- categorías;
- prioridades;
- estados;
- conversaciones;
- archivos adjuntos;
- seguimiento;
- base de conocimiento;
- historial de cambios.

Esto permite que una incidencia importante no se pierda entre mensajes dispersos o correos sin contexto.

---

# Forge Notify

Las comunicaciones importantes de la plataforma se gestionan mediante un sistema propio de notificaciones transaccionales.

Puede utilizarse para:

- verificar una cuenta;
- recuperar acceso;
- comunicar eventos de seguridad;
- enviar actualizaciones de soporte;
- gestionar avisos importantes.

El sistema registra el estado de la cola, gestiona reintentos y mantiene separada la lógica de Umbravia Forge del transporte de correo configurado.

La entrega real depende además de la configuración operativa, DNS, reputación y proveedor. Una aceptación del mensaje por el transporte no garantiza por sí sola su llegada a la bandeja de entrada.

---

# Facturación y administración económica

Umbravia Forge incluye un área de facturación administrativa vinculada a los socios.

El centro puede:

- buscar un socio;
- consultar su historial;
- asociar registros económicos;
- trabajar por periodos;
- consultar importes pagados o pendientes;
- preparar facturas y documentos;
- organizar conceptos;
- exportar información.

La plataforma busca mantener flexibilidad para que cada centro pueda reflejar su propia operativa.

Actualmente Umbravia Forge no procesa todavía pagos reales, suscripciones ni reembolsos.

La integración con sistemas de pago forma parte de una fase posterior, después de validar el producto con centros reales.

---

# Forge Analytics

Umbravia Forge transforma la actividad diaria en información que el centro pueda comprender.

El área de analítica permite estudiar aspectos como:

- ocupación;
- asistencia;
- cancelaciones;
- demanda;
- actividad por horario;
- actividad por disciplina;
- comportamiento de las reservas;
- evolución histórica.

El objetivo no es llenar el panel de gráficos.

El objetivo es responder preguntas útiles:

> ¿Qué actividades se llenan más?

> ¿En qué horarios tenemos mayor demanda?

> ¿Dónde se producen más cancelaciones?

> ¿Qué clases podrían aprovechar mejor su capacidad?

> ¿Cuántas plazas recuperamos gracias a la lista de espera?

Las encuestas mensuales permiten contrastar estas métricas con la percepción de los usuarios. Los resultados ayudan a revisar horarios, aforos y decisiones operativas, sin presentar una correlación como causa demostrada.

---

# Una prueba antes de comprar

Umbravia Forge parte de una filosofía comercial poco invasiva:

> **Producto primero, conversación después.**

El centro puede disponer de un entorno de prueba durante **31 días**.

La prueba puede generar automáticamente datos de ejemplo para explorar el funcionamiento de la plataforma.

El usuario puede:

- cambiar configuraciones;
- crear actividades;
- modificar horarios;
- probar reservas;
- experimentar con usuarios ficticios;
- borrar información;
- explorar la plataforma sin miedo a estropear un entorno real.

No es obligatorio hablar con un comercial para empezar a conocer el producto.

Si posteriormente necesita ayuda, puede solicitarla voluntariamente.

Al finalizar la prueba, Umbravia Forge está diseñada para distinguir entre información ficticia y datos reales introducidos por el centro, evitando convertir automáticamente una demostración en producción sin revisión.

---

# ¿En qué se diferencia Umbravia Forge?

El mercado dispone de excelentes soluciones especializadas.

Algunas destacan en reservas, otras en administración, otras en coaching, CRM, facturación o gestión empresarial.

Umbravia Forge busca diferenciarse mediante **la combinación de varias ideas dentro de una misma plataforma**.

## 1. Reserva basada en comportamiento, no solo disponibilidad

Una plaza no se considera únicamente ocupada o libre.

Umbravia Forge puede tener en cuenta confirmaciones, incertidumbre, cancelaciones, ausencias, listas de espera y reputación recuperable.

Esto permite atacar uno de los problemas cotidianos más frustrantes de las actividades con aforo limitado:

**las plazas bloqueadas que finalmente quedan vacías.**

---

## 2. Comunidad integrada con la actividad

La comunidad no funciona simplemente como un canal de soporte entre centro y usuario.

Puede relacionarse directamente con:

- actividades;
- entrenadores;
- participantes;
- centros;
- contactos;
- comunidades.

Una reserva puede convertirse también en un punto de encuentro para las personas que participan en esa actividad.

---

## 3. Identidad social sin obligar a compartir datos personales

El usuario puede relacionarse mediante una identidad interna y un nombre de usuario.

No necesita entregar automáticamente su teléfono a otras personas para participar en grupos o comunidades.

Esto permite construir interacción social manteniendo mayor separación entre identidad pública y datos administrativos.

---

## 4. Seguridad integrada desde el diseño

MFA, passkeys, recuperación, sesiones revocables y controles de privacidad forman parte de la plataforma.

La seguridad no se plantea como un complemento opcional reservado a clientes que paguen más.

---

## 5. Adaptación a diferentes tipos de centros

Umbravia Forge no está limitada a una única disciplina.

Puede configurar entornos para:

- gimnasio tradicional;
- CrossFit;
- HYROX;
- entrenamiento funcional;
- entrenamiento personal;
- powerlifting;
- strongman;
- culturismo;
- artes marciales;
- yoga;
- pilates;
- ciclo indoor;
- centros multidisciplinares;
- configuraciones personalizadas.

Cada centro puede adaptar terminología, actividades, aforos y funcionamiento.

---

## 6. Soporte integrado

Forge Support permite gestionar incidencias directamente dentro del ecosistema de Umbravia Forge, manteniendo historial, contexto y seguimiento.

---

## 7. Analítica conectada con las reservas

Forge Analytics no se limita a contar usuarios.

Puede relacionar demanda, capacidad, reservas, cancelaciones, asistencia y horarios.

Esto permite medir no solamente cuánto se utiliza el centro, sino también **cómo se está utilizando**.

---

## 8. Centros independientes que también pueden colaborar

La arquitectura mantiene separados los datos de cada centro, pero permite crear relaciones controladas entre comunidades cuando los centros lo decidan.

El aislamiento sigue siendo la norma.

La colaboración es una excepción voluntaria.

---

# Cómo evaluar Umbravia Forge frente a otras plataformas

Las funciones, precios y condiciones de otras plataformas cambian y deben comprobarse directamente con cada proveedor. Por eso esta presentación no atribuye fortalezas ni carencias concretas a terceros.

Para comparar opciones de forma útil, conviene revisar con una demostración y por escrito:

- cómo se gestionan confirmaciones, incertidumbre, cancelaciones, ausencias y listas de espera;
- si la reputación de reservas es comprensible, revisable y recuperable;
- qué datos ve cada centro, entrenador, administrador y socio;
- cómo se separan la identidad social y los datos administrativos;
- qué canales de comunidad, moderación y soporte forman parte del producto;
- qué métricas proceden de hechos operativos y cuáles son recomendaciones;
- qué incluye la prueba y qué sucede con sus datos al terminar;
- qué pagos, integraciones, aplicaciones nativas y garantías operativas están realmente disponibles;
- cómo se exportan los datos y cómo se recupera una cuenta;
- qué evidencias existen de copias, restauración, seguridad y aislamiento.

Umbravia Forge propone hacer esa evaluación empezando por el producto y sus límites verificables, sin exigir una conversación comercial para acceder al entorno de prueba.

---

# Los principales puntos fuertes de Umbravia Forge

## Reduce la incertidumbre de las reservas

No solo gestiona plazas.

Intenta conseguir que las plazas reservadas terminen utilizándose.

## Une gestión y comunidad

El socio no necesita utilizar una aplicación para reservar y otra completamente separada para relacionarse con el centro.

## Se adapta al centro

No presupone que todos los gimnasios trabajan igual.

## Protege la identidad del usuario

La comunidad no exige convertir datos privados en datos sociales.

## Mantiene separados los centros

Cada organización conserva su propio espacio operativo.

## Permite explorar antes de comprar

31 días para conocer el producto sin obligación de iniciar inmediatamente una conversación comercial.

## Integra soporte y continuidad

Cuenta, recuperación, soporte y comunicaciones forman parte del mismo ecosistema.

## Convierte actividad en información

Las reservas y asistencias pueden terminar ayudando al centro a tomar mejores decisiones.

---

# ¿Para quién está pensada?

Umbravia Forge está especialmente orientada a:

- gimnasios tradicionales;
- boxes de CrossFit;
- centros HYROX;
- estudios de entrenamiento funcional;
- entrenadores personales;
- academias de artes marciales;
- centros de powerlifting;
- centros de strongman;
- estudios de yoga;
- centros de pilates;
- estudios de ciclo indoor;
- instalaciones multidisciplinares;
- proyectos deportivos con necesidades propias.

La arquitectura contempla desde centros pequeños hasta organizaciones con múltiples instalaciones. Ese crecimiento debe validarse con datos y carga representativos antes de comprometer una escala concreta.

---

# Nuestra idea de servicio

Umbravia Forge no quiere ser simplemente:

> “otra aplicación para reservar clases”.

La propuesta es construir un espacio digital donde el centro pueda gestionar su operación y donde el socio pueda relacionarse con su actividad deportiva.

Desde que se publica una clase hasta que el usuario reserva, confirma, entrena, participa en su comunidad y vuelve la semana siguiente.

Desde que un administrador configura el centro hasta que analiza qué horarios funcionan y dónde se están perdiendo plazas.

Desde que una persona crea su cuenta hasta que necesita recuperarla o solicitar ayuda.

Todo dentro del mismo ecosistema.

---

# Umbravia Forge

**Gestiona. Organiza. Conecta. Comprende. Evoluciona.**

Una plataforma cuyo objetivo es que los centros deportivos dediquen menos tiempo a coordinar herramientas y más tiempo a gestionar su comunidad y su actividad.

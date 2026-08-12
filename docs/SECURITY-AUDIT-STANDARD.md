# Estándar interno de auditoría integral de seguridad

**Versión:** 1.1

**Estado:** base oficial interna

**Ámbito:** Umbravia Forge y sus futuros entornos autorizados

## 1. Propósito

Este estándar convierte las revisiones de seguridad en un proceso repetible,
trazable y proporcional al riesgo. Define qué comprobar, bajo qué autorización,
qué evidencias conservar y cuándo una evaluación puede considerarse cerrada.

No es una certificación, una autorización permanente para atacar sistemas ni un
dictamen jurídico. Cada ejecución debe tener alcance, entorno, responsables y
reglas de intervención propios.

## 2. Principios obligatorios

1. **Autorización previa y escrita.** Deben constar activos, fechas, técnicas
   permitidas, límites de carga, contactos y procedimiento de parada.
2. **Entorno adecuado.** Las pruebas destructivas, de persistencia, radio,
   fuerza bruta de alto volumen o movimiento lateral solo se realizan en un
   laboratorio desechable o preproducción expresamente preparado.
3. **Datos sintéticos.** No se usan credenciales filtradas, hashes ajenos ni
   datos personales reales salvo autorización y necesidad documentadas.
4. **Mínimo impacto.** Se prueba el control con la menor explotación necesaria.
   Una prueba se detiene si amenaza disponibilidad, integridad o terceros.
5. **Evidencia reproducible.** Todo hallazgo debe incluir activo, precondición,
   pasos, resultado, impacto, severidad y evidencia saneada.
6. **Corrección verificable.** Un hallazgo no se cierra por modificar código,
   sino después de una prueba de regresión y una nueva validación.
7. **Separación entre hecho e hipótesis.** Los informes distinguen resultados
   observados, riesgos inferidos, controles no probados y trabajo futuro.
8. **Cobertura demostrable.** Una superficie no probada se registra como `NE`
   (no evaluada), nunca como segura por omisión. `NA` (no aplicable) exige una
   justificación revisable.
9. **Corrección de causa raíz.** Se evita resolver únicamente el ejemplo que
   reveló el fallo. El retest cubre la misma familia de rutas, roles, objetos y
   estados afectados.
10. **Defensa proporcional.** Las pruebas de volumen, concurrencia o abuso se
    ejecutan con presupuesto, límites y señal de parada. Demostrar el control es
    preferible a agotar el sistema.

## 2.1 Marcos de referencia

El estándar usa como referencias, sin convertirlas en listas de cumplimiento
automático:

- [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)
  para requisitos verificables de controles de aplicación;
- [OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/) para
  técnicas y casos de prueba web;
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
  para autorización de objetos y funciones, consumo de recursos, flujos de
  negocio e integraciones;
- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) para
  integrar requisitos, evidencias y correcciones dentro del ciclo de
  desarrollo seguro.

Las referencias concretas se registran con versión e identificador siempre que
sea posible. Una herramienta automática o una lista Top 10 no sustituye el
análisis de riesgo propio del producto.

## 3. Puerta de entrada de cada auditoría

Antes de ejecutar pruebas se crea una ficha con:

- identificador, objetivo y responsable de la evaluación;
- commit, versión, entorno y arquitectura evaluados;
- dominios, IP, API, aplicaciones, cuentas y dispositivos incluidos;
- exclusiones explícitas y proveedores de terceros;
- modalidades autorizadas: caja negra, gris o blanca;
- intensidad máxima, concurrencia y ventanas de mantenimiento;
- datos de laboratorio, cuentas por rol y procedimiento de restauración;
- contactos de emergencia, señal de parada y tratamiento de evidencias;
- autorización específica para red, AD, Wi-Fi, físico o ingeniería social.

La ficha incluye además:

- diagrama de componentes, límites de confianza, flujos de datos y proveedores;
- matriz de roles, tenants/centros, propietarios, estados y operaciones;
- inventario de datos por sensibilidad, cifrado, residencia y retención;
- versión de cliente, servidor, Worker, esquema y configuración no secreta;
- presupuesto de peticiones por segundo, concurrencia, datos y almacenamiento;
- estado inicial comprobable, copia o instantánea y procedimiento de retorno;
- reloj, zona horaria y ventanas relevantes para caducidad y tareas diferidas;
- exclusión de identidades reales cuando existan cuentas sintéticas suficientes.

Sin esta ficha solo se permiten análisis estáticos y pruebas locales no
destructivas dentro del repositorio propio.

### 3.1 Señales de parada

La ejecución se detiene y se conserva evidencia si ocurre cualquiera de estas
condiciones:

- degradación sostenida de salud, latencia o disponibilidad;
- pérdida o corrupción de datos fuera del laboratorio;
- acceso accidental a datos reales no necesarios para la prueba;
- activación de cobros, correos masivos o acciones de terceros no previstas;
- crecimiento no acotado de CPU, memoria, disco, colas o registros;
- alcance, identidad del activo o autorización ambiguos;
- un control ya ha quedado demostrado y seguir solo aumentaría el impacto.

### 3.2 Estados de cada control

| Estado      | Significado                                                     |
| ----------- | --------------------------------------------------------------- |
| `OK`        | Esperado y observado coinciden, con evidencia reproducible      |
| `FALLO`     | Existe una desviación confirmada                                |
| `PARCIAL`   | El control funciona solo en parte del alcance                   |
| `NA`        | No aplica, con justificación y aprobación                       |
| `NE`        | No evaluado o evidencia insuficiente                            |
| `BLOQUEADO` | Una dependencia impide probar sin ampliar autorización o riesgo |

## 4. Fases del estándar

### Fase A — Estabilidad y línea base

- instalación reproducible desde el archivo de bloqueo;
- formato, lint, tipos, pruebas y compilación;
- arranque y apagado limpios, puertos y procesos residuales;
- migraciones, semillas idempotentes e integridad de la base;
- auditoría de dependencias, secretos y configuración insegura;
- copia y restauración cuando exista infraestructura persistente.
- consistencia entre commit, artefacto, release activa y esquema real;
- comportamiento ante reloj adelantado/atrasado, cambio de zona horaria y
  caducidades en el límite;
- límites y recuperación ante memoria, disco, descriptores o colas agotados;
- idempotencia de despliegue, trabajos repetidos y reintentos tras interrupción;
- limpieza de artefactos temporales y ausencia de procesos o puertos residuales.

Un fallo de estabilidad que invalide resultados se corrige antes de continuar.

### Fase B — Caja blanca

Revisión del código, configuración y modelo de amenazas:

- autenticación, recuperación, MFA, passkeys y sesiones;
- autorización por rol, propiedad y centro;
- validación, serialización, cargas y tratamiento de errores;
- consultas, transacciones, concurrencia y restricciones de datos;
- cookies, CORS, CSRF, CSP, cabeceras, proxy y TLS;
- secretos, dependencias, CI, logs y datos sensibles;
- reservas, delegaciones, facturación, exportaciones y ciclo de cuenta;
- puntos de ejecución dinámica, subida/descarga y renderizado inseguro.
- separación multitenant en cada consulta, índice, caché, evento y trabajo
  asíncrono;
- estados imposibles, transiciones incompletas y comprobaciones de propiedad;
- idempotencia, bloqueos, carreras, doble envío y transacciones parciales;
- criptografía aplicada, contexto de cifrado, integridad y rotación compatible,
  sin exponer ni modificar material de claves durante la auditoría;
- minimización de datos en respuestas, telemetría, errores y exportaciones;
- superficies de servidor, navegador, Worker, cliente de escritorio y tareas;
- rutas huérfanas, funciones ocultas solo por interfaz y código no alcanzable;
- análisis de cambios sensibles mediante revisión diferencial contra la línea
  base anterior.

La caja blanca incorpora modelado de amenazas. Para cada límite de confianza se
documentan activos, actores, precondiciones y abuso razonablemente previsible.
Se combinan escenarios STRIDE con historias de abuso propias del negocio; no se
considera completo un modelo genérico que ignore centros, socios, entrenadores,
administradores, soporte, correo, pagos o entornos de prueba.

### Fase C — Caja gris

Con cuentas sintéticas de cada rol se comprueban:

- escalada vertical y acceso horizontal;
- rutas directas aunque la interfaz oculte el enlace;
- separación entre centros, entrenadores y socios;
- manipulación, caducidad, revocación y repetición de sesiones o tokens;
- operaciones entre sitios y cambios sensibles sin reautenticación;
- asignación masiva, parámetros inesperados y estados concurrentes.
- matriz completa `rol origen × tenant origen × objeto destino × acción`;
- intercambio de identificadores entre dos cuentas sintéticas y dos centros;
- uso de credenciales válidas de una cuenta sintética contra recursos de otra;
- objetos borrados, suspendidos, archivados, denunciados o pendientes;
- sesión recordada, varias pestañas, varios dispositivos y cierre global;
- visibilidad y propiedad de adjuntos, mensajes, tickets, pagos y exportaciones;
- alta, invitación, abandono, recuperación y eliminación por ciclo de vida.

Las cuentas administrativas sintéticas solo administran su tenant de prueba;
nunca reciben privilegios de operador de plataforma salvo que esa función sea
el objeto explícito de una auditoría separada.

### Fase D — Caja negra web y API

Desde una perspectiva externa y sin leer la implementación durante la prueba:

- inventario de rutas y métodos dentro del alcance;
- autenticación, autorización y limitación de intentos;
- entradas hostiles, JSON malformado, cuerpos y cabeceras excesivos;
- inyección, recorrido de rutas, cargas, exportaciones y errores;
- CORS, métodos no esperados, framing y cabeceras defensivas;
- concurrencia y presión acotada con umbrales acordados;
- esquemas, códigos de estado y ausencia de datos internos en respuestas.
- enumeración de recursos, cuentas, tenants y estados mediante tiempos o textos;
- autorización a nivel de objeto, propiedad y función en cada método HTTP;
- propiedades de respuesta excesivas y campos de entrada no documentados;
- SSRF, redirecciones, webhooks, URLs importadas y consumo inseguro de APIs;
- caché compartida, variantes por autorización y contenido privado indexable;
- subida poliglota, nombre, tipo, firma, tamaño, descompresión y descarga segura;
- XSS almacenado/reflejado/DOM, inyección en plantillas, CSV y cabeceras;
- petición duplicada, claves de idempotencia y repetición de eventos;
- rutas antiguas, versiones, documentación, mapas de fuentes y archivos de copia;
- CSP, HSTS, cookies, framing, MIME, permisos del navegador y política de origen.

La sonda incluida en el repositorio solo acepta objetivos locales. Probar una
preproducción requiere una herramienta y autorización separadas.

### Fase E — Identidad y resistencia de contraseñas

- política de longitud, bytes, previsibilidad y contraseñas comprometidas;
- coste y configuración del hash;
- enumeración de cuentas, limitación, CAPTCHA y bloqueo seguro;
- recuperación, verificación de correo, MFA, passkeys y revocación;
- prueba de diccionario exclusivamente sobre hashes sintéticos del laboratorio.
- diferencias observables entre cuenta inexistente, pendiente, bloqueada y activa;
- límites combinados por cuenta, dirección, dispositivo y riesgo, sin confiar en
  cabeceras reenviadas manipulables;
- caducidad, uso único, sustitución y revocación de códigos, enlaces y desafíos;
- cambio de correo, contraseña, rol, tenant o MFA con revocación de sesiones;
- protección del selector de cuentas: nunca guarda contraseña, token ni sesión;
- alta sintética de socio y administrador, verificación real de correo y
  recuperación mediante un buzón controlado;
- cuentas no verificadas, abandonadas o inactivas y sus ciclos de limpieza;
- recuperación privilegiada solo para identidades especiales autorizadas, con
  motivo, doble control y registro, nunca para rescatar cuentas desechables.

El crackeo agresivo real, los volcados ajenos y las campañas contra cuentas
reales quedan prohibidos. Una prueba de gran volumen exige equipo aislado,
presupuesto de recursos y límites aprobados.

### Fase F — Breach and Attack Simulation y Red Team

La simulación defensiva valida cadenas previamente acordadas, por ejemplo:

- sesión alterada o reutilizada tras revocación;
- usuario que intenta acceder a datos de otro rol o propietario;
- petición sensible iniciada desde un origen hostil;
- elevación mediante campos no permitidos;
- abuso distribuido simulado dentro de límites de laboratorio.

Un Red Team completo requiere objetivos, reglas de intervención y equipos
separados. Persistencia, phishing, exfiltración y movimiento lateral no se
suponen autorizados por este documento.

La fuerza bruta se simula por capas:

1. política y hash con credenciales sintéticas locales;
2. intentos limitados contra cuentas desechables y patrón conocido;
3. rotación controlada de dirección o dispositivo para validar que el límite no
   dependa de un único dato manipulable;
4. verificación del bloqueo, CAPTCHA, alerta, recuperación y desbloqueo legítimo.

Se registran frecuencia, concurrencia, duración, respuesta y criterio de parada.
No se busca acertar contraseñas reales ni aumentar el volumen después de probar
el control.

### Fase G — Infraestructura especializada

Estas superficies se evalúan únicamente cuando existan activos de laboratorio,
especialistas y autorización específica:

| Superficie       | Requisitos mínimos                                                   |
| ---------------- | -------------------------------------------------------------------- |
| Red interna      | Inventario, rangos propios, segmentación, ventana y restauración     |
| Active Directory | Dominio desechable, cuentas señuelo, GPO y controladores propios     |
| Red inalámbrica  | SSID y punto de acceso propios, adaptador compatible y límites radio |
| Seguridad física | Sede, horarios, zonas, acciones permitidas y coordinación presencial |

La ausencia de esos requisitos se registra como **no evaluado**, nunca como
control superado.

### Fase H — Multitenancy y lógica de negocio

- creación, selección y cambio de tenant/centro con pertenencia comprobada;
- aislamiento de consultas, agregados, buscadores, notificaciones y métricas;
- invitaciones, transferencias de propiedad y último administrador;
- subdominios: normalización, reserva, colisión, takeover y enrutamiento al
  tenant correcto;
- entornos MVP locales: límite máximo de disco y RAM, limpieza y promoción a
  cuenta real sin mezclar datos;
- reservas, aforos, reputación, moderación, comunidades y soporte por centro;
- flujos sensibles frente a automatización: altas falsas, spam, acaparamiento,
  reintentos y carreras;
- eliminación o abandono sin dejar recursos, archivos o referencias cruzadas.

### Fase I — Correo, colas, webhooks e integraciones

- salida y entrada extremo a extremo con cuentas controladas;
- SPF, DKIM, DMARC, PTR, HELO, IPv4/IPv6 y reputación sin confundirlos con el
  proxy web;
- cabeceras, codificación, HTML/texto, adjuntos y compatibilidad de clientes;
- autenticidad de webhook, repetición, orden, idempotencia y retrasos;
- rebotes, quejas, respuestas, bucles, destinatarios y supresión de secretos;
- caída parcial del proveedor, cola, backoff, entrega duplicada y conciliación;
- enlaces y códigos caducados, segundo envío y consumo de un código anterior;
- contenido hostil recibido por correo y límites antes de persistirlo.

Una conexión SMTP o un `200` del webhook no prueban entrega. El control solo se
marca `OK` cuando el mensaje sale, llega, se identifica, se lee y su efecto se
observa de forma trazable.

### Fase J — Pagos, suscripciones y facturación

Solo se prueba en el entorno de prueba del proveedor salvo autorización expresa:

- manipulación de precio, moneda, producto, cantidad, descuentos e impuestos;
- correspondencia entre cliente, tenant, suscripción y cuenta autenticada;
- webhook firmado, evento repetido, fuera de orden, retrasado o ausente;
- idempotencia de alta, renovación, factura, reembolso y cancelación;
- estados `incomplete`, `past_due`, `unpaid`, pausa, prueba y reactivación;
- actualización de método, portal de cliente y autorización del propietario;
- conciliación entre proveedor y base local sin confiar en el navegador;
- cancelación al final del período, prorrateo y conservación de derechos;
- ausencia de claves, PAN, secretos o datos fiscales en cliente, logs y Git.

### Fase K — Privacidad, retención y ciclo de vida

- minimización, finalidad, acceso, rectificación, exportación y borrado;
- retenciones contradictorias, hold, copias, adjuntos y eventos de seguridad;
- borrado de formulario no verificado y limpieza de cuentas abandonadas;
- prioridad de usuarios reales y activos en métricas y recuentos;
- anonimización efectiva y ausencia de reidentificación por relaciones;
- datos en logs, telemetría, cachés, índices, archivos temporales y proveedores;
- evidencia de borrado y restauración sin reintroducir datos ya eliminados.

### Fase L — Cliente, dispositivo y experiencia segura

- navegación y botones reales, estados de carga, errores recuperables y doble clic;
- almacenamiento local, selector de cuentas, caché y cierre de sesión;
- URL, historial, portapapeles, descargas y apertura de enlaces externos;
- compatibilidad de navegador y correo, accesibilidad y teclado;
- reconexión offline/online, suspensión, actualización y versión incompatible;
- permisos mínimos del dispositivo y límites de recursos locales;
- independencia operativa del sistema anfitrión sin romper compatibilidad.

### Fase M — Cadena de suministro, CI/CD y despliegue

- archivo de bloqueo, procedencia de dependencias y scripts de instalación;
- secretos, artefactos, SBOM cuando aplique y contenido del paquete final;
- permisos de Actions, dependencias fijadas y entradas no confiables;
- validación de commit, rama, firma/procedencia y resultado de CI;
- despliegue aislado, salud, rollback, limpieza de releases y espacio libre;
- equivalencia entre validación local y remota, sin marcar la tarea terminada
  hasta que GitHub Actions sea favorable;
- configuración fuera del repositorio y ausencia de valores sensibles en
  documentación pública.

### Fase N — Concurrencia, resiliencia y recuperación

- dos operaciones simultáneas sobre el mismo recurso o cupo;
- bloqueo optimista, transacciones, orden de eventos y consistencia eventual;
- corte entre escritura de base y archivo, correo, pago o webhook;
- reintento después de timeout sin duplicar el efecto;
- reinicio durante un trabajo y recuperación de operaciones en curso;
- copia verificada, restauración aislada y medición de RPO/RTO;
- degradación de dependencias con respuesta segura y observable;
- crecimiento de colas, logs y archivos temporales bajo límites acordados.

### Fase O — Observabilidad y respuesta

- evento auditable para acciones sensibles sin registrar secretos;
- correlación entre petición, usuario sintético, tenant, trabajo y proveedor;
- alerta útil ante fuerza bruta, abuso, webhook inválido y fallo de integridad;
- relojes coherentes, zona horaria explícita y orden de evidencias;
- logs con acceso restringido, retención definida y resistencia a inyección;
- runbook de contención, revocación, rollback, restauración y comunicación;
- ejercicio de detección: un control que bloquea pero nadie puede investigar se
  registra como parcial.

## 5. Técnicas complementarias

Según riesgo y presupuesto, la auditoría puede incorporar:

- pruebas basadas en propiedades para invariantes de autorización y estados;
- fuzzing acotado de validadores, parsers, archivos y serialización;
- pruebas de mutación para demostrar que una regresión detecta el control roto;
- comparación diferencial entre roles, tenants, versiones y proveedores;
- pruebas metamórficas: cambiar solo propietario, tenant o estado debe producir
  la diferencia de autorización prevista;
- fault injection controlada en archivos, base, correo, colas y webhooks;
- análisis estático, composición de dependencias y búsqueda saneada de secretos;
- revisión manual de lógica de negocio y recorridos completos en navegador.

Los resultados de un escáner son candidatos, no hallazgos confirmados. Cada
resultado se reproduce, contextualiza y depura antes de incorporarlo al informe.

## 6. Clasificación y tratamiento de hallazgos

La severidad combina explotabilidad, impacto técnico, impacto para el negocio,
datos afectados y controles compensatorios:

- **Crítica:** compromiso sistémico, exposición masiva o control administrativo
  con explotación viable.
- **Alta:** acceso relevante no autorizado, pérdida grave de integridad o
  disponibilidad, o elusión de un control esencial.
- **Media:** impacto limitado, precondiciones importantes o defensa incompleta.
- **Baja:** endurecimiento, exposición menor o condición de baja probabilidad.
- **Informativa:** observación sin vulnerabilidad demostrada.

Cada hallazgo pasa por `detectado → confirmado → en corrección → retest →
cerrado`, o queda `aceptado temporalmente` con responsable, motivo, controles
compensatorios y fecha de revisión.

Además de la severidad se registra:

- confianza (`alta`, `media`, `baja`) y reproducibilidad;
- alcance: usuarios, tenants, datos, operaciones y proveedores afectados;
- precondiciones y posibilidad de automatización;
- causa raíz y familia de controles potencialmente afectada;
- riesgo residual después de la corrección;
- propietario, versión objetivo y fecha límite.

Una corrección que solo oculta el botón, cambia el mensaje o bloquea un ID fijo
no cierra una vulnerabilidad de autorización o lógica de negocio.

## 7. Diseño de pruebas y evidencias

### 7.1 Caso de prueba mínimo

```text
ID y referencia:
Objetivo y riesgo:
Activo, versión y entorno:
Roles/tenants/cuentas sintéticas:
Precondiciones y datos:
Pasos y límite de intensidad:
Resultado esperado:
Resultado observado:
Estado: OK | FALLO | PARCIAL | NA | NE | BLOQUEADO
Evidencia saneada:
Hallazgo relacionado:
Limpieza/restauración:
```

Cada caso positivo importante tiene al menos su negativo equivalente. Para una
operación por propiedad se prueba el propietario, otro usuario del mismo tenant,
otro tenant, un rol superior no relacionado y una sesión anónima cuando aplique.

### 7.2 Hallazgo mínimo

```text
ID, título y severidad/confianza:
Estado y responsable:
Activo, versión y primera detección:
Descripción y causa raíz:
Precondiciones:
Reproducción mínima saneada:
Esperado frente a observado:
Impacto técnico y de negocio:
Alcance y variantes:
Corrección propuesta/aplicada:
Prueba de regresión y retest:
Riesgo residual y fecha de revisión:
```

### 7.3 Calidad de evidencia

- registrar UTC y zona local, commit, release y actor sintético;
- conservar solicitud y respuesta mínimas sin cookies, tokens o contraseñas;
- preferir IDs públicos o anonimizados en documentos compartidos;
- calcular hash de artefactos relevantes cuando la integridad importe;
- separar evidencia original restringida del informe saneado;
- documentar resultados negativos y limitaciones, no solo fallos llamativos.

## 8. Evidencias y entregables

Cada auditoría produce:

1. resumen ejecutivo y limitaciones;
2. alcance, commit y entorno exactos;
3. matriz de pruebas con esperado, observado y evidencia;
4. hallazgos priorizados con reproducción saneada;
5. correcciones aplicadas y pruebas de regresión;
6. riesgos residuales y superficies no evaluadas;
7. comandos o herramientas reproducibles que no contengan secretos;
8. comparación con la línea base anterior;
9. resultado final: superada, superada con excepciones o no superada.
10. cobertura por superficie, rol, tenant, estado y referencia externa;
11. lista explícita de controles `NE`, `NA`, bloqueados y aceptados;
12. análisis de causa raíz y acciones preventivas para fallos repetidos;
13. verificación de limpieza de cuentas, datos y credenciales sintéticas.

Las capturas y logs deben ocultar tokens, cookies, contraseñas, datos personales
y detalles que faciliten abuso fuera del equipo autorizado.

## 9. Criterios de salida

Una auditoría de versión queda cerrada cuando:

- la línea base de estabilidad supera todos sus controles;
- no quedan hallazgos críticos o altos sin corregir o aceptar formalmente;
- las correcciones tienen regresiones y retest satisfactorio;
- las excepciones incluyen propietario y fecha de revisión;
- el informe refleja claramente todo lo no evaluado;
- no quedan procesos, datos o credenciales temporales del laboratorio.
- el artefacto publicado corresponde al commit evaluado y la CI remota es
  favorable;
- los recorridos críticos se han probado de extremo a extremo, no solo por
  componentes;
- cada corrección incluye una regresión que fallaba antes y pasa después;
- la cobertura y las limitaciones permiten saber qué confianza aporta realmente
  el resultado.

Resultado final:

- **Superada:** cumple todos los criterios y no mantiene excepciones críticas o
  altas;
- **Superada con excepciones:** riesgos residuales formalmente aceptados, con
  propietario y fecha;
- **No superada:** línea base inválida, hallazgos críticos/altos abiertos o
  evidencia insuficiente en recorridos esenciales.

## 10. Cadencia recomendada

- **Cada cambio:** formato, lint, tipos, pruebas y compilación.
- **Cada dependencia o versión:** auditoría de paquetes y regresiones de
  seguridad automatizadas.
- **Antes de publicar:** caja blanca, gris, negra local y revisión de secretos.
- **Antes de producción:** preproducción representativa, infraestructura,
  copias, restauración, monitorización y prueba externa autorizada.
- **Tras un incidente o cambio crítico:** evaluación dirigida y retest completo
  de los controles afectados.
- **Periódicamente en producción:** ejercicio de respuesta, restauración y
  revisión independiente según riesgo y obligaciones aplicables.
- **Cada cambio de autorización o multitenancy:** matriz cruzada de roles,
  tenants, propiedad y estados.
- **Cada cambio de correo, pagos o webhooks:** entrega/evento real de prueba,
  repetición, fallo y conciliación.
- **Cada corrección de seguridad:** retest del hallazgo y de su familia de causa
  raíz.

## 11. Automatización disponible actualmente

```bash
npm run security:probe
npm run security:password-resilience
npm run check
npm run audit:ci
```

- `security:probe` ejecuta escenarios defensivos contra una API local y rechaza
  objetivos que no sean loopback.
- `security:password-resilience` usa únicamente contraseñas y hashes sintéticos.
- `check` valida formato, lint, tipos, pruebas y compilaciones.
- `audit:ci` bloquea avisos de dependencias no incluidos en una excepción
  explícita y acotada.

La automatización debe ampliarse cuando un hallazgo pueda expresarse como una
regresión estable. No se automatizan contra producción pruebas destructivas ni
de volumen; se ejecutan en laboratorio o preproducción con datos sintéticos.

## 12. Registro inicial que fundamenta este estándar

- [Auditoría de estabilidad y seguridad — 1 de agosto de 2026](./SECURITY-AUDIT-2026-08-01.md)
- [Evaluación extrema local de seguridad — 1 de agosto de 2026](./SECURITY-ASSESSMENT-EXTREME-2026-08-01.md)
- [Auditoría integral de seguridad — 5 de agosto de 2026](./SECURITY-AUDIT-2026-08-05.md)

Esos informes documentan lo ejecutado y sus resultados. Este estándar define
cómo deben planificarse, limitarse, comparar y cerrar las siguientes auditorías.

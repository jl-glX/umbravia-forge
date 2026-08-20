# Auditoría integral de seguridad — 5 de agosto de 2026

> [!NOTE]
> Evidencia histórica del commit auditado. El estado vigente se mantiene en
> [SECURITY.md](./SECURITY.md).

**Identificador:** UF-SEC-2026-08-05

**Estándar aplicado:** [Estándar interno de auditoría integral de seguridad](./SECURITY-AUDIT-STANDARD.md)

**Versión evaluada:** fa1a755426e9cdbde6ec44a383d419c41904a60b, con las correcciones documentadas en este informe

**Entorno:** Windows, Node.js 24.15.0, npm 11.12.1, API local aislada y datos sintéticos

## 1. Resumen ejecutivo

Umbravia Forge ha sido sometido a las fases de estabilidad, caja blanca, caja
gris, caja negra web y API, resistencia de contraseñas y simulación ofensiva
limitada definidas por el estándar interno.

La superficie local evaluada queda estable. La validación oficial supera 49
archivos y 195 pruebas, los 18 escenarios de caja negra pasan, los 7 escenarios
específicos de caja gris y BAS pasan y la evaluación de contraseñas utiliza
únicamente credenciales generadas para el laboratorio.

Se corrigieron dos problemas confirmados:

1. Vitest podía perder aleatoriamente un worker de tipo fork en Windows y la
   preparación de una suite podía superar el límite genérico de 10 segundos
   bajo carga completa. La configuración usa ahora un único worker basado en
   threads y reserva 30 segundos para los hooks de preparación.
2. La copia raíz del estándar conservaba el nombre anterior del producto,
   enlaces inexistentes y formato pendiente. Se actualizó a Umbravia Forge, se
   corrigieron sus enlaces y se normalizó el formato.

No se confirmó ninguna vulnerabilidad crítica ni alta explotable en la
aplicación local. Sí existen bloqueos altos de preparación para producción:
PostgreSQL aún no está conectado al arranque real, no existe un proveedor que
entregue los códigos de verificación por correo y la eliminación definitiva de
cuentas continúa desactivada hasta aprobar las políticas de retención.

**Resultado:** superada con excepciones para desarrollo y demostración local.
No constituye autorización para producción.

## 2. Ficha de alcance y reglas de intervención

| Campo                 | Valor                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| Activo autorizado     | Repositorio local C:\Proyectos\umbravia-forge                                           |
| Superficie dinámica   | 127.0.0.1 y localhost                                                                   |
| Datos                 | Cuentas, contraseñas y base de datos sintéticas y desechables                           |
| Caja blanca           | Código, configuración, dependencias, pruebas y migraciones                              |
| Caja gris             | Roles de socio, entrenador y administrador del laboratorio                              |
| Caja negra            | API local tratada como objetivo desconocido                                             |
| Carga máxima aplicada | Ráfaga de 64 lecturas de salud y 14 intentos controlados de acceso                      |
| Parada                | Caída de disponibilidad, escritura fuera de la base temporal o proceso no identificable |
| Evidencias excluidas  | Contraseñas, tokens, códigos de dispositivo y secretos                                  |

La API se inició con una carpeta temporal verificada, sin datos de demostración,
y se detuvo al terminar. La base normal del proyecto no fue utilizada por la
sonda.

## 3. Cobertura por fase

| Fase                              | Estado                      | Evidencia principal                                                      |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| A — Estabilidad                   | Superada                    | Formato, lint, tipos, 195 pruebas y compilaciones de cliente y servidor  |
| B — Caja blanca                   | Superada con excepciones    | Revisión de identidad, autorización, datos, producción y dependencias    |
| C — Caja gris                     | Superada                    | 7 escenarios dirigidos y 17 pruebas de autenticación, autorización y BAS |
| D — Caja negra web/API            | Superada                    | 18 de 18 escenarios locales                                              |
| E — Contraseñas e identidad       | Superada en laboratorio     | bcrypt coste 12 y diccionario sintético acotado                          |
| F — BAS y Red Team limitado       | Superada dentro del alcance | Manipulación de sesión, roles, propiedad, CSRF, masa y limitación        |
| G — Infraestructura especializada | No evaluada                 | Faltan laboratorio, activos y autorización específicos                   |

## 4. Caja blanca

La revisión directa del código cubrió:

- hashing bcrypt con coste 12 y límite previo de 72 bytes UTF-8;
- tokens de sesión aleatorios, almacenamiento exclusivo de su hash, caducidad,
  revocación y cookies HttpOnly, SameSite Strict y Secure en producción;
- MFA, cifrado de secretos, códigos de recuperación y passkeys vinculadas a
  desafíos emitidos por el servidor;
- autorización centralizada por rol, identidad, propiedad de reserva,
  delegación y propiedad de clase;
- CAPTCHA obligatorio en registro, acceso y verificación manual de formularios,
  con fallo cerrado en producción cuando no existe clave válida;
- protección de mutaciones mediante Origin y Sec-Fetch-Site;
- límites de cuerpos, validación estricta y gestión JSON de errores;
- acceso a datos mediante Kysely, SQL estático de migración, claves foráneas,
  índices y transacciones;
- ciclo de vida de cuentas, periodo de gracia, retención y cancelación tras una
  recuperación verificada;
- selección de base de datos, configuración de producción, TLS lógico,
  WebAuthn, orígenes y prohibición de datos demo;
- búsqueda de secretos versionados, ejecución dinámica, HTML inseguro, imports
  inexistentes, código ignorado y marcadores incompletos.

No se encontraron secretos reales versionados, uso de eval, new Function,
dangerouslySetInnerHTML, supresiones indiscriminadas de TypeScript ni SQL
construido con entradas del usuario.

## 5. Caja gris y BAS limitado

Con identidades sintéticas se verificó:

| Escenario                                           | Resultado |
| --------------------------------------------------- | --------- |
| Socio accede directamente a una ruta administrativa | 403       |
| Socio consulta una reserva ajena                    | 403       |
| Entrenador consulta una clase ajena                 | 403       |
| Administrador consulta la clase autorizada          | Permitido |
| Cookie de sesión manipulada                         | 401       |
| Sesión reutilizada después del cierre               | 401       |
| Borrado solicitado desde un sitio hostil            | 403       |
| IP reenviada falsa para eludir el limitador         | Bloqueada |

También se repitieron 16 pruebas específicas de borrado de cuenta y CAPTCHA, y
17 pruebas de autenticación, autorización y evaluación extrema. Todas pasaron.

No se realizó persistencia, phishing, exfiltración, destrucción de datos,
movimiento lateral ni acceso a sistemas ajenos.

## 6. Caja negra web y API

La sonda local superó 18 escenarios:

1. salud y cabeceras defensivas;
2. sesión anónima;
3. usuarios sin autenticación;
4. retención administrativa sin autenticación;
5. mutación desde origen hostil;
6. entrada similar a SQL;
7. inyección de objeto;
8. asignación masiva de rol;
9. JSON malformado;
10. cuerpo excesivo;
11. recorrido de ruta codificado;
12. preflight CORS hostil;
13. ráfaga de 64 comprobaciones de salud;
14. intentos de acceso con X-Forwarded-For rotatorio;
15. método TRACE;
16. framing HTTP ambiguo;
17. cabecera excesiva;
18. cuerpo fragmentado malformado.

Las respuestas mantuvieron los códigos esperados y la API siguió disponible.

## 7. Evaluación sintética de contraseñas

La prueba local generó credenciales exclusivas para el laboratorio:

- coste bcrypt: 12;
- tiempo de generación del hash observado: 324 ms;
- seis candidatos de diccionario: 1980 ms;
- rendimiento observado: 3,03 comparaciones por segundo;
- contraseña débil sintética: localizada, como se esperaba;
- contraseña fuerte aleatoria: no localizada;
- alias por encima de 72 bytes: reproducible en bcrypt bruto y rechazado por la
  política de Umbravia Forge antes del hash;
- credenciales reales o filtradas: ninguna.

Esta prueba demuestra resistencia de coste y validación de política, no una
garantía frente a contraseñas predecibles. MFA, passkeys, limitación y respuesta
a incidentes siguen siendo controles necesarios.

## 8. Hallazgos

| ID         | Severidad                          | Estado                         | Hallazgo                                                                                                                                  |
| ---------- | ---------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| UF-2026-01 | Media operativa                    | Corregido                      | Workers fork y límite de preparación de Vitest inestables bajo la carga completa en Windows                                               |
| UF-2026-02 | Baja documental                    | Corregido                      | Estándar raíz con ámbito anterior, enlaces inválidos y formato pendiente                                                                  |
| UF-2026-03 | Alta de preparación                | Abierto, bloqueo seguro        | El servidor real continúa importando el cliente SQLite; la configuración de producción exige PostgreSQL y rechaza el arranque incoherente |
| UF-2026-04 | Alta de preparación                | Abierto                        | Producción genera el desafío de correo, pero no devuelve el código ni dispone de proveedor para entregarlo                                |
| UF-2026-05 | Alta de preparación y cumplimiento | Abierto, ejecución desactivada | El cierre programa y revisa datos, pero no elimina definitivamente hasta aprobar retención y controles operativos                         |
| UF-2026-06 | Media                              | Abierto                        | Los limitadores conservan estado en memoria y no coordinan varias instancias                                                              |
| UF-2026-07 | Media                              | No evaluado en infraestructura | Proxy, TLS real, restauración, alertas y copias de seguridad no se probaron                                                               |
| UF-2026-08 | Media de arquitectura              | Abierto                        | El modelo operativo usa un centro principal; el aislamiento multiempresa no está demostrado                                               |
| UF-2026-09 | Informativa                        | Excepción acotada              | Aviso RSC de React Router no alcanzable por el BrowserRouter declarativo actual                                                           |

### UF-2026-01 — Estabilidad de Vitest en Windows

La secuencia oficial podía terminar con un worker fork perdido en archivos
distintos, sin aserción fallida. Después, la ejecución detallada confirmó que el
hook de preparación de la suite de borrado podía superar los 10 segundos bajo
carga completa aunque aislado pasase. Al usar un pool de threads, un worker,
ejecución no paralela y 30 segundos exclusivos para hooks, los 49 archivos y
195 escenarios pasan de forma reproducible sin relajar el tiempo de cada
prueba.

### UF-2026-03 — PostgreSQL no conectado

Existe adaptador, migraciones y validación de configuración para PostgreSQL,
pero el arranque importa todavía el cliente SQLite fijo. El sistema se niega a
anunciar PostgreSQL mientras usa SQLite, lo que evita una falsa producción,
pero también impide desplegar la configuración normal prevista.

### UF-2026-04 — Entrega de verificación por correo

El código de seis cifras se almacena mediante scrypt, caduca a los 15 minutos,
admite cinco intentos y se consume una sola vez. En desarrollo puede mostrarse
para la demo. En producción se oculta, pero todavía no se envía por ningún
canal. La cuenta nueva no tendría forma ordinaria de completar la verificación.

### UF-2026-05 — Borrado definitivo desactivado

La programación, el periodo de gracia, la cancelación, la revisión de
categorías y la conservación legal tienen pruebas. La ejecución real permanece
desactivada deliberadamente. Debe mantenerse así hasta contar con
reautenticación reciente, políticas aprobadas, cola idempotente, auditoría,
restauración y procedimiento de incidencias.

## 9. Superficies no evaluadas

Estas superficies no se consideran superadas:

- **Red interna:** no se proporcionaron rango, inventario, red de laboratorio ni
  ventana autorizada.
- **Active Directory:** no existe dominio desechable, controlador, cuentas
  señuelo ni GPO dentro del alcance.
- **Red inalámbrica:** no existe SSID propio aislado, adaptador ni autorización
  radioeléctrica.
- **Seguridad física:** no existe una sede ni reglas escritas de acceso,
  horarios, personas o acciones permitidas.
- **Crackeo agresivo real:** no se usaron hashes ajenos, volcados, credenciales
  reales ni alto volumen.
- **Red Team completo:** no se autorizó ingeniería social, persistencia,
  exfiltración, movimiento lateral ni afectación operativa.
- **Producción:** no existe aún una preproducción representativa con PostgreSQL,
  proxy, TLS, correo, telemetría y restauración.

## 10. Comparación con la evaluación del 1 de agosto

| Área                                   | 1 de agosto               | 5 de agosto                                               |
| -------------------------------------- | ------------------------- | --------------------------------------------------------- |
| Pruebas automatizadas                  | 24 archivos, 78 pruebas   | 49 archivos, 195 pruebas                                  |
| Caja negra                             | 18 escenarios             | 18 escenarios repetidos y superados                       |
| Caja gris/BAS dirigido                 | 7 escenarios              | 7 escenarios repetidos y superados                        |
| Borrado y CAPTCHA dirigidos            | Base inicial              | 16 pruebas específicas superadas                          |
| Autenticación y autorización dirigidas | Controles existentes      | 17 pruebas específicas superadas                          |
| Estabilidad de pruebas                 | Sin incidencia registrada | Worker y hook de preparación corregidos en Windows        |
| PostgreSQL                             | Riesgo conceptual         | Adaptador presente, integración de arranque aún bloqueada |
| Correo                                 | Recuperación pendiente    | Desafío seguro presente, entrega externa pendiente        |
| Producción                             | No aprobada               | Sigue no aprobada y falla de forma segura                 |

No se observó debilitamiento de sesiones, roles, propiedad, CSRF, límites,
contraseñas o migraciones respecto a la evaluación anterior.

## 11. Evidencias de validación

- npm run CI: formato, lint, tipos, 49 archivos, 195 pruebas, compilación del
  cliente, compilación del servidor y auditoría de dependencias superados.
- Sonda local: 18 de 18 escenarios superados.
- Evaluación gris y BAS: 7 de 7 escenarios superados.
- Pruebas dirigidas de borrado y CAPTCHA: 16 de 16 superadas.
- Pruebas dirigidas de autenticación, autorización y evaluación extrema: 17 de
  17 superadas.
- npm run security:password-resilience: superado con datos sintéticos.
- npm run audit:ci: sin vulnerabilidades fuera de la excepción RSC acotada.
- git diff --check: sin errores de espacios o parche.

## 12. Decisión y próximos pasos

**Desarrollo y demo local:** aprobado dentro del alcance evaluado.

**Producción:** no aprobada.

Orden recomendado antes de producción:

1. conectar el runtime PostgreSQL al servidor y ejecutar migración y
   restauración en preproducción;
2. integrar un proveedor de correo con plantillas, reintentos, trazabilidad y
   protección contra enumeración;
3. diseñar y aprobar el borrado y la retención con asesoramiento jurídico;
4. usar un almacén compartido para limitación, riesgo y trabajos;
5. validar el proxy real, TLS, IP de cliente y cabeceras reenviadas;
6. demostrar aislamiento multiempresa antes de compartir infraestructura;
7. ejecutar copias, restauración, monitorización y respuesta a incidentes;
8. repetir este estándar sobre una preproducción representativa.

La siguiente auditoría debe tratar los hallazgos abiertos como puertas de
entrada obligatorias y no repetir como superadas las superficies no evaluadas.

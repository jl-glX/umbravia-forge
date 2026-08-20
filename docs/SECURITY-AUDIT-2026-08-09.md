# Auditoría dirigida de correo y recuperación de cuentas — 9 de agosto de 2026

> [!NOTE]
> Evidencia histórica del alcance indicado. El estado vigente se mantiene en
> [SECURITY.md](./SECURITY.md), [FORGE-NOTIFY.md](./FORGE-NOTIFY.md) y
> [ACCOUNT-LIFECYCLE.md](./ACCOUNT-LIFECYCLE.md).

**Identificador:** UF-SEC-2026-08-09-MAIL-RECOVERY

**Estándar aplicado:** [Estándar interno de auditoría integral de seguridad](./SECURITY-AUDIT-STANDARD.md)

**Versión base evaluada:** `67172828d3da53541516f92e0f360a8d664bbf6e`

**Entorno:** Windows, Node.js 24.15.0, npm 11.12.1, API en `127.0.0.1`, bases temporales y cuentas sintéticas desechables

## 1. Resumen ejecutivo

Se evaluaron de forma dirigida los módulos de correo transaccional y
recuperación de cuentas, además de sus controles de autenticación, limitación,
sesiones, contraseña, cola cifrada y concurrencia.

La revalidación integral terminó correctamente con 65 archivos y 297 pruebas,
compilación de cliente y servidor, análisis estático y auditoría de
dependencias. La sonda de caja negra local superó 18 escenarios y la evaluación
de resistencia de contraseñas utilizó exclusivamente hashes sintéticos.

Se confirmó en laboratorio que:

- una solicitud no revela si el correo pertenece a una cuenta;
- solo las cuentas verificadas generan un desafío recuperable;
- los códigos caducan, tienen intentos limitados, se almacenan como hash scrypt
  con sal y solo pueden consumirse una vez;
- una recuperación válida cambia la contraseña, revoca sesiones y estado de
  autenticación sensible, rota el identificador público de soporte y conserva
  la revisión de seguridad;
- los mensajes se guardan con el cuerpo cifrado mediante AES-256-GCM y datos
  autenticados, se superseden al emitir un código nuevo y purgan el contenido al
  caducar o agotar reintentos;
- dos trabajadores que intentan procesar el mismo correo solo contabilizan un
  intento;
- la entrega por un MTA local, equivalente al contrato utilizado por Postfix,
  funciona en el laboratorio.

No se confirmó ninguna vulnerabilidad crítica o alta dentro del alcance local.
Se confirmó una mejora de endurecimiento de severidad baja: un cuerpo cifrado
corrupto se rechaza de forma segura, pero entra en el ciclo normal de reintentos
en vez de fallar de forma terminal. El limitador en memoria entre varias
instancias continúa como riesgo medio heredado.

La entrega real por Postfix, SPF, DKIM, DMARC, reputación, rebotes y recepción en
proveedores externos no se probaron desde este entorno. No se consideran
superados por inferencia.

**Resultado:** superada con excepciones para la implementación local de correo
y recuperación. La operación real de correo requiere una comprobación separada
en el servidor autorizado.

## 2. Ficha de alcance y reglas de intervención

| Campo                 | Valor                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Activo autorizado     | Repositorio local `C:\Proyectos\umbravia-forge`                                             |
| Superficie dinámica   | `127.0.0.1:3101`, API aislada y SMTP sintético local                                        |
| Modalidades           | Caja blanca, caja gris, caja negra local y BAS limitado                                     |
| Identidades           | Cuentas efímeras de socio, entrenador y administrador                                       |
| Datos                 | Correos reservados de ejemplo, códigos y contraseñas sintéticos                             |
| Acceso de herramienta | Trusted Access for Cyber individual de OpenAI, mostrado como activo por el responsable      |
| Carga máxima          | 64 lecturas de salud y 14 intentos de acceso acotados                                       |
| Parada                | Indisponibilidad, escritura fuera del directorio temporal o proceso no identificado         |
| Exclusiones           | Dominio público, servidor, Postfix real, DNS, proveedores externos, red, AD, Wi-Fi y físico |

No se utilizaron credenciales de producción, cuentas personales, hashes
filtrados ni códigos reales. Las cuentas sintéticas persistentes del servidor no
se modificaron ni eliminaron.

### 2.1. Constancia de Trusted Access for Cyber individual no empresarial

El responsable mostró el 9 de agosto de 2026 una confirmación de identidad
verificada y acceso individual no empresarial de confianza activo para trabajos de
ciberseguridad sobre sus propios proyectos o sistemas expresamente autorizados.
Su finalidad en este contexto es evitar interrupciones asociadas a la falta de
verificación al utilizar Codex. Esta constancia identifica la vía de acceso a la
herramienta utilizada durante la revisión; no equivale a una certificación del
proyecto, a acceso empresarial, a autorización automática para cualquier activo
ni a aprobación de todos los modelos especializados.

Cada prueba sigue necesitando autorización sobre los sistemas incluidos,
alcance escrito y cumplimiento del presente estándar. El acceso no se extiende
a terceros ni modifica las exclusiones de esta auditoría.

## 3. Matriz de pruebas

| Control                   | Resultado esperado                                  | Resultado observado                                                      | Estado                        |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Enumeración por correo    | Misma respuesta para cuenta conocida y desconocida  | Respuesta pública uniforme                                               | Superado                      |
| Cuenta no verificada      | No generar recuperación aprovechable                | No se crea desafío recuperable                                           | Superado                      |
| Almacenamiento del código | Sin código en claro                                 | Hash `sal:derivado` con scrypt                                           | Superado                      |
| Caducidad                 | Rechazar código vencido sin cambiar contraseña      | Rechazado y contraseña preservada                                        | Superado                      |
| Intentos fallidos         | Bloqueo tras el máximo                              | Cinco intentos y consumo seguro                                          | Superado                      |
| Repetición                | Un código solo puede consumirse una vez             | Un ganador concurrente; repetición rechazada                             | Superado                      |
| Revocación                | Invalidar sesiones y desafíos sensibles             | Sesiones, autenticación y passkeys pendientes revocados                  | Superado                      |
| Limitación                | Frenar abuso sin depender del correo consultado     | Cuarta solicitud rechazada con límite de tres en la prueba               | Superado en una instancia     |
| Cifrado de cola           | Cuerpo y código no legibles en almacenamiento       | Sobre `v1` AES-256-GCM sin datos del cuerpo en claro                     | Superado                      |
| Manipulación de cola      | Rechazo sin fuga de contenido                       | Rechazo genérico `delivery_processing_failed`                            | Superado con mejora pendiente |
| Código reemplazado        | Invalidar mensajes antiguos                         | Estado `superseded` y cuerpo purgado                                     | Superado                      |
| Mensaje caducado          | No intentar entregar y purgar                       | Estado `failed`, cuerpo vacío                                            | Superado                      |
| Fallo SMTP definitivo     | Detener y purgar al agotar reintentos               | Quinto intento terminal y cuerpo vacío                                   | Superado                      |
| Carrera de trabajadores   | Una única reclamación por mensaje                   | Un solo intento registrado                                               | Superado                      |
| SMTP local                | Entregar mediante MTA sin autenticación local       | Mensaje recibido por servidor SMTP sintético                             | Superado en laboratorio       |
| SMTP remoto               | Exigir TLS y credenciales completas                 | Configuración insegura rechazada                                         | Superado por caja blanca      |
| Plantillas                | Escapar contenido proporcionado por el usuario      | Nombre y contenido sin inyección de marcado                              | Superado                      |
| Contraseñas               | bcrypt 12 y rechazo previo de más de 72 bytes       | Política aplicada y prueba sintética superada                            | Superado                      |
| Sesión y roles            | Sin escalada, acceso horizontal o repetición        | Escenarios de socio, entrenador y administrador bloqueados correctamente | Superado                      |
| Caja negra API            | Errores defensivos, CORS, límites y métodos seguros | 18 de 18 escenarios superados                                            | Superado localmente           |

## 4. Pruebas ofensivas limitadas

La simulación defensiva incluyó:

- acceso directo a rutas de otro rol;
- acceso horizontal a reservas y clases ajenas;
- cookie de sesión manipulada y repetida tras cerrar sesión;
- petición sensible desde un origen hostil;
- asignación masiva de rol, JSON malformado e entradas de inyección;
- rotación artificial de `X-Forwarded-For` para intentar eludir el límite;
- repetición y consumo concurrente de un código de recuperación;
- manipulación del tag de autenticación del cuerpo cifrado;
- carrera entre dos trabajadores sobre el mismo mensaje;
- diccionario acotado contra hashes creados expresamente para la prueba.

No se realizó crackeo de credenciales reales, exfiltración, persistencia,
phishing, movimiento lateral ni presión destructiva.

## 5. Evidencias reproducibles

```bash
npm run ci:validate
npm run security:probe
npm run security:password-resilience
npx vitest run server/services/account-recovery.security.test.ts server/services/email-delivery-queue.security.test.ts
```

Resultados observados:

- revalidación integral: 65 archivos y 297 pruebas superadas;
- revalidación dirigida de cola, despliegue y recursos de Vitest: 4 archivos y
  18 pruebas superadas;
- sonda local: 18 de 18 escenarios superados;
- hash de contraseñas: bcrypt coste 12, sin hashes ni contraseñas reales;
- dependencias: sin vulnerabilidades fuera de excepciones explícitas y acotadas;
- compilación: cliente Vite y servidor TypeScript completados.

## 6. Hallazgos y riesgos residuales

### UF-2026-10 — Reintento de un cuerpo cifrado irrecuperable

**Severidad:** baja

**Estado:** corregido

Cuando el tag AES-GCM se altera, el formato no es válido o la clave activa no
puede descifrar un mensaje, la entrega falla de forma segura y no revela el
contenido. La explotación remota no quedó demostrada: requiere corrupción de
almacenamiento, acceso de escritura a la base o una rotación incompatible.

Los errores de autenticidad, versión, formato o clave se distinguen de los
errores SMTP. Se marcan como terminales en el primer intento, se purga el cuerpo
cifrado y se emite un evento de seguridad saneado sin destinatario ni contenido.
La rotación multiclave continúa delimitada como una ampliación futura.

### UF-2026-06 — Limitación no coordinada entre instancias

**Severidad:** media

**Estado:** heredado, abierto

La limitación funciona en la instancia evaluada y resiste cabeceras reenviadas
arbitrarias en local. El estado continúa en memoria y no coordina varios
procesos o servidores. Antes de escalar horizontalmente debe migrarse a un
almacén compartido y validar la procedencia de la IP real en toda la cadena
Cloudflare→Caddy→Node.

## 7. Comparación con la auditoría del 5 de agosto

| Área            | 5 de agosto                       | 9 de agosto                                                         |
| --------------- | --------------------------------- | ------------------------------------------------------------------- |
| Validación      | 49 archivos, 195 pruebas          | 65 archivos, 297 pruebas                                            |
| Correo          | Desafío generado pero sin entrega | Cola cifrada, MTA local y reintentos funcionales                    |
| Recuperación    | Código y política presentes       | Caducidad, uso único, carreras y revocación verificadas             |
| SMTP            | Proveedor inexistente             | Contrato SMTP local/STARTTLS implementado; Postfix real no evaluado |
| Limitación      | En memoria                        | Funcional localmente; riesgo multiinstancia permanece               |
| Infraestructura | No evaluada                       | Sigue fuera de esta ejecución local                                 |

El hallazgo anterior UF-2026-04 deja de describir una ausencia total de entrega:
la infraestructura de aplicación ya está implementada y probada con un MTA
local. No puede cerrarse para producción hasta verificar el Postfix real, la
entrega externa y los registros del dominio.

## 8. Superficies no evaluadas

No se consideran superadas:

- envío y recepción reales mediante el Postfix del servidor;
- SPF, DKIM, DMARC, PTR/rDNS, reputación y gestión de rebotes;
- disponibilidad de los puertos y colas del host de producción;
- Cloudflare, Caddy, TLS y reconstrucción de IP en el entorno público actual;
- PostgreSQL, copias y restauración bajo este flujo concreto;
- red interna, Active Directory, Wi-Fi y seguridad física;
- ingeniería social, Red Team completo y crackeo agresivo real.

## 9. Criterio de cierre

La implementación local de correo y recuperación se considera funcional y
estable dentro del alcance. Para cerrar el flujo de producción faltan una prueba
controlada de entrega real, la comprobación de autenticación del dominio, la
observación de rebotes y la resolución o aceptación formal de UF-2026-06.

# Auditoría integral de UMF Support — 21 de agosto de 2026

## Alcance y método

Esta auditoría se realizó antes de la puerta completa de validación sobre el
diff de UMF Support, su correo corporativo, la política de privacidad y el
paquete de prueba para Windows. Se contrastaron rutas, servicios, autorización,
tablas SQLite, migración PostgreSQL, interfaz, catálogos, documentación y
empaquetado. Las pruebas se ejecutaron con datos sintéticos en entornos
temporales.

No se inspeccionaron ni modificaron secretos, DNS, buzones, servidores o bases
vivas. Por tanto, esta auditoría prueba propiedades del repositorio y no es una
validación de producción.

## Resultado ejecutivo

La base de UMF Support queda preparada para una validación real controlada,
pero no para anunciar un canal público operativo todavía.

| Área                  | Resultado del repositorio                                                                  | Límite operativo                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Separación de soporte | UMF Support usa autoridad, tablas, rutas e interfaz distintas de Forge Support             | Requiere validar el esquema PostgreSQL del entorno autorizado                     |
| Acceso corporativo    | Operador activo como dirección; resto mediante aprobación y código de un solo uso          | Hay que comprobar la cuenta real de dirección y su MFA tras despliegue            |
| Tickets y paneles     | Cola, detalle, asignación, estados, prioridades, categorías y notas internas               | Falta prueba humana de uso y procedimiento de atención                            |
| Correo                | Entrada firmada, alias ligado a ticket/remitente, deduplicación, bandejas y cola de salida | Faltan DNS, Worker, SMTP, rebotes y entrega de extremo a extremo                  |
| Privacidad            | Política mantenida, ruta pública y categoría específica de derechos                        | Faltan datos identificativos, contacto validado, conservación y revisión jurídica |
| Windows               | ZIP reproducible con lanzadores separados y hashes                                         | Falta firma, SmartScreen y prueba en equipo limpio                                |

## Fronteras de autorización

- `/api/support` continúa resolviendo una membresía de centro y nunca consulta
  las tablas de UMF Support.
- `/api/umf-support` vuelve a comprobar en cada operación un operador activo o
  una membresía corporativa activa.
- El rol global `admin` y la administración de un centro no conceden acceso al
  portal corporativo.
- Una cuenta de UMF Support no obtiene `facilityId` ni permisos de tenant por
  su membresía corporativa.
- Aprobar, rechazar o cambiar personal requiere dirección y verificación humana
  de la sesión.

Las pruebas dirigidas demostraron que un administrador exclusivamente de
centro no puede iniciar sesión en el portal `support` y que los tickets
corporativos no crean filas en `supportTickets`.

## Alta y autenticación

- La solicitud pública devuelve una respuesta genérica y no confirma si un
  correo o una solicitud ya existen.
- El código tiene seis cifras, 24 horas de vigencia, cinco intentos como máximo
  y se guarda con `scrypt` y sal aleatoria, nunca en claro.
- La activación exige CAPTCHA, correo, código, contraseña segura, país ISO de
  dos letras y aceptación explícita de términos y privacidad.
- El código se consume de forma transaccional antes de incorporar al agente y
  no puede reutilizarse.
- El inicio de sesión reutiliza Argon2id, sesiones revocables, cookies seguras,
  límites, origen confiable, CAPTCHA y MFA de Umbravia Forge.
- Las solicitudes, revisiones, fallos de activación, altas y cambios de equipo
  producen eventos de seguridad sin almacenar el correo en claro en sus
  metadatos.

No se fuerza todavía MFA a todo agente corporativo. La cuenta lo admite y la
interfaz completa el segundo factor, pero su obligatoriedad necesita una
decisión operativa que no bloquee la incorporación inicial.

## Contenido privado y correo

- Los cuerpos se protegen con un contexto criptográfico exclusivo
  `umf-support:message:*`.
- En un perfil de producción las lecturas y escrituras fallan cerradas si el
  cifrado de contenido privado no está habilitado.
- Abrir un ticket o una bandeja registra acceso a contenido privado.
- El Worker firma los bytes exactos; el servidor limita la antigüedad de la
  firma y rechaza adjuntos, mensajes automáticos y cargas fuera de contrato.
- El alias de respuesta liga identificador público y correo solicitante con un
  secreto corporativo independiente. Un remitente distinto fue rechazado en
  la prueba.
- El hash del `Message-ID` impide que un reintento cree mensajes duplicados.
- Los asuntos inequívocos de derechos se clasifican como privacidad, pero la
  procedencia del derecho siempre queda sometida a revisión humana.

El asunto, el identificador, el remitente y otros metadatos necesarios para la
cola permanecen visibles para la base autorizada. Deben entrar en la política
de acceso, conservación, copias y bloqueo del entorno real.

## Esquema y portabilidad

La auditoría detectó que las cuatro tablas corporativas estaban declaradas en
SQLite y PostgreSQL, pero faltaban en el inventario de migración portable. Se
incorporaron a `migrationTableGroups.support` y a la exclusión predeterminada
de datos sensibles. La prueba de paridad volvió a quedar favorable.

Las migraciones versionadas no autorizan una copia automática de solicitudes,
personal, tickets o mensajes. Cualquier traslado necesita inventario de la
base viva, destino vacío o controlado, copia restaurable y aprobación expresa.

## Interfaz y distribución

- La aplicación usa rutas sin la navegación del tenant y una identidad visual
  corporativa sobria.
- Los campos de alta, activación, MFA, ticket, categoría, estado, prioridad y
  asignación tienen etiqueta o nombre accesible asociado.
- Español, inglés y alemán contienen el catálogo completo. `de-CH` hereda el
  alemán y mantiene únicamente diferencias regionales; la prueba se corrigió
  porque antes exigía duplicar todas las claves en contra de la regla vigente.
- El ZIP instala lanzadores web separados, no eleva privilegios ni incorpora
  credenciales. El test controlado resolvió Edge y creó un manifiesto local de
  UMF Support apuntando a `/umf-support/access`.

## Correcciones realizadas durante la auditoría

1. Se eliminó la aceptación implícita de términos y privacidad.
2. Se completó MFA en el acceso propio de UMF Support.
3. Se añadió CAPTCHA a la activación y reinicio del reto después de cada uso.
4. Se añadió categoría y tratamiento de solicitudes de privacidad.
5. Se protegieron las mutaciones de dirección con verificación humana.
6. Se añadió asignación de tickets y asociación accesible de etiquetas.
7. Se validó la configuración corporativa de entrada antes de presentarla como
   disponible.
8. Se añadieron eventos de seguridad y fallo cerrado del cifrado corporativo en
   producción.
9. Se completó el inventario de migración portable.
10. Se alineó la prueba de `de-CH` con la herencia regional real.
11. Se cerró la combinación de desinstalación con rutas de prueba arbitrarias,
    se acotó el borrado al directorio del producto y se fijaron metadatos ZIP
    deterministas.
12. Se saneó la identidad visual suministrada, se comprobó su alfa real y se
    separó el logotipo completo de la variante sin letras usada por el paquete
    y el acceso de Windows.

## Evidencia de validación del repositorio

- tipos de cliente, servidor y Worker: favorables;
- API corporativa: alta, aislamiento, tickets, correo y deduplicación;
- seguridad del alias corporativo: secreto fuerte y vínculo a remitente;
- sintaxis y cobertura de migraciones PostgreSQL;
- inventario portable de tablas;
- catálogos efectivos y marcadores de traducción;
- generación del ZIP y prueba `-TestMode` de UMF Support.

La puerta completa `npm run ci:validate` terminó favorablemente el 21 de agosto
de 2026. Incluyó portabilidad, formato, lint, tipos de cliente, servidor y
Worker, 111 archivos de prueba con 545 pruebas favorables y una omitida de
forma deliberada, las tres compilaciones, la generación del ZIP y la auditoría
de dependencias sin vulnerabilidades fuera de las excepciones mantenidas.

La preparación independiente de despliegue también terminó favorablemente:
compiló cliente, servidor y Worker, generó `.deployment-package` y auditó sus
297 archivos. Para esa compilación local se usó únicamente el valor público de
CAPTCHA reservado a CI; no es una configuración válida para desplegar.

`git diff --check`, la revisión final del diff y GitHub Actions se ejecutan
después de cerrar este documento y deben quedar registrados en el relevo y en
el historial publicado.

## Paso siguiente autorizado para validación humana

Después del despliegue controlado:

1. comprobar que la cuenta del operador entra como dirección y activar MFA;
2. aprobar una cuenta sintética, recibir el código y consumirlo una sola vez;
3. instalar el ZIP en un equipo Windows estándar y comprobar sesión y cierre;
4. configurar un buzón no anunciado y el Worker corporativo con secretos
   nuevos fuera de Git;
5. enviar desde correo externo, responder, provocar un duplicado y un rebote;
6. revisar PostgreSQL, logs saneados, eventos, cola y conservación;
7. solo después publicar el contacto de privacidad y completar la política.

# Guía de trabajo para agentes

Este archivo contiene reglas duraderas para cualquier agente que trabaje en
Umbravia Forge. Debe mantenerse actualizado cuando cambien el flujo de trabajo,
las fronteras de seguridad o la organización documental.

## Fuente de verdad

- El código, las migraciones y las pruebas del commit activo son la fuente de
  verdad sobre lo que está implementado.
- La documentación vigente se indexa en `docs/README.md`. Las auditorías con
  fecha son evidencias históricas y no sustituyen a los documentos mantenidos.
- Una capacidad implementada localmente no se debe presentar como validada en
  producción sin comprobar el entorno autorizado, su esquema, sus servicios y
  el flujo de extremo a extremo.

## Seguridad y operaciones

- No eliminar, sustituir, generar ni rotar secretos, claves, certificados,
  archivos de entorno o configuración de proveedores sin autorización expresa.
- No modificar archivos de seguridad para simplificar una tarea no relacionada.
  Si una corrección de seguridad es imprescindible, explicar antes su alcance,
  impacto y recuperación.
- Las inspecciones de producción son de solo lectura salvo autorización
  explícita. No confundir scripts, plantillas o historial con estado operativo
  verificado.
- No afirmar que copias, restauraciones, correo, DNS, temporizadores o
  despliegues están listos basándose únicamente en el repositorio.
- No incorporar datos reales, credenciales, bases locales ni historial
  operativo privado al repositorio público.

## Desarrollo

- Preservar los cambios del usuario y revisar el estado de Git antes de editar.
- Mantener autorización y aislamiento multi-tenant en el servidor; ocultar una
  acción en la interfaz no es un control de seguridad.
- No convertir la primera cuenta corporativa registrada en jefatura por orden
  de llegada. El bootstrap inicial solo puede usar la huella externa del correo
  designado o la herramienta local explícita, y debe conservar separado el
  realm comercial.
- Validar entradas externas y mantener las reglas de negocio fuera de los
  componentes React.
- Añadir texto visible a los catálogos completos `es`, `en`, `de`, `fr`, `it`,
  `gl`, `ca`, `eu` y `oc-aranes`; usar `de-CH` y `ca-valencia` solo para
  diferencias regionales respecto a `de` y `ca`. Mantener origen y nivel de
  revisión en `docs/LOCALIZATION.md`. No traducir contenido introducido por
  usuarios.
- Usar extensiones `.js` en importaciones relativas del servidor ESM.
- TypeScript 7 nativo compila el proyecto. TypeScript 6 permanece únicamente
  como API compatible con ESLint hasta que deje de ser necesario.
- Añadir o actualizar pruebas para cambios de comportamiento, especialmente en
  autenticación, autorización, reservas, aislamiento y migraciones.

## Documentación

- Auditar las afirmaciones contra código, migraciones y pruebas antes de
  actualizarlas.
- Actualizar `docs/README.md`, el documento vigente afectado y, cuando cambie la
  continuidad operativa, `docs/OPERATIONAL-HANDOFF.md`.
- Revisar y actualizar `docs/OPERATIONAL-HANDOFF.md` periódicamente en hitos
  relevantes, antes de un relevo de trabajo y antes de publicar cambios que
  alteren arquitectura, operación, seguridad, datos o integraciones externas.
  Evitar actualizaciones mecánicas: cada revisión debe reflejar estado,
  validación, riesgos y pendientes reales.
- No reescribir una auditoría fechada como si describiera el presente. Añadir
  una nota de continuidad o remitir al documento vigente.
- Mantener enlaces relativos válidos y distinguir entre: implementado y
  probado en el repositorio; preparado pero desactivado; pendiente de prueba
  operativa; y trabajo futuro.

## Validación y Git

- Ejecutar `npm run ci:validate` como puerta completa antes de entregar cambios
  relevantes. En Windows, detener antes cualquier sesión `test:watch`.
- Ejecutar además `git diff --check` y revisar el diff final sin incluir cambios
  ajenos.
- Trabajar en una rama `codex/` cuando el punto de partida sea `main`.
- Escribir commits descriptivos en español. Publicar, abrir una solicitud de
  cambios o realizar acciones en GitHub solo cuando estén autorizadas.

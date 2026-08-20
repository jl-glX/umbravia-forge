# Umbravia Forge — cierre técnico de los puntos comerciales 22–38

**Estado:** base funcional integrada, auditada y verificable
**Fecha:** 4 de agosto de 2026

> [!NOTE]
> Este documento conserva el cierre histórico de esos puntos. Para el estado
> actual de aislamiento, cifrado, soporte y analítica deben consultarse los
> documentos vigentes del [índice de documentación](./README.md).

Este documento traslada los puntos 22–38 del borrador comercial maestro al
producto Umbravia Forge. No sustituye asesoramiento jurídico, una política de
moderación aprobada ni las decisiones de producto que el propio borrador dejó
abiertas.

## Cobertura funcional

| Punto                               | Implementación actual                                                                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22. Facturación administrativa      | Buscador por identidad, teléfono, correo, ID público y nombre de usuario; vinculación con instantánea histórica; filtros de API; balances por moneda; documentos libres, archivo, impresión y exportación mediante impresión/PDF del navegador. La plataforma no decide impuestos. |
| 23. Chat de clase                   | Canales con alcance `class`, acceso limitado a reservas/lista de espera, entrenador asignado y administración; respuestas y estados de canal.                                                                                                                                      |
| 24. Justificaciones privadas        | Mensajes `private_justification` exclusivos de canales de clase; para socios solo son visibles sus propias justificaciones. Entrenador autorizado y administración pueden revisarlas.                                                                                              |
| 25. Chat general                    | Canales de centro, mensajes, respuestas, canales de avisos iniciales y transiciones protegidas entre activo, solo lectura, suspendido y cerrado. La base limita texto a 4.000 caracteres.                                                                                          |
| 26. Comunidades entre centros       | Solicitudes administrativas temporales o permanentes, espacios compartidos declarados y ciclo de estados. No se comparte ninguna base de socios, credencial, facturación o dato privado.                                                                                           |
| 27. Contactos internos              | Descubrimiento por nombre de usuario y relación bilateral con solicitud, aceptación, rechazo, bloqueo o retirada.                                                                                                                                                                  |
| 28. Grupos y comunidades personales | Canales con alcance `community`, independientes de los vínculos institucionales entre centros.                                                                                                                                                                                     |
| 29. Identidad social                | Nombre de usuario único, biografía, avatar de cuenta, fecha de nacimiento separada y nombre real opcional.                                                                                                                                                                         |
| 30. Privacidad granular             | Visibilidad por campo: pública, contactos, centro, comunidades seleccionadas, personal autorizado o privada.                                                                                                                                                                       |
| 31. Edad y nacimiento               | Fecha administrativa almacenada de forma separada de la configuración de visibilidad social.                                                                                                                                                                                       |
| 32. Control parental                | Relación tutor-menor revisada por administración, configuración acotada, estados explícitos y visibilidad para tutor y menor. No existe lectura automática de conversaciones.                                                                                                      |
| 33. Moderación                      | Casos, medidas proporcionales, estados, duración, motivo, responsable y trazabilidad.                                                                                                                                                                                              |
| 34. Denuncias y reclamaciones       | Alta de casos, vinculación autorizada a cuenta o mensaje, pruebas referenciadas y acotadas, urgencia, resolución, apelación única abierta y resolución administrativa de la apelación.                                                                                             |
| 35. Principios institucionales      | Neutralidad, reciprocidad y moderación basada en conducta disponibles desde la API y visibles en Comunidad.                                                                                                                                                                        |
| 36. Estados adicionales             | Estados compartidos tipados para vínculos de centros, contactos, comunidades, control parental y moderación.                                                                                                                                                                       |
| 37. Decisiones pendientes           | Se mantienen en el registro siguiente; no se han convertido en reglas arbitrarias.                                                                                                                                                                                                 |
| 38. Resumen ejecutivo               | Consolidado en esta documentación y en la arquitectura del producto.                                                                                                                                                                                                               |

## Límites deliberados de esta versión

- Los adjuntos se representan como referencias de evidencia; todavía no existe
  almacenamiento de archivos, antivirus ni procesamiento de vídeo. Por eso la
  interfaz no promete cargas que no pueda proteger.
- La relación entre centros usa una solicitud local y el nombre del destino.
  La aceptación remota real necesita antes aislamiento multiempresa y una
  instalación o servicio federado identificable.
- El control parental exige revisión administrativa. La verificación jurídica
  de tutores y edades necesita una política aprobada antes de automatizarse.
  Esta versión conserva una configuración acotada y trazable, pero no aplica
  restricciones automáticas de mensajería sin esa política.
- La moderación “central” tiene el modelo de datos y la trazabilidad, pero no
  pretende simular un equipo humano que todavía no existe.
- Los chats no implementan cifrado de extremo a extremo. HTTPS y el cifrado del
  almacenamiento de producción son controles distintos y deben documentarse en
  el despliegue real.

## Resultado de la auditoría técnica

La revisión negativa posterior a la implementación verificó y reforzó:

- aislamiento de comunidades personales incluso cuando distintos propietarios
  eligen el mismo nombre;
- visibilidad de biografía, avatar y nombre real según privacidad y relación de
  contacto aceptada;
- fechas de nacimiento reales y no futuras;
- transiciones bilaterales de contactos y estados administrables de canales;
- coincidencia obligatoria entre una denuncia vinculada a un mensaje, su autor
  y la cuenta sometida a una medida;
- duraciones numéricas, evidencias textuales acotadas y una única apelación
  abierta por caso;
- filtros administrativos de facturación que fallan de forma cerrada ante
  estados, monedas, conceptos o rangos temporales inválidos;
- restricciones equivalentes e índices operativos en SQLite y PostgreSQL.

## Registro de decisiones del punto 37

Las fórmulas exactas de reputación, penalizaciones, vencimiento de promociones,
formatos y numeración fiscal, límites de almacenamiento, conversión comercial,
archivos multimedia, conservación de mensajes, franjas de edad, verificación de
tutores y tiempos de moderación siguen requiriendo una decisión de producto,
operaciones o asesoramiento jurídico.

Hasta que se aprueben:

1. las reglas existentes serán configurables y explicables;
2. no se inferirán impuestos ni obligaciones legales;
3. no se expondrán datos privados por defecto;
4. no se automatizarán sanciones graves ni acceso excepcional a mensajes;
5. toda ampliación conservará trazabilidad y posibilidad de revisión.

## Resumen ejecutivo actualizado

Umbravia Forge es una plataforma modular para centros deportivos con prueba
comercial autoservicio, reservas adaptables, gestión de incertidumbre de
asistencia, reputación recuperable, listas de espera dinámicas, contenido de
sesión, facturación administrativa, comunidad, identidad privada y moderación
trazable. El producto mantiene separadas la operación del centro, la identidad
social, los datos sensibles y las decisiones legales que requieren validación
humana.

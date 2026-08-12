# Reglas de trabajo de Umbravia Forge

Estas reglas se aplican a cualquier tarea realizada en este repositorio.

## Verificación antes de modificar

- Comprobar el estado vivo del repositorio y distinguirlo de documentación o
  historiales anteriores.
- No duplicar documentación de contexto ni reglas equivalentes ya existentes.
- Mantener fuera de Git la información operativa privada, credenciales,
  direcciones de infraestructura, tickets privados y valores de claves.

## Límites de seguridad y producción

- No modificar secretos, claves, archivos de seguridad, migraciones,
  temporizadores ni unidades de servicio salvo que una tarea explícita y
  acotada lo autorice.
- No declarar una versión desplegada ni producción estable sin comprobar el
  servicio activo, la release efectiva y las validaciones correspondientes.
- Identificar la función y las dependencias de cada temporizador antes de
  proponer su retirada o sustitución.

## Validación y publicación

- Ejecutar `npm run ci:validate` como validación integral local antes de
  publicar cambios, además de las pruebas específicas necesarias durante el
  desarrollo.
- Evaluar la sesión y el acceso remoto de Git antes de preparar la publicación.
- Trabajar directamente sobre `main` cuando así lo solicite el propietario del
  repositorio; no crear una pull request por defecto.
- Un `push` aceptado no completa una tarea. Después de publicar hay que esperar
  la ejecución correspondiente de GitHub Actions y comprobar que termina con
  resultado favorable.
- Si GitHub Actions falla o sigue pendiente, la tarea continúa abierta y debe
  diagnosticarse o comunicarse con precisión.

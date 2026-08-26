# Portabilidad y ejecución en varios nodos

Estado vigente: el artefacto es reproducible y puede trasladarse a otro servidor
Linux, pero la aplicación **no debe declararse todavía preparada para
activo-activo**. La siguiente matriz separa lo portable de lo que aún depende de
un proceso o disco concretos.

| Estado                  | Componente                                                | Situación actual                                          | Requisito para varios nodos                                                              |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| preparado               | datos de negocio y sesiones                               | PostgreSQL en `staging` y `production`                    | PostgreSQL externo con TLS, copias y restauración probada                                |
| preparado               | aplicación y estáticos                                    | build reproducible; el proceso no conserva la sesión HTTP | misma release y configuración no secreta en todos los nodos                              |
| preparado con rol único | tareas de mantenimiento y ciclo de vida                   | temporizadores dentro del proceso                         | `BACKGROUND_JOBS_ENABLED=true` solo en un nodo designado y `false` en las réplicas web   |
| bloqueante              | límites de peticiones                                     | contadores en memoria de cada proceso                     | almacén compartido y tolerante a fallos antes de activo-activo                           |
| bloqueante              | adjuntos de comunidad, E2EE, soporte y correo corporativo | directorios locales                                       | almacenamiento de objetos externo, cifrado, aislamiento tenant y migración verificada    |
| bloqueante              | entornos administrados y SQLite auxiliar                  | raíz local `ENVIRONMENT_DATA_ROOT`                        | servicio o volumen gestionado fuera de las réplicas web                                  |
| bloqueante              | coordinación de gestores                                  | colas y señales de coordinación en memoria                | bloqueo/cola distribuida o separación en un único worker                                 |
| operativo               | correo, DNS, Stripe y Cloudflare                          | configuración externa                                     | reproducir webhooks, allowlists, remitentes, DNS y secretos sin copiarlos al repositorio |

## Rol de trabajos programados

`BACKGROUND_JOBS_ENABLED` vale `true` por defecto para conservar la topología de
un solo servidor. En una futura topología con varias instancias debe existir un
único nodo de trabajos:

```dotenv
# Nodo designado para mantenimiento
BACKGROUND_JOBS_ENABLED=true

# Cada réplica web adicional
BACKGROUND_JOBS_ENABLED=false
```

Esta separación evita duplicar revisiones de ciclo de vida y tareas del gestor,
pero no elimina los bloqueantes de almacenamiento, rate limiting y coordinación.

## Migración reproducible A → B

Una prueba de portabilidad válida requiere:

1. construir una release desde el mismo commit y verificar sus artefactos;
2. provisionar PostgreSQL externo y restaurar una copia cifrada comprobada;
3. copiar únicamente configuración autorizada y secretos mediante el mecanismo
   operativo, nunca mediante Git;
4. migrar y comprobar los directorios locales mientras sigan existiendo;
5. reproducir proxy, TLS, DNS, correo y webhooks externos;
6. ejecutar readiness, smoke tests, aislamiento A/B y restauración;
7. cambiar tráfico con reversión documentada;
8. observar errores, colas, correo, pagos y tareas programadas antes de retirar A.

Hasta externalizar los componentes marcados como bloqueantes, una segunda
máquina sirve para recuperación o sustitución controlada, no como réplica
activo-activo intercambiable.

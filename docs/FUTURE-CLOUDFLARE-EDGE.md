# Cloudflare Edge delante de Umbravia Forge

Estado: **base activada; endurecimiento del origen pendiente**.

Umbravia Forge ya dispone del dominio propio `umbraviaforge.com`, administrado
en Cloudflare DNS. El despliegue actual usa Caddy y Node en la interfaz local;
la activación de nuevas funciones de Edge debe seguir realizándose como una
fase independiente, verificable y reversible.

## Estado comprobado el 8 de agosto de 2026

- los registros públicos del dominio están proxificados por Cloudflare;
- el modo SSL/TLS es `Completo (estricto)`;
- las peticiones HTTP terminan redirigidas a HTTPS;
- Turnstile autoriza `umbraviaforge.com` y `www.umbraviaforge.com`;
- una regla WAF personalizada bloquea búsquedas de archivos sensibles y rutas
  de escaneo conocidas antes de alcanzar el origen;
- Express marca la API y el HTML con `Cache-Control: no-store`;
- solo los recursos compilados y versionados de `/assets/` reciben una política
  larga e inmutable de caché.

## Objetivo

Añadir una capa exterior que absorba tráfico abusivo y aplique reglas WAF,
limitación y observación antes de que las peticiones alcancen el servidor.

```text
Internet -> Cloudflare WAF/CDN -> Caddy :443 -> Node 127.0.0.1:3001
                                             -> PostgreSQL localhost
```

## Requisitos previos

- dominio propio bajo control de Umbravia;
- staging estable con el mismo commit que producción;
- copias y restauración de PostgreSQL comprobadas;
- monitorización del origen y de Caddy;
- inventario de rutas que pueden almacenarse en caché y rutas que nunca deben
  almacenarse;
- revisión de privacidad, transferencias y conservación de logs.

## Trabajo previsto

1. Mantener TLS estricto de extremo a extremo y verificar la renovación del
   certificado del origen.
2. Evaluar en observación las reglas WAF administradas antes de ampliar los
   bloqueos activos.
3. Mantener la regla explícita para rutas de escaneo (`.env`, `.git`,
   WordPress, phpMyAdmin y equivalentes).
4. Aplicar límites distintos a login, registro, recuperación, antiabuso y API
   general, manteniendo también los límites internos de Express.
5. Mantener el desafío antiabuso propio y su validación en el servidor; el WAF
   no sustituye esa comprobación.
6. Verificar periódicamente que solo se cachean recursos estáticos versionados.
   No cachear API, HTML autenticado, cookies, datos de cuenta ni respuestas de
   error sensibles.
7. Configurar Caddy y Express para reconstruir la IP real solo desde proxies de
   Cloudflare autorizados. El número actual de saltos de confianza tendrá que
   revisarse: Cloudflare añadirá otra capa delante de Caddy.
8. Restringir el firewall del origen a las redes publicadas por Cloudflare, sin
   perder un acceso administrativo y una vía de reversión probados.
9. Crear alertas sobre bloqueos, picos de 401/403/429/5xx, fallos antiabuso
   y cambios de disponibilidad del origen.

## Criterios de aceptación

- no es posible alcanzar el origen público evitando Cloudflare;
- Caddy y Node conservan la IP real sin confiar en cabeceras arbitrarias;
- las rutas de autenticación no se almacenan en caché;
- las reglas no bloquean WebAuthn, los desafíos antiabuso ni operaciones legítimas;
- existe una prueba de carga moderada y una prueba de reglas en staging;
- el cambio se puede revertir a DNS directo de forma documentada;
- los logs no contienen contraseñas, tokens, cookies ni secretos.

## Decisiones que se tomarán entonces

- plan de Cloudflare y funciones disponibles en ese momento;
- certificado público de Caddy, Origin CA o desafío DNS;
- reglas WAF exactas y umbrales basados en tráfico medido;
- duración y ubicación de logs;
- estrategia de caché y purga;
- continuidad si Cloudflare o el origen fallan.

No deben fijarse ahora rangos IP, precios ni nombres de reglas administradas:
son datos cambiantes y se verificarán en la documentación oficial al ejecutar
esta fase.

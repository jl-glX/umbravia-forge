# Paquete histórico de prueba de aplicaciones web para Windows

> **UMF Support queda fuera de este paquete.** No se genera ni conserva ningún
> instalador, desinstalador, icono o modalidad del script común para el panel
> corporativo. El ZIP se limita a Umbravia Forge y no demuestra una distribución
> de escritorio autorizada.

## Alcance

El repositorio prepara un ZIP de prueba para instalar el acceso a Umbravia
Forge en Windows. El paquete no convierte la plataforma en una aplicación
nativa: utiliza el modo aplicación de Microsoft Edge y abre siempre el servicio
HTTPS publicado.

```text
npm run package:windows-web-apps
```

El resultado local, excluido de Git, es:

```text
.artifacts/umbravia-forge-windows-web-apps-test.zip
.artifacts/umbravia-forge-windows-web-apps-test.zip.sha256
```

El ZIP contiene el instalador común limitado a Umbravia Forge, sus envoltorios
de instalación y desinstalación, instrucciones y hashes SHA-256 de cada archivo.
La aplicación usa el icono del runtime. El paquete no contiene el servidor, una
base de datos, secretos, cookies, contraseñas ni datos reales.

## Seguridad reutilizada

El lanzador no implementa una autenticación paralela. Abre el origen web
canónico y reutiliza sus controles de servidor:

- cookies de sesión `HttpOnly`, seguras en producción y revocables;
- autorización independiente de UMF Support en cada petición;
- MFA de la cuenta y límites de intentos;
- CAPTCHA y comprobación de origen en mutaciones;
- cifrado y trazabilidad de contenido privado en el servidor;
- políticas del navegador para almacenamiento, TLS y actualizaciones.

El instalador opera solo en el perfil actual y no solicita elevación. Crea
accesos en el escritorio y el menú Inicio y un manifiesto local sin
credenciales. La desinstalación elimina únicamente esos accesos y el
manifiesto; no modifica la cuenta o los datos remotos. Una operación real no
acepta una ruta de instalación personalizada, y la desinstalación comprueba que
su destino permanezca dentro del directorio propio del producto. Las rutas
personalizadas solo existen en `TestMode`, que no permite desinstalar.

Los envoltorios CMD abren exclusivamente el script incluido con una excepción
de política limitada a ese proceso. Este mecanismo permite probar el flujo,
pero el paquete todavía no está firmado. Antes de distribuirlo como estable se
necesita firma de código, publicación mediante HTTPS, hash verificable y una
prueba en un equipo limpio.

El instalador conserva la consola visible hasta que la persona confirma el
resultado y abre la aplicación después de crear los accesos. Si el CMD se
ejecuta sin haber extraído el resto del ZIP, muestran una instrucción explícita
en lugar de cerrar silenciosamente. Un fallo al abrir Edge no revierte una
instalación ya completada: el acceso directo permanece disponible.

## Prueba controlada

El instalador admite `-TestMode` y un directorio explícito para validar la
resolución del runtime y el manifiesto sin crear accesos externos:

```powershell
./Install-WebApp.ps1 -Application commercial -InstallRoot ./prueba-comercial -TestMode
```

La validación humana posterior debe cubrir:

1. extracción y comprobación de hashes;
2. instalación sin privilegios administrativos;
3. ausencia de artefactos o modalidades instalables de UMF Support;
4. acceso a Umbravia Forge;
5. actualización de Edge y reapertura del lanzador;
6. desinstalación sin borrar perfil ni datos del servidor;
7. SmartScreen, antivirus y comportamiento en una cuenta de Windows estándar.

## Publicación

El ZIP no se incorpora al historial Git y UMF Support no consume una URL de
instalador. `DOWNLOAD_ZIP_URL` mantiene el enlace de paquete portable de la
aplicación principal. Reabrir un canal de escritorio corporativo requerirá una
decisión explícita, firma de código, publicación HTTPS, hash verificable y una
nueva validación humana; no debe reactivarse por conservar este artefacto.

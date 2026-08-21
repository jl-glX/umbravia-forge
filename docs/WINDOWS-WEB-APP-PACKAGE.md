# Paquete de prueba de aplicaciones web para Windows

## Alcance

El repositorio prepara un ZIP de prueba para instalar accesos separados a UMF
Support y Umbravia Forge en Windows. No convierte la plataforma en una
aplicación nativa: utiliza el modo aplicación de Microsoft Edge y abre siempre
el servicio HTTPS publicado.

```text
npm run package:windows-web-apps
```

El resultado local, excluido de Git, es:

```text
.artifacts/umbravia-forge-windows-web-apps-test.zip
.artifacts/umbravia-forge-windows-web-apps-test.zip.sha256
```

El ZIP contiene el instalador común, envoltorios separados de instalación y
desinstalación, el emblema saneado sin letras de UMF Support en PNG e ICO,
instrucciones y hashes SHA-256 de cada archivo. El acceso instalado de UMF
Support conserva una copia local del ICO; la aplicación principal sigue usando
el icono del runtime. El paquete no contiene el servidor, una base de datos,
secretos, cookies, contraseñas ni datos reales.

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

Los instaladores mantienen la consola visible hasta que la persona confirma el
resultado y abren la aplicación después de crear los accesos. Si el CMD se
ejecuta sin haber extraído el resto del ZIP, muestran una instrucción explícita
en lugar de cerrar silenciosamente. Un fallo al abrir Edge no revierte una
instalación ya completada: el acceso directo permanece disponible.

## Prueba controlada

El instalador admite `-TestMode` y un directorio explícito para validar la
resolución del runtime y el manifiesto sin crear accesos externos:

```powershell
./Install-WebApp.ps1 -Application umf-support -InstallRoot ./prueba -TestMode
./Install-WebApp.ps1 -Application commercial -InstallRoot ./prueba-comercial -TestMode
```

La validación humana posterior debe cubrir:

1. extracción y comprobación de hashes;
2. instalación sin privilegios administrativos;
3. acceso a UMF Support con una cuenta aprobada, MFA y cierre de sesión;
4. imposibilidad de entrar con una cuenta que solo administra un centro;
5. acceso independiente a Umbravia Forge;
6. actualización de Edge y reapertura de ambos lanzadores;
7. desinstalación sin borrar perfil ni datos del servidor;
8. SmartScreen, antivirus y comportamiento en una cuenta de Windows estándar.

## Publicación

El ZIP no se incorpora al historial Git. Tras alojarlo en una ubicación HTTPS
controlada, `UMF_SUPPORT_WINDOWS_ZIP_URL` permite mostrar el enlace en el acceso
de UMF Support. `DOWNLOAD_ZIP_URL` mantiene el enlace de paquete portable de la
aplicación principal. Un URL configurado no demuestra que el binario esté
firmado ni que la instalación se haya validado.

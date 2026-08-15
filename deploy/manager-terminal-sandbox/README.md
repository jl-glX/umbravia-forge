# Entorno aislado de la terminal corporativa

Esta imagen contiene el espacio de ejecución de propósito general de la terminal
corporativa. No es el servidor de Umbravia Forge y no monta su sistema de
archivos, sus secretos, su base de datos ni el socket del motor de contenedores.

Propiedades obligatorias en tiempo de ejecución:

- red deshabilitada hasta que se autorice expresamente el modo `bridge`;
- sistema raíz de solo lectura;
- todas las capacidades Linux eliminadas;
- `no-new-privileges` activo;
- usuario sin privilegios `10001:10001`;
- límites de memoria, CPU, procesos, tiempo y salida;
- espacio activo en memoria efímera dedicado únicamente al trabajo autorizado.

La imagen se prepara de forma explícita y el servicio usa `--pull never`: una
sesión no puede descargar ni sustituir la imagen por su cuenta.

El intérprete y las utilidades son Linux nativos, por lo que el mismo conjunto
de órdenes funciona desde Linux, macOS, WSL y el cliente de PowerShell. Se
incluyen los clientes de Samba (`smbclient`, `smbget`, `nmblookup` y
`samba-tool`) para trabajar con recursos SMB expresamente autorizados. No se
instala ni se inicia un servidor Samba y nunca se expone un recurso del
anfitrión al contenedor.

Al cerrar la sesión, el servidor empaqueta el espacio de trabajo, lo protege
con un sobre autenticado AES-256-GCM del gestor de cifrado y elimina el
contenedor. En reposo solo permanece la instantánea cifrada; una clave ausente,
un contexto distinto o una modificación del archivo impiden restaurarla.

La red permanece deshabilitada de forma predeterminada. Tras validar el
aislamiento puede configurarse `MANAGER_TERMINAL_NETWORK_MODE=bridge` para usar
la conectividad NAT del equipo, incluidos destinos Samba autorizados. El modo
`host`, el socket del motor y los montajes del anfitrión no están admitidos. La
red no sustituye a la exclusión de secretos ni al control de destinos.

El cliente externo exige HTTPS con validación del certificado. HTTP solo se
acepta contra `localhost` durante desarrollo. En producción el servidor rechaza
los endpoints de terminal que no lleguen por el proxy TLS de confianza.

```sh
docker build --tag umbravia-forge/manager-terminal:0.1.0 deploy/manager-terminal-sandbox
```

La habilitación operativa se realiza después de verificar la imagen y el motor
de contenedores. No debe habilitarse un ejecutor directo sobre el anfitrión.

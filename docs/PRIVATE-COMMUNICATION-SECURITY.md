# Seguridad de comunicaciones privadas

## Frontera implementada

Umbravia Forge cifra las nuevas cargas privadas en reposo con AES-256-GCM:

- el texto de las justificaciones privadas de la comunidad;
- los mensajes de los grupos personales gestionados por el servidor;
- los adjuntos privados de Forge Support.

El formato de escritura `agc3` usa una clave de 256 bits, un nonce aleatorio de
96 bits, una etiqueta de autenticación de 128 bits y datos asociados que
vinculan cada carga a su versión, clave y contexto. Los formatos históricos
`xcp1` y `xcp2`, basados en XChaCha20-Poly1305, siguen siendo legibles durante
la migración. Una clave equivocada, un cambio de contexto o una carga
manipulada fallan de forma cerrada.

La biblioteca seleccionada es JavaScript portable y no necesita compilación
nativa. El comprobador de Linux importa el mismo módulo y realiza una prueba
de cifrado y descifrado antes de permitir que se active una release.

La preparación del servidor también realiza operaciones efímeras con
AES-256-GCM, SHA-256, scrypt y Argon2id. No usa las claves reales ni imprime
material criptográfico. Una release no se activa si el módulo nativo Argon2id o
alguna primitiva necesaria no funciona en el Linux de destino.

## Activación manual

La automatización no crea, muestra, sustituye ni rota esta clave. El operador
genera una clave nueva de 32 bytes, guarda una copia de recuperación protegida
y después abre en el servidor:

```bash
sudo nano /etc/umbravia-forge/umbravia-forge.env
```

Debe completar estas líneas existentes:

```text
PRIVATE_CONTENT_ENCRYPTION_ENABLED=true
PRIVATE_CONTENT_ENCRYPTION_KEY=<32 bytes codificados en base64url>
```

No se debe reutilizar `MFA_ENCRYPTION_KEY` ni
`EMAIL_QUEUE_ENCRYPTION_KEY`. Esta configuración existente sigue siendo válida
y no necesita cambiarse para desplegar la actualización.

## Rotación segura y compatible

No se debe sustituir directamente la clave única. Para iniciar una rotación se
mantiene `PRIVATE_CONTENT_ENCRYPTION_KEY` y se añaden, manualmente, las
variables siguientes:

```text
PRIVATE_CONTENT_ENCRYPTION_KEYRING=clave-2026:<clave actual>,clave-2027:<clave nueva>
PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID=clave-2027
```

El identificador `legacy` esta reservado internamente para
`PRIVATE_CONTENT_ENCRYPTION_KEY` y no debe usarse dentro del llavero versionado.

Desde ese momento las escrituras nuevas usan `agc3` y `clave-2027`, mientras
las cargas `xcp1`, `xcp2` y las creadas con `clave-2026` siguen siendo legibles.
La comprobación de preparación de Linux verifica longitud, identificadores,
duplicidades, clave activa y una operación real AES-256-GCM de cifrado y
descifrado antes de aceptar la release.

La biblioteca ofrece operaciones de recifrado, pero la retirada de una clave
no es automática. Antes de eliminarla se necesita un inventario y un trabajo de
migración que confirme que no queda ninguna carga asociada. Hasta entonces se
conservan la clave única y todas las entradas históricas del llavero.

## Comunidades normales

Los canales generales del centro y de clase permanecen legibles por el servidor
para moderación, búsqueda y cumplimiento. Se protegen en tránsito mediante
HTTPS y TLS 1.3 en el origen. Los grupos personales, además, se almacenan en un
envoltorio cifrado y se descifran únicamente después de comprobar la pertenencia
al grupo. El servidor conserva capacidad de descifrado: esto no es cifrado de
extremo a extremo.

## Signal Protocol: límite honesto

El cifrado E2EE individual con Signal Protocol todavía no se declara
implementado. Añadir una biblioteca al servidor no lo convertiría en E2EE: las
claves privadas deben generarse y permanecer en los dispositivos cliente.

La fase completa necesitará, como mínimo:

1. identidad criptográfica por dispositivo;
2. preclaves firmadas y preclaves de un solo uso;
3. establecimiento de sesión y Double Ratchet;
4. soporte multidispositivo y cambio seguro de dispositivo;
5. verificación entre usuarios y aviso de cambio de identidad;
6. almacenamiento local protegido y recuperación explícita;
7. mensajes opacos para servidor, moderación y copias;
8. pruebas con dos navegadores y dispositivos reales.

Hasta completar ese protocolo cliente a cliente, Umbravia Forge debe describir
la mensajería actual como cifrada en tránsito y, en las categorías implantadas,
cifrada en reposo; nunca como E2EE.

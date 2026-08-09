# Seguridad de comunicaciones privadas

## Frontera implementada

Umbravia Forge cifra en reposo con XChaCha20-Poly1305:

- el texto de las justificaciones privadas de la comunidad;
- los adjuntos privados de Forge Support.

El formato `xcp1` es versionado. Usa una clave de 256 bits, un nonce aleatorio
de 192 bits y datos asociados que vinculan cada carga a su contexto. El texto
legado sigue siendo legible para permitir una migración gradual; toda escritura
nueva queda cifrada cuando el perfil está activo. Una clave equivocada, un
cambio de contexto o una carga manipulada fallan de forma cerrada.

La biblioteca seleccionada es JavaScript portable y no necesita compilación
nativa. El comprobador de Linux importa el mismo módulo y realiza una prueba
de cifrado y descifrado antes de permitir que se active una release.

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
`EMAIL_QUEUE_ENCRYPTION_KEY`. La rotación futura requiere un llavero con varias
versiones; cambiar directamente la clave dejaría sin lectura las cargas
anteriores.

## Comunidades normales

Los mensajes de comunidades normales permanecen legibles por el servidor para
moderación, búsqueda y cumplimiento. Se protegen en tránsito mediante HTTPS y
TLS 1.3 en el origen. Esto no se presenta como cifrado de extremo a extremo.

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

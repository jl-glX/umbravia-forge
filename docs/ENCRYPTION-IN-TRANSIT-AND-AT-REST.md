# Cifrado en tránsito y en reposo

## Objetivo

Umbravia Forge aplica el cifrado por capas. La aplicación protege los secretos
que conoce, el proxy protege el tráfico público, PostgreSQL protege las
conexiones remotas y las copias salen cifradas antes de tocar el disco.

Esta implementación no modifica discos, claves reales ni archivos secretos de
un servidor activo. El cifrado completo del volumen requiere una migración de
infraestructura separada.

## Tránsito

| Trayecto                    | Control actual     | Regla                                  |
| --------------------------- | ------------------ | -------------------------------------- |
| Navegador a Cloudflare      | HTTPS              | TLS obligatorio y modo Full (strict)   |
| Cloudflare a Caddy          | TLS 1.3            | certificado válido en el origen        |
| Caddy a Node.js             | loopback           | Node solo escucha en `127.0.0.1`       |
| Node.js a PostgreSQL local  | loopback           | puede usar `DATABASE_SSL=false`        |
| Node.js a PostgreSQL remoto | TLS                | certificado obligatorio y verificado   |
| Node.js a Postfix local     | loopback           | Postfix no acepta relay externo        |
| Node.js a SMTP remoto       | TLS                | no se permite degradar el transporte   |
| Gestor a gestor             | XChaCha20-Poly1305 | identidad y capacidad ligadas al sobre |
| Gestor a gestor             | XChaCha20-Poly1305 | identidad y capacidad ligadas al sobre |

La validación de producción rechaza una base PostgreSQL remota si
`DATABASE_SSL=false` o si `DATABASE_SSL_REJECT_UNAUTHORIZED=false`. Un servicio
local puede usar loopback sin TLS porque el tráfico no abandona el host; su
protección depende además del aislamiento del proceso y del sistema.

El coordinador no entrega objetos internos directamente entre gestores. Valida
primero la conexión registrada y encapsula el contenido con
XChaCha20-Poly1305. El contexto autenticado contiene el consumidor, el proveedor
y la capacidad autorizada, de modo que un sobre no puede reutilizarse en otra
interconexión sin fallar la autenticación. Este control complementa TLS cuando
un gestor se separe en otro proceso; no lo sustituye.

El coordinador no entrega objetos internos directamente entre gestores. Valida
primero la conexión registrada y encapsula el contenido con
XChaCha20-Poly1305. El contexto autenticado contiene el consumidor, el proveedor
y la capacidad autorizada, de modo que un sobre no puede reutilizarse en otra
interconexión sin fallar la autenticación. Este control complementa TLS cuando
un gestor se separe en otro proceso; no lo sustituye.

## Reposo

- contraseñas: Argon2id (`m=19456`, `t=2`, `p=1`), nunca cifrado reversible;
- secretos MFA y cuerpos pendientes de Forge Notify: AES-256-GCM autenticado;
  los nuevos sobres MFA quedan ligados al identificador interno de la cuenta y
  los sobres anteriores siguen siendo legibles durante la migracion;
- justificaciones privadas y adjuntos de soporte: XChaCha20-Poly1305
  autenticado, con envoltorio versionado y contexto asociado;
- mensajes conservados por el coordinador: XChaCha20-Poly1305 con clave
  exclusiva y sobres versionados; el estado público solo descifra mensajes
  saneados y nunca devuelve el sobre;
- mensajes conservados por el coordinador: XChaCha20-Poly1305 con clave
  exclusiva y sobres versionados; el estado público solo descifra mensajes
  saneados y nunca devuelve el sobre;
- copias PostgreSQL: `pg_dump` transmite directamente a `age`;
- clave privada de recuperación: fuera del servidor de producción;
- archivos de entorno: permisos `600` o `640` y nunca incluidos en Git.

El script `deploy/backup-postgresql-encrypted.sh` no crea un `.dump` en claro.
Genera una copia cifrada temporal, la mueve de forma atómica al nombre final,
crea un checksum y solo entonces aplica la retención.

La cola de correo usa un formato versionado con huella no secreta de la clave.
Si la clave activa no coincide con la que cifró un mensaje pendiente, conserva
la carga para que el operador pueda restaurar la clave correcta; no la destruye
como si fuera un texto manipulado. El formato anterior sigue siendo legible.

Las interconexiones usan una clave independiente. La versión con keyring permite
incorporar una clave nueva y mantener las anteriores solo para lectura durante
una rotación controlada. Producción no arranca sin una configuración válida y
el gestor de cifrado la incluye en su auditoría. La plataforma no genera, rota
ni elimina estas claves automáticamente.

Las interconexiones usan una clave independiente. La versión con keyring permite
incorporar una clave nueva y mantener las anteriores solo para lectura durante
una rotación controlada. Producción no arranca sin una configuración válida y
el gestor de cifrado la incluye en su auditoría. La plataforma no genera, rota
ni elimina estas claves automáticamente.

La activación de XChaCha20-Poly1305 y el límite de Signal Protocol están
documentados en
[`PRIVATE-COMMUNICATION-SECURITY.md`](./PRIVATE-COMMUNICATION-SECURITY.md).

El cifrado asimétrico se reserva para la envoltura y el transporte de material
criptográfico y para las copias con `age`; no se usa directamente como cifrado
masivo de filas.

## Preparación manual de la clave de copias

La identidad privada debe generarse en un equipo de recuperación confiable, no
en el servidor de producción:

```bash
age-keygen -o umbravia-backup-identity.txt
chmod 600 umbravia-backup-identity.txt
```

Guarde ese archivo en dos ubicaciones offline protegidas. Copie únicamente el
destinatario público `age1...` que muestra el comando.

En el servidor, abra el entorno protegido:

```bash
sudo nano /etc/umbravia-forge/umbravia-forge.env
```

Añada o complete solo esta línea:

```text
UMBRAVIA_BACKUP_AGE_RECIPIENT=age1...
```

No introduzca `umbravia-backup-identity.txt` ni su contenido en ese archivo.

## Instalación del servicio

Instale con el gestor de paquetes de la distribución `age` y el cliente de
PostgreSQL. Después:

```bash
sudo install -d -o umbravia -g umbravia -m 0700 /var/backups/umbravia-forge/postgresql
sudo install -m 0644 deploy/umbravia-forge-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/umbravia-forge-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo UMBRAVIA_ENV_FILE=/etc/umbravia-forge/umbravia-forge.env \
  bash deploy/check-encryption-readiness.sh
sudo systemctl start umbravia-forge-backup.service
sudo systemctl enable --now umbravia-forge-backup.timer
```

Compruebe el resultado sin mostrar secretos:

```bash
sudo systemctl status umbravia-forge-backup.service --no-pager
sudo systemctl list-timers umbravia-forge-backup.timer --no-pager
sudo find /var/backups/umbravia-forge/postgresql -maxdepth 1 -type f -printf '%M %u %g %f\n'
```

## Prueba de recuperación

La prueba se realiza en una máquina o entorno de recuperación aislado. Copie
allí una copia `.dump.age`, su `.sha256` y la identidad privada mediante un
canal seguro. Primero verifique:

```bash
bash deploy/verify-encrypted-backup.sh \
  umbravia-forge-servidor-fecha.dump.age \
  umbravia-backup-identity.txt
```

Después restaure en una base PostgreSQL vacía de pruebas. Nunca ensaye una
restauración sobre la base activa. Registrar una copia sin probar su
restauración no constituye una estrategia de recuperación completa.

## Cifrado del volumen

El cifrado de archivos de aplicación no sustituye el cifrado del disco. Para
proteger PostgreSQL, logs, temporales y el sistema ante acceso físico al disco,
la ruta recomendada es desplegar una nueva instancia o volumen con LUKS (o una
capacidad equivalente del proveedor), restaurar una copia verificada y cambiar
el servicio durante una ventana controlada.

No se intenta convertir en caliente el disco raíz del servidor actual: puede
exigir desbloqueo en el arranque, provocar indisponibilidad y dejar el sistema
sin acceso remoto. `check-encryption-readiness.sh` informa de esta frontera como
aviso, pero no toca particiones.

## Límites pendientes

- documentar y ensayar la restauración trimestral;
- copiar las copias cifradas a un segundo emplazamiento independiente;
- definir rotación de destinatarios `age` sin perder copias antiguas;
- migrar el volumen del servidor a cifrado integral;
- valorar TLS también en el salto local si PostgreSQL se separa en otro host.

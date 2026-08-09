# Cifrado en tránsito y en reposo

## Objetivo

Umbravia Forge aplica el cifrado por capas. La aplicación protege los secretos
que conoce, el proxy protege el tráfico público, PostgreSQL protege las
conexiones remotas y las copias salen cifradas antes de tocar el disco.

Esta implementación no modifica discos, claves reales ni archivos secretos de
un servidor activo. El cifrado completo del volumen requiere una migración de
infraestructura separada.

## Tránsito

| Trayecto                    | Control actual | Regla                                |
| --------------------------- | -------------- | ------------------------------------ |
| Navegador a Cloudflare      | HTTPS          | TLS obligatorio y modo Full (strict) |
| Cloudflare a Caddy          | HTTPS          | certificado válido en el origen      |
| Caddy a Node.js             | loopback       | Node solo escucha en `127.0.0.1`     |
| Node.js a PostgreSQL local  | loopback       | puede usar `DATABASE_SSL=false`      |
| Node.js a PostgreSQL remoto | TLS            | certificado obligatorio y verificado |
| Node.js a Postfix local     | loopback       | Postfix no acepta relay externo      |
| Node.js a SMTP remoto       | TLS            | no se permite degradar el transporte |

La validación de producción rechaza una base PostgreSQL remota si
`DATABASE_SSL=false` o si `DATABASE_SSL_REJECT_UNAUTHORIZED=false`. Un servicio
local puede usar loopback sin TLS porque el tráfico no abandona el host; su
protección depende además del aislamiento del proceso y del sistema.

## Reposo

- contraseñas: Argon2id (`m=19456`, `t=2`, `p=1`), nunca cifrado reversible;
- secretos MFA y cuerpos pendientes de Forge Notify: AES-256-GCM autenticado;
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

### Perfiles de cascada solicitados

`AES-Twofish-Serpent` y `AES-Twofish` se integran como cifrado transparente de
volumen, no como una construcción criptográfica propia de la aplicación:

| Datos                    | Perfil                          | Cascada del volumen        |
| ------------------------ | ------------------------------- | -------------------------- |
| PostgreSQL de producción | `veracrypt-aes-twofish-serpent` | AES-Twofish-Serpent en XTS |
| SQLite de demostración   | `veracrypt-aes-twofish`         | AES-Twofish en XTS         |

VeraCrypt aplica primero Serpent, después Twofish y finalmente AES en la
cascada de tres; cada cifrador utiliza claves independientes. PostgreSQL y
SQLite ven un sistema de archivos normal ya montado, por lo que no se altera su
formato ni se introduce criptografía casera en TypeScript.

Para declarar volúmenes que ya hayan sido creados, montados y migrados de forma
controlada:

```text
UMBRAVIA_POSTGRES_STORAGE_PROFILE=veracrypt-aes-twofish-serpent
UMBRAVIA_POSTGRES_STORAGE_MOUNT=/var/lib/postgresql
UMBRAVIA_SQLITE_STORAGE_PROFILE=veracrypt-aes-twofish
UMBRAVIA_SQLITE_STORAGE_MOUNT=/var/lib/umbravia-forge/sqlite
```

La comprobación consulta las propiedades del volumen montado y rechaza un
algoritmo distinto al declarado. La aplicación no crea el volumen, no recibe
su contraseña y no almacena keyfiles de VeraCrypt. Esa separación evita que un
compromiso de la aplicación entregue también la clave del almacenamiento.

Activar estos perfiles exige antes:

1. una copia cifrada y una restauración ensayada;
2. una ventana de mantenimiento;
3. crear los volúmenes mediante la herramienta oficial;
4. migrar los directorios con PostgreSQL y la aplicación detenidos;
5. definir un procedimiento seguro de desbloqueo tras reinicio;
6. confirmar el algoritmo con `check-encryption-readiness.sh`;
7. arrancar primero PostgreSQL y después Umbravia Forge.

Guardar la contraseña del volumen junto al servidor permite el arranque
automático, pero reduce considerablemente la protección frente a la toma del
host. Por eso este repositorio no genera un servicio de montaje automático con
una clave guardada en disco.

## Límites pendientes

- documentar y ensayar la restauración trimestral;
- copiar las copias cifradas a un segundo emplazamiento independiente;
- definir rotación de destinatarios `age` sin perder copias antiguas;
- migrar el volumen del servidor a cifrado integral;
- ensayar los perfiles VeraCrypt en un servidor de staging antes de mover la
  base activa;
- valorar TLS también en el salto local si PostgreSQL se separa en otro host.

# Política de cifrado de almacenamiento y datos

## Alcance

Umbravia Forge separa el cifrado del soporte físico del cifrado de los datos de
aplicación. Son controles complementarios y no se sustituyen entre sí:

- **discos y volúmenes Linux:** LUKS2/dm-crypt con XTS-AES-256;
- **datos sensibles de aplicación:** AES-256-GCM autenticado;
- **tráfico de red:** TLS 1.2 como mínimo, con TLS 1.3 preferido y suites AEAD
  interoperables.

Esta política no autoriza conversiones en caliente del disco raíz ni la
generación, sustitución o retirada automática de claves.

## Discos y volúmenes: XTS-AES-256

Los volúmenes que contengan la parte corporativa, bases de datos, registros,
temporales o espacios persistentes de terminal deben usar LUKS2 con
`aes-xts-plain64` y `keysize` de **512 bits totales**. XTS emplea dos claves AES
independientes; 512 bits totales corresponden a dos mitades de 256 bits y se
denominan en esta política XTS-AES-256.

XTS protege sectores almacenados frente al acceso al soporte. No autentica los
datos y no sustituye AES-GCM en objetos, filas, mensajes ni archivos privados.

La comprobación de solo lectura se ejecuta en Linux con:

```bash
sudo sh deploy/check-storage-encryption.sh
```

El comprobador muestra únicamente el dispositivo raíz, la topología, el nombre
del mapeo, el cifrado y el tamaño de clave. No muestra ni modifica material
criptográfico. Devuelve `estado=conforme` únicamente para
`aes-xts-plain64` con 512 bits totales.

## Datos de aplicación: AES-256-GCM

Las nuevas escrituras de contenido privado y las interconexiones de gestores
usan AES-256-GCM con:

- clave de 256 bits ya configurada por el operador;
- nonce aleatorio de 96 bits por carga;
- etiqueta de autenticación de 128 bits;
- datos asociados que vinculan el sobre a su versión, identificador de clave y
  contexto funcional.

Los sobres nuevos son `agc3` para contenido privado y `mcg3` para conexiones de
gestores. Los formatos anteriores `xcp1`, `xcp2`, `mcx1` y `mcx2` siguen siendo
legibles para evitar pérdida de datos. Una lectura autorizada puede recifrar de
forma perezosa una carga antigua con la clave activa, sin crear ni rotar claves.

Se cifra el contenido sensible, no todos los campos indiscriminadamente. Los
identificadores, estados y metadatos mínimos necesarios para enrutar, buscar,
aplicar retención o mantener integridad referencial permanecen disponibles al
servidor. Los cuerpos de soporte, mensajes privados, adjuntos y espacios
corporativos persistentes se protegen con AES-256-GCM.

## Activación del cifrado de volumen

El cifrado del disco raíz no debe improvisarse sobre el servidor activo. La
ruta segura requiere intervención humana y una ventana de mantenimiento:

1. crear una copia cifrada fuera del servidor y demostrar una restauración;
2. comprobar el acceso a la consola de rescate del proveedor;
3. identificar los dispositivos exactos sin basarse en nombres supuestos;
4. preparar una instancia o volumen nuevo con LUKS2 y XTS-AES-256;
5. conservar el material de recuperación fuera del servidor y en dos lugares
   protegidos;
6. restaurar la aplicación y la base de datos en el volumen cifrado;
7. validar salud, esquema, temporizadores y restauración antes del cambio;
8. ejecutar `check-storage-encryption.sh` y conservar una evidencia saneada.

No se proporciona una orden destructiva genérica para formatear o convertir el
disco. El procedimiento concreto depende de la topología real observada y debe
incluir una vía de reversión.

### Servidores alquilados y remotos

La exigencia XTS no implica convertir de inmediato el disco raíz de un servidor
alquilado. Antes de actuar deben confirmarse la topología del proveedor, el
método de arranque, la consola remota, el sistema de rescate y el mecanismo de
desbloqueo después de cada reinicio.

El orden de preferencia es:

1. mantener el servidor actual intacto mientras se verifica una copia
   restaurable;
2. preparar un servidor o volumen paralelo con LUKS2/AES-XTS;
3. restaurar los datos y validar un reinicio real, salud, esquema, correo y
   temporizadores;
4. cambiar el tráfico únicamente después de superar las comprobaciones;
5. conservar temporalmente el servidor anterior como retorno recuperable.

Cifrar solo un volumen nuevo de datos puede reducir el alcance inicial, pero
requiere resolver su desbloqueo tras reinicios. Una clave guardada en claro en
el mismo disco raíz no proporciona una separación suficiente frente a la copia
del servidor. El cifrado completo de la raíz exige además preparar el arranque y
un canal de recuperación. Ninguna de estas decisiones pertenece al actualizador
automático de la aplicación.

La conversión in situ mediante `cryptsetup reencrypt` existe, pero queda fuera
del procedimiento recomendado para producción: requiere espacio reservado,
resiliencia, copia fiable y una recuperación ensayada. Debe preferirse una
migración paralela cuando el proveedor permita conservar el origen hasta cerrar
la validación.

## Límites

- AES-XTS protege el soporte en reposo, pero no detecta por sí solo una
  modificación maliciosa de sectores.
- AES-GCM requiere no repetir nonce con una misma clave; la implementación usa
  aleatoriedad criptográfica y rechaza cargas cuya autenticación falle.
- TLS negocia AES-GCM o ChaCha20-Poly1305 según compatibilidad; forzar AES-GCM
  sobre protocolos externos rompería interoperabilidad sin aportar una frontera
  de confianza adicional.
- La retirada de formatos o claves antiguas exige un inventario que demuestre
  que no queda ninguna carga dependiente.

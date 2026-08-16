# Núcleo de gestores

## Responsabilidades

Los gestores de Umbravia Forge conservan la responsabilidad de su dominio:
gestionan, confirman y avisan. El núcleo no ejecuta trabajo de cuentas,
seguridad, cifrado, correo, recursos, entornos ni soporte. Su administrador
solo regula el tráfico entre gestores para:

- aplicar prioridades estables (`critical`, `high`, `normal`, `low`);
- separar tráfico de control, interactivo, transaccional, mantenimiento y
  observación;
- impedir que dos operaciones usen simultáneamente un ámbito incompatible;
- limitar concurrencia y tamaño de cola global y por gestor;
- permitir trabajo independiente mientras haya capacidad libre;
- evitar inanición mediante envejecimiento gradual de prioridades;
- deduplicar avisos no críticos repetidos y limitar únicamente avisos
  informativos, sin descartar señales críticas.

El coordinador mantiene el registro cerrado de conexiones compatibles, cifra
los mensajes autorizados y distribuye las notificaciones. El administrador del
núcleo no puede cambiar configuraciones de gestores, ejecutar sus tareas ni
mutar secretos.

## Canal prioritario Coordinador a Núcleo

Las órdenes e instrucciones urgentes disponen de un canal de control separado
entre el coordinador y el administrador del núcleo. El coordinador valida el
gestor responsable, el identificador público y los ámbitos; cifra el descriptor
en tránsito y lo entrega al núcleo con prioridad `high` o `critical`. El núcleo
devuelve al coordinador un acuse cifrado cuando el gestor responsable termina.

```text
Coordinador -- orden/instrucción cifrada --> Administrador del núcleo
Coordinador <-- acuse de finalización cifrado -- Administrador del núcleo
```

El canal no es un atajo administrativo:

- solo acepta órdenes e instrucciones `high` o `critical`;
- usa exclusivamente la clase de tráfico `control`;
- una orden se adelanta al trabajo ordinario que ya espera en cola;
- no interrumpe una operación activa ni evita la exclusión de ámbitos;
- no evita los límites de concurrencia, capacidad o tiempo de espera;
- solo transporta identificadores públicos saneados, nunca secretos, claves,
  rutas de archivos ni cuerpos de tareas;
- el administrador regula la ejecución, pero el trabajo continúa perteneciendo
  al gestor de dominio indicado por el coordinador.

## Conexión Seguridad a Cifrado

La conexión directa tiene una sola capacidad registrada:
`security-hardening`.

```text
Gestor de seguridad
        -> solicita diagnóstico de endurecimiento
Coordinador
        -> valida conexión y ámbito encryption-readiness
        -> encapsula el resumen con AES-256-GCM
Gestor de cifrado
        -> devuelve capacidades, estado y códigos públicos saneados
```

Sus límites son deliberados:

- dirección única: Seguridad consume y Cifrado provee;
- modo de solo lectura;
- sin rutas, nombres de variables ni identificadores de claves;
- sin material criptográfico bruto;
- sin capacidad para rotar, activar, sustituir o eliminar claves;
- sin acceso de Seguridad al ámbito protegido `encryption-files`;
- toda modificación sigue requiriendo una acción explícita del operador.

Este canal solo permite que Seguridad incorpore el estado criptográfico a su
diagnóstico y priorice un hallazgo. No convierte al gestor de seguridad en
propietario del cifrado.

## Diagnóstico desde la consola de soporte

La rama `manager-support` dispone de una comprobación de solo lectura para la
sonda pública configurada. Un operador con autoridad superior debe entrar
primero en esa rama; los demás gestores no pueden ejecutar el diagnóstico.

```text
use profile:manager-support
ufctl diagnose probe all
```

También se puede limitar la comprobación a `dns`, `tls`, `live` o `ready`. El
comando usa un destino HTTPS fijado por la configuración del servidor, no
acepta hosts ni rutas escritos por el operador y no sigue redirecciones. Solo
muestra direcciones resueltas, versión y emisor públicos del certificado,
estado HTTP y duración. No lee cuerpos de respuesta, cookies, claves,
certificados privados ni archivos del host, y no puede cambiar Caddy,
Cloudflare o DNS.

El gestor de soporte ejecuta esta observación a través del coordinador con el
ámbito cerrado `diagnostic-probe`. Así se evitan choques con otra comprobación
del mismo ámbito sin convertir la terminal en una herramienta de red genérica.

## Admisión y retroceso

Las operaciones interactivas conservan rechazo inmediato con conflicto, de
modo que una petición HTTP no queda esperando indefinidamente. Las tareas
internas programadas usan la cola priorizada. Una tarea que supera el límite o
el tiempo máximo falla de forma visible y conserva la responsabilidad en su
gestor de origen.

El núcleo no crea migraciones ni modifica datos persistentes. Para volver al
comportamiento anterior basta con revertir su integración en código; no hay
tablas, secretos ni unidades del sistema que restaurar.

## Comprobaciones

La validación debe demostrar:

1. rechazo inmediato de conflictos interactivos;
2. ejecución posterior de tareas internas en conflicto;
3. paralelismo de ámbitos independientes;
4. límites de cola por gestor;
5. señales críticas sin deduplicación ni limitación;
6. conexión Seguridad a Cifrado registrada y conexión inversa denegada;
7. ausencia de claves, nombres sensibles y cuerpos de tarea en el estado;
8. denegación cruzada de `security-files` y `encryption-files`.
9. prioridad efectiva de órdenes de control frente a trabajo ordinario en cola;
10. rechazo de prioridades rebajadas, extremos no autorizados y metadatos
    sensibles en el canal Coordinador a Núcleo;
11. acuse protegido Núcleo a Coordinador sin exponer el resultado del trabajo.

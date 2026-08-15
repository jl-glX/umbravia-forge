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

## Conexión Seguridad a Cifrado

La conexión directa tiene una sola capacidad registrada:
`security-hardening`.

```text
Gestor de seguridad
        -> solicita diagnóstico de endurecimiento
Coordinador
        -> valida conexión y ámbito encryption-readiness
        -> encapsula el resumen con XChaCha20-Poly1305
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

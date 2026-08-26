# Subdominios por centro

Estado vigente: **implementado y probado en el repositorio, desactivado por
defecto y pendiente de validación operativa en DNS, Cloudflare y el servidor**.

## Modelo de seguridad

Cada centro dispone de un `facilityProfiles.slug` único. Ese valor se normaliza
como una etiqueta DNS segura al crear el centro; no se deriva dinámicamente en
cada petición y no admite nombres reservados como `www`, `api`, `support`,
`mail` o `admin`. Durante una prueba comercial activa, la jefatura o una cuenta
administradora del mismo centro puede editarlo desde **Configuración del
centro**. El servidor comprueba formato, reserva y colisiones y actualiza en una
sola transacción tanto el perfil del centro como la prueba. Al finalizar la
prueba, el identificador queda bloqueado.

Cuando existe enrutamiento tenant y la edición se realiza desde la dirección
anterior, la interfaz navega a la nueva dirección después de que el servidor
confirma el cambio. El hostname anterior deja de seleccionar ese centro. Esta
edición no concede membresías ni permisos y no cambia la frontera de
autorización.

Cuando se activa el enrutamiento, una petición a
`<slug>.<TENANT_BASE_DOMAIN>` selecciona el centro antes de autenticar las rutas
de negocio. El `Host` **no concede acceso**: las rutas privadas siguen
requiriendo una sesión válida, una membresía activa en el mismo centro y el
permiso correspondiente. Un encabezado `X-Facility-Id` que intente seleccionar
otro centro se rechaza. Los host desconocidos no heredan el centro de la sesión:
la API responde 404 y la aplicación muestra una página neutra sin datos de otro
tenant.

El endpoint público `/api/tenant-context` expone únicamente nombre, slug,
logotipo y color de marca. Las altas comerciales de prueba reservan el slug
real del centro. El formulario muestra el nombre reservado durante la prueba y,
cuando el enrutamiento está aprovisionado, la dirección tenant resultante.

## Configuración de la aplicación

```dotenv
TENANT_SUBDOMAINS_ENABLED=false
TENANT_BASE_DOMAIN=umbraviaforge.com
CLIENT_ORIGIN=https://www.umbraviaforge.com
WEBAUTHN_ORIGIN=https://www.umbraviaforge.com
WEBAUTHN_RP_ID=umbraviaforge.com
```

La activación exige que `WEBAUTHN_RP_ID` sea exactamente el dominio base. Esto
permite que las credenciales WebAuthn se vinculen al ámbito común previsto sin
convertir un subdominio en autoridad sobre otro. El origen inicial debe
pertenecer al mismo dominio base. Cloudflare Turnstile debe aceptar también los
host tenant que vayan a utilizarse; la validación del servidor sigue comprobando
el hostname devuelto por el proveedor.

## Activación gradual

1. Mantener `TENANT_SUBDOMAINS_ENABLED=false` mientras se prepara la red.
2. Crear un registro DNS wildcard proxied, `*`, hacia el mismo origen que el
   host principal. Los registros exactos existentes conservan precedencia.
3. Emitir un certificado de origen que incluya el dominio base y
   `*.umbraviaforge.com`. Guardar certificado y clave fuera del repositorio; la
   clave debe tener permisos `0600` o `0640`.
4. Copiar
   `deploy/caddy-tenant-subdomains-available/tenant-subdomains.caddy` a
   `/etc/caddy/umbravia-tenant-subdomains-enabled/tenant-subdomains.caddy` y
   copiar `deploy/caddy-tenant-subdomains.env.template` a
   `/etc/umbravia-forge/caddy-tenant-subdomains.env`. Instalar
   `deploy/caddy-tenant-subdomains.service.conf` como drop-in del servicio
   Caddy y proporcionar allí `TENANT_BASE_DOMAIN`,
   `UMBRAVIA_WILDCARD_ORIGIN_CERT` y `UMBRAVIA_WILDCARD_ORIGIN_KEY`. No se debe
   entregar a Caddy el archivo completo de secretos de la aplicación.
5. Validar la configuración candidata con `caddy validate`, recargar Caddy y
   comprobar TLS desde fuera del servidor.
6. Configurar el dominio base de WebAuthn y los host permitidos de Turnstile.
7. Activar `TENANT_SUBDOMAINS_ENABLED=true` en una ventana reversible.
8. Probar un centro A, un centro B, un slug inexistente, inicio de sesión,
   passkeys, marca pública, altas de prueba y un intento cruzado A → B.

Si cualquier comprobación falla, se desactiva la variable de aplicación y se
retira el archivo del directorio `enabled`; el sitio principal continúa usando
la política compartida de Caddy.

## Frontera operativa

El repositorio incluye la resolución, las barreras de autorización, las pruebas
y la plantilla de proxy. No demuestra que el wildcard DNS, el certificado de
origen, el modo TLS de Cloudflare, Turnstile o Caddy estén aplicados en un
servidor. Esa evidencia debe registrarse durante la activación autorizada.

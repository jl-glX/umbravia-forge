<p align="center">
  <img src="./client/public/brand/umbravia-forge-wordmark-v2.png" alt="Umbravia Forge" width="720">
</p>

<h1 align="center">Umbravia Forge</h1>

<p align="center">
  <strong>Plataforma modular y multi-tenant para gestionar centros deportivos, comunidad, soporte y analítica operativa.</strong>
</p>

<p align="center">
  <a href="https://github.com/jl-glX/umbravia-forge/actions/workflows/ci.yml"><img src="https://github.com/jl-glX/umbravia-forge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-24_LTS-334155?logo=nodedotjs&logoColor=white" alt="Node.js 24 LTS">
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6">
  <img src="https://img.shields.io/badge/licencia-propietaria-F07A3A" alt="Licencia propietaria">
</p>

<p align="center">
  <a href="https://www.umbraviaforge.com/">Sitio web</a>
  ·
  <a href="./docs/ARCHITECTURE.md">Arquitectura</a>
  ·
  <a href="./DEVELOPMENT.md">Desarrollo</a>
  ·
  <a href="./docs/SECURITY.md">Seguridad</a>
</p>

> [!IMPORTANT]
> Umbravia Forge está en desarrollo activo. La instancia pública permite validar el producto, pero el proyecto todavía no se considera listo para operar pagos reales ni para un lanzamiento comercial general.

## Una plataforma, cada centro con su propio espacio

Umbravia Forge reúne en una misma base técnica la actividad diaria de un centro, la experiencia de sus socios y las herramientas internas necesarias para mantener el servicio. La arquitectura separa los datos por centro y conserva las credenciales, la recuperación y la seguridad de la cuenta como responsabilidades globales del usuario.

### Producto y operaciones

- **Centros y equipos:** alta de administradores, perfiles de centro, membresías y permisos por tenant.
- **Clases y reservas:** calendario, aforo, reservas, listas de espera FIFO, promociones y control de asistencia.
- **Personas:** experiencias diferenciadas para socios, entrenadores y administradores.
- **Comunidad:** perfiles sociales, contactos, canales de centro o clase, mensajería y moderación con límites de acceso explícitos.
- **Forge Analytics:** ocupación, asistencia, cancelaciones, demanda y comparativas por actividad, franja horaria y centro.
- **Forge Support:** tickets, conversaciones privadas, notas internas, adjuntos protegidos, SLA y base de conocimiento.
- **Cuentas y continuidad:** verificación de correo, recuperación de acceso, MFA, passkeys, sesiones revocables y cierre reversible de cuenta.
- **Forge Notify:** cola transaccional cifrada, reintentos acotados, trazabilidad, saneamiento periódico y transporte de correo desacoplado.
- **Plano de gestión interno:** coordinación de gestores, prioridades, control de conflictos y consola corporativa aislada.

### Principios de diseño

| Principio              | Aplicación práctica                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Aislamiento por centro | El servidor resuelve el tenant y comprueba la membresía antes de acceder a datos operativos.              |
| Seguridad por defecto  | Validación, autorización, límites, sesiones revocables y cifrado independiente por dominio sensible.      |
| Portabilidad           | Desarrollo compatible con Windows, Linux y WSL; producción sin dependencia operativa de Windows.          |
| Cambios verificables   | Migraciones versionadas, pruebas de aislamiento, paquetes auditados y despliegues con rollback.           |
| Modularidad            | Los gestores operan su área; el coordinador y el núcleo regulan conexiones, conflictos y prioridades.     |
| Datos con propósito    | La analítica evita inventar causalidad y mantiene separadas identidad, soporte, facturación y telemetría. |

## Arquitectura

```mermaid
flowchart LR
    UI["React · experiencia web"] --> API["Express · API y autorización"]
    API --> DOMAIN["Servicios de dominio y gestores"]
    DOMAIN --> DATA["Kysely · capa de datos"]
    DATA --> PG["PostgreSQL · staging y producción"]
    DATA --> SQLITE["SQLite · desarrollo, pruebas y demos aisladas"]
    DOMAIN --> NOTIFY["Forge Notify · cola cifrada"]
    NOTIFY --> MAIL["Transporte de correo"]
```

Las decisiones y fronteras completas están documentadas en [Arquitectura](./docs/ARCHITECTURE.md), [migración multi-tenant](./docs/MULTI-TENANT-MIGRATION.md) y [núcleo de gestores](./docs/MANAGER-CORE.md).

## Tecnologías

| Capa      | Tecnologías principales                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| Interfaz  | React 19, TypeScript 6, Vite 8, Tailwind CSS 4, i18next                              |
| API       | Node.js 24 LTS, Express 5, validación y middleware de autorización                   |
| Datos     | Kysely, PostgreSQL, SQLite para entornos aislados                                    |
| Seguridad | Argon2id, WebAuthn/passkeys, TOTP, AES-256-GCM y XChaCha20-Poly1305 según el dominio |
| Calidad   | Vitest, ESLint, Prettier, auditoría de dependencias y GitHub Actions                 |
| Edge      | Cloudflare Turnstile y Worker de entrada de correo de soporte                        |

La interfaz está disponible en español, inglés, alemán y alemán suizo, con formatos regionales mediante `Intl`.

## Desarrollo local

### Requisitos

- Node.js `>=24.15.0 <25`
- npm `>=11.18.0 <12`

### Puesta en marcha

```bash
npm ci
npm run dev
```

El lanzador inicia ambos servicios:

- interfaz: <http://127.0.0.1:3000>
- API: <http://127.0.0.1:3001>

Los valores predeterminados sirven para el entorno local. Copia `.env.example` a `.env` únicamente si necesitas ajustes propios y no incorpores secretos, bases de datos ni datos reales al repositorio.

## Calidad y validación

El control local completo es:

```bash
npm run ci:validate
```

Este comando comprueba portabilidad, formato, lint, tipos, pruebas, compilaciones y dependencias. GitHub Actions repite la validación sobre Linux y audita además el paquete de despliegue.

| Comando                  | Uso                                                                 |
| ------------------------ | ------------------------------------------------------------------- |
| `npm run test:watch`     | Sesión persistente de pruebas durante el desarrollo.                |
| `npm run format`         | Aplica el formato del repositorio.                                  |
| `npm run typecheck`      | Valida los contratos TypeScript del cliente, servidor y Worker.     |
| `npm run build`          | Compila todos los artefactos de la aplicación.                      |
| `npm run deploy:package` | Prepara y audita un paquete Linux sin secretos ni datos locales.    |
| `npm run security:probe` | Ejecuta la sonda local autorizada contra una API en funcionamiento. |

Consulta [DEVELOPMENT.md](./DEVELOPMENT.md) para conocer el flujo de trabajo, las convenciones y los límites de los entornos.

## Estructura del repositorio

```text
client/       interfaz React, recursos de marca e internacionalización
server/       API, servicios, autorización, datos y migraciones
cloudflare/   Worker de entrada para el correo de soporte
deploy/       unidades y comprobaciones de despliegue Linux
scripts/      desarrollo, validación, empaquetado y utilidades controladas
docs/         arquitectura, seguridad, auditorías y continuidad técnica
```

## Documentación destacada

- [Arquitectura del sistema](./docs/ARCHITECTURE.md)
- [Migración y aislamiento multi-tenant](./docs/MULTI-TENANT-MIGRATION.md)
- [Forge Analytics](./docs/FORGE-ANALYTICS.md)
- [Forge Support](./docs/FORGE-SUPPORT.md)
- [Forge Notify](./docs/FORGE-NOTIFY.md)
- [Ciclo de vida de las cuentas](./docs/ACCOUNT-LIFECYCLE.md)
- [Núcleo de gestores](./docs/MANAGER-CORE.md)
- [Modelo de cifrado en tránsito y reposo](./docs/ENCRYPTION-IN-TRANSIT-AND-AT-REST.md)
- [Estándar de auditoría de seguridad](./docs/SECURITY-AUDIT-STANDARD.md)
- [Preparación para despliegue propio](./docs/SELF-HOSTED-PRODUCTION.md)

## Límites actuales

- Stripe permanece separado del libro operativo interno: todavía no se procesan pagos, suscripciones ni reembolsos reales.
- La entregabilidad del correo depende también de DNS, reputación, recepción, rebotes y proveedores externos; una aceptación SMTP no equivale por sí sola a entrega en la bandeja de entrada.
- Las copias cifradas, la restauración y las migraciones de PostgreSQL deben comprobarse en cada entorno autorizado antes de un lanzamiento comercial.
- Los textos legales y fiscales requieren completar los datos reales y una revisión profesional.
- Las aplicaciones de escritorio y móviles forman parte de una evolución posterior, no del núcleo actualmente distribuido.

## Propiedad y licencia

Umbravia Forge es un proyecto propietario de **Javier López Díaz**. Este repositorio no concede derechos de copia, redistribución, modificación ni explotación salvo autorización expresa.

---

<p align="center">
  <sub>Modular · Guide · Analyze · Belong · Evolve</sub>
</p>

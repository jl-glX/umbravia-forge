# Umbravia Forge development guide

## Requirements

- Node.js 24 LTS (24.15.0 or newer in the 24.x line).
- npm 11.18.0 or newer in the 11.x line. Earlier npm 11 releases do not
  implement the pinned install-script approval policy used by this project.

## Installation and local execution

```bash
npm ci
npm run dev
```

The launcher in `scripts/dev.ts` starts Vite and Express together and closes
both processes cleanly. The frontend uses port `3000` and the API uses `3001`.
The resource manager checks Umbravia Forge runtime records when it starts, before
and after every managed task, and again during shutdown. Vite also closes its
own HTTP/HMR connections, file watcher and plugin resources during a graceful
development shutdown. These safeguards never terminate unrelated Windows
processes merely because they use Node.js or a nearby port.
The residual check also runs periodically (every five minutes by default) so it
does not depend only on observable task boundaries. Configure it with
`RESOURCE_RUNTIME_CHECK_INTERVAL_MS`; values are limited to 30 seconds through
60 minutes to prevent either excessive polling or an ineffective interval. If
Vite does not complete its normal close within `VITE_SHUTDOWN_TIMEOUT_MS`, the
launcher asks Vite's owned HMR, watcher, plugin and environment resources to
close defensively. The default `npm run dev` launcher deliberately avoids an
extra watch-process wrapper; frontend hot module replacement remains provided
by Vite, while backend code changes require restarting the launcher.
Ports are strict: the launcher stops with a clear error instead of silently
moving the frontend to another port. Opening the API root returns an
orientation response; the actual interface remains on the frontend URL.

## Persistent test session

Use `npm run test:watch` while developing. Vitest keeps one session alive,
reruns affected tests after a file change and releases its lock and temporary
resources on shutdown. The command, worker pool, lock and cleanup guard use
Node.js APIs and the operating system temporary directory, so the same workflow
is supported on Windows and Linux without shell-specific scripts.

Both one-shot and watch executions pass through a small process supervisor. It
forwards normal shutdown signals to the exact Vitest process it created, waits
up to ten seconds for its workers to close and only then forces that owned
process to stop. It does not enumerate or terminate unrelated Node.js, Vite or
application processes by executable name, port or broad pattern.

The operational portability guard runs through `npm run portability:check`.
It rejects Windows-only command wrappers and absolute Windows paths in the
development, validation and deployment tooling. GitHub CI also parses every
Linux deployment shell script and builds and audits the deployment package on
Ubuntu. Windows remains a supported development platform, but it is not an
operational dependency of production.

Only one Vitest session may own the project test resources at a time. Stop the
watch session with `Ctrl+C` before running the complete `npm run ci:validate`
gate. If a process is interrupted, the next run detects and replaces its stale
lock; it never terminates unrelated Node.js processes.

## Environment

Copy `.env.example` to `.env` to override defaults.

| Variable                                     | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                                   | Runtime mode. Production enables stricter cookies, CSP and HSTS. |
| `APP_ENV`                                    | Selects development, demo, staging or production policy.         |
| `PORT`                                       | Express API port. Defaults to `3001`.                            |
| `DATABASE_PROVIDER` / `DATABASE_URL`         | Selects SQLite locally or the protected PostgreSQL deployment.   |
| `CLIENT_ORIGIN`                              | Required HTTPS browser origin(s) in production.                  |
| `WEBAUTHN_ORIGIN`                            | Public trusted origin used for passkey verification.             |
| `WEBAUTHN_RP_ID`                             | Relying-party domain bound to passkey credentials.               |
| `MAX_REQUEST_SIZE`                           | Maximum JSON and form body size.                                 |
| `RATE_LIMIT_WINDOW_MINUTES`                  | Rate-limit window.                                               |
| `RATE_LIMIT_MAX_REQUESTS`                    | General API request limit.                                       |
| `AUTH_RATE_LIMIT_MAX_REQUESTS`               | Sensitive authentication action limit.                           |
| `LOGIN_RATE_LIMIT_MAX_REQUESTS`              | Failed login attempt limit per 15-minute window.                 |
| `SIGNUP_RATE_LIMIT_WINDOW_MINUTES`           | Signup rate-limit window.                                        |
| `SIGNUP_RATE_LIMIT_MAX_REQUESTS`             | Signup attempts allowed in that window.                          |
| `EMAIL_VERIFICATION_RATE_LIMIT_MAX_REQUESTS` | Verification email resend limit per 15 minutes.                  |
| `SEED_DEMO_DATA`                             | Reserved for local demos; production rejects a `true` value.     |
| `VITE_TURNSTILE_SITE_KEY`                    | Public Cloudflare Turnstile site key embedded in the client.     |
| `TURNSTILE_SECRET_KEY`                       | Private Cloudflare Turnstile key used only by the API.           |
| `EMAIL_VERIFICATION_ENABLED`                 | Keeps new accounts pending until their mailbox is confirmed.     |
| `SMTP_HOST`                                  | SMTP relay or local mail transfer agent host.                    |
| `SMTP_PORT`                                  | SMTP submission port.                                            |
| `SMTP_SECURE`                                | Enables implicit TLS, normally on port 465.                      |
| `SMTP_REQUIRE_TLS`                           | Requires STARTTLS for a non-implicit TLS connection.             |
| `SMTP_USER` / `SMTP_PASSWORD`                | Optional SMTP credentials; configure both or neither.            |
| `EMAIL_FROM`                                 | Verified sender displayed on account emails.                     |
| `EMAIL_QUEUE_ENCRYPTION_KEY`                 | AES-256-GCM key for queued transactional-email payloads.         |
| `PRIVATE_CONTENT_ENCRYPTION_ENABLED`         | Activates versioned AES-256-GCM for new private content.         |
| `PRIVATE_CONTENT_ENCRYPTION_KEY`             | Legacy-compatible 32-byte key; also used when no keyring exists. |
| `PRIVATE_CONTENT_ENCRYPTION_KEYRING`         | Versioned key-id/key entries for controlled key replacement.     |
| `PRIVATE_CONTENT_ENCRYPTION_ACTIVE_KEY_ID`   | Selects the keyring entry used for new encrypted content.        |
| `SUPPORT_NOTIFICATION_EMAIL`                 | Optional internal destination for new-ticket notifications.      |
| `SUPPORT_ATTACHMENT_MAX_BYTES`               | Private attachment limit; defaults to 5 MiB and is capped at 10. |
| `SUPPORT_MUTATION_RATE_LIMIT_MAX_REQUESTS`   | Per-window mutation budget for Forge Support.                    |
| `UMF_SUPPORT_EMAIL_*`                        | Separate corporate inbound address, reply key and webhook key.   |
| `UMF_COMPANY_HEAD_BOOTSTRAP_EMAIL_SHA256`    | One-time designated corporate-head mailbox fingerprint.          |
| `UMF_MANAGER_ADMIN_LINUX_USERS`              | Exact Linux-user allowlist for local manager administration.     |
| `STRIPE_BILLING_ENABLED`                     | Explicitly enables the centre SaaS subscription integration.     |
| `STRIPE_BILLING_MODE`                        | Selects isolated Stripe `test` or `live` objects.                |
| `STRIPE_RESTRICTED_API_KEY`                  | Mode-matched restricted server key; never exposed to the client. |
| `STRIPE_WEBHOOK_SECRET`                      | Signs the exact raw Stripe webhook body.                         |
| `STRIPE_PRICE_FORGE_MONTHLY`                 | Server-authorized monthly recurring Price.                       |
| `STRIPE_PRICE_FORGE_ANNUAL`                  | Independent server-authorized annual recurring Price.            |
| `STRIPE_PORTAL_CONFIGURATION_ID`             | Optional explicit Customer Portal configuration.                 |
| `STRIPE_CONNECT_ENABLED`                     | Explicitly enables direct facility payments.                     |
| `STRIPE_CONNECT_MODE`                        | Selects isolated Stripe `sandbox` or `live` objects.             |
| `STRIPE_CONNECT_RESTRICTED_API_KEY`          | Separate restricted key for Accounts v2 and direct Checkout.     |
| `STRIPE_CONNECT_WEBHOOK_SECRET`              | Signs the connected-account webhook body.                        |

Protected authentication actions use an explicitly rendered Cloudflare
Turnstile widget. The client sends the short-lived token to the API, which
validates it with Cloudflare before accepting the protected request and checks
the expected action and trusted hostname in production. Turnstile is not a
substitute for email ownership, MFA, rate limits, monitoring or edge controls.
Use Cloudflare's documented test keys only in local development; production
configuration rejects them.

Never commit `.env`, databases, tokens or real customer data.

The commercial application and UMF Support share the configured database
provider, but not an authentication identity. `users.identityRealm`, separate
session/MFA/passkey cookies and domain authorization keep `commercial` and
`corporate_support` accounts independent even when their normalized email is
the same. PostgreSQL is therefore the production store for both applications;
separation is enforced by schema relations and server checks, not by treating
one portal as a role of the other.

Manager administration has no browser route or remote shell. On Linux, use the
maintained read-only interface only after configuring the local operating-user
allowlist outside the repository:

```text
npm run platform:managers -- --email <authorized-account> --scope commercial overview
npm run platform:managers -- --email <authorized-account> --scope support overview
```

The command rejects non-Linux systems, `root` and users absent from
`UMF_MANAGER_ADMIN_LINUX_USERS` before it initializes or migrates the database.
Application authority is then evaluated independently for the requested
scope. Do not place real Linux usernames or account emails in a committed
template or document.

Stripe Billing remains disabled by default. Production startup validates the
complete Stripe configuration when it is enabled, and a staging profile cannot
load Live keys. The deployable templates contain names and safe disabled
defaults only; actual provider values stay in the authorized secret mechanism.
See `docs/STRIPE-BILLING.md` for the payment boundary and activation procedure.

### Protected security configuration

Environment files, private keys, certificates, signing material and security
provider configuration are persistent operational state, not disposable
release files. Do not delete, replace, regenerate or migrate them as part of a
code cleanup or deployment unless their purpose, dependencies, impact and
recovery path have first been reviewed. An approved replacement must preserve
a protected backup until the new configuration has been validated. Release
automation may verify these files and consume their values, but must never own
or remove them.

Email verification is active in production. Codes are hashed, expire, have
bounded attempts and are delivered by the encrypted transactional queue.
Production fails closed when SMTP or the queue-encryption key is incomplete.
See `docs/FORGE-NOTIFY.md` for the boundary between Umbravia's application
service and the SMTP/MTA delivery layer.

## Project layout

```text
client/src/
  components/   shared and domain UI
  hooks/        data access and view state
  i18n/         language configuration and ES/EN/DE/DE-CH catalogues
  lib/          API, date and localization helpers
  pages/        route-level screens

server/
  db/           schema, connection and demo seed
  lib/          shared server helpers
  middleware/   authentication, authorization, validation and security
  routes/       HTTP endpoints
  services/     domain and persistence logic

scripts/        development launcher
docs/           maintained technical and release documentation
```

## Working conventions

- Keep authorization in server middleware and services; hiding a button is not a security control.
- Validate external input before it reaches domain services.
- Keep business rules out of React components.
- Add visible interface text to the Spanish, English and German catalogues.
- Add a `de-CH` override only when Swiss spelling or regional wording differs from standard German.
- Do not automatically translate names or content entered by users.
- Add or update tests for authentication, authorization, reservation and waitlist rules.
- Use `.js` extensions for relative server imports because the server compiles as Node ESM.
- Use TypeScript 7 for compilation. TypeScript 6 remains installed only as the
  programmatic API required by ESLint until that API is available in the native
  compiler.
- Treat code, migrations and tests as the implementation source of truth. Use
  `docs/README.md` to distinguish maintained documents from dated audits.
- Update the maintained document affected by a behavior, security boundary,
  migration or operational workflow. Do not rewrite dated evidence as if it
  described the current commit.
- Follow `AGENTS.md`, especially its protected-state rules. Never rotate or
  replace secrets, keys, certificates or provider configuration as part of a
  routine code or documentation change.

## Before review

```bash
npm run format
npm run ci:validate
git diff --check
```

`npm run ci:validate` verifies portability, formatting, lint, client/server
TypeScript, tests, production builds and dependencies without replacing the
working installation. `npm run CI` remains available when a clean locked
installation is explicitly required. Commit descriptions are written in
Spanish so the project history uses the collaboration language.
The dependency maintenance rules and intentional compatibility holds are
documented in `docs/dependency-policy.md`.

## Database changes

The shared database facade in `server/db/client.ts` selects SQLite or PostgreSQL
through the deployment configuration. SQLite schema initialization remains the
self-contained path for development and isolated demos; PostgreSQL uses
versioned migrations. Local database files under `data/` are ignored by Git.

SQLite enables foreign-key checks, WAL journaling and a bounded busy timeout.
Reservation and cancellation changes run in transactions. These protections
improve isolated single-instance environments. Staging and production require
PostgreSQL and must validate locking, backup restoration and the main business
flows against a real authorized instance before launch.

The environment manager may create isolated SQLite databases and inventory
their migration categories. It does not automatically copy credentials,
identity, billing or community data. See
`docs/DATABASE-ENVIRONMENT-MANAGER.md`.

## Adding a page or endpoint

1. Identify the relevant domain and permission level.
2. Add server validation, authorization and service logic first when data changes are involved.
3. Add the route and typed client integration.
4. Add Spanish, English and German strings plus any necessary Swiss German override.
5. Cover critical behavior with tests.
6. Run the complete validation sequence.

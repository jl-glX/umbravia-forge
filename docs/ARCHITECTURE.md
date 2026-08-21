# Architecture

## Overview

Umbravia Forge is a TypeScript application with a React client, an Express API
and a provider-selecting Kysely data layer. PostgreSQL is the primary engine for
staging and production; SQLite supports development, tests and isolated demos.

```text
Browser
  -> React pages and components
  -> typed hooks and API client
  -> Express routes
  -> validation and authorization middleware
  -> domain services
  -> Kysely
  -> provider runtime
       -> PostgreSQL (staging and production)
       -> SQLite (development, tests and isolated demos)
```

Development uses a single launcher for Vite and Express. Production builds the client into `dist/public` and compiles the server as Node ESM.

## Main domains

- Authentication and persistent sessions.
- Users and role-based permissions.
- Activity sessions and trainer assignments, with temporary compatibility
  aliases for the former class-oriented HTTP vocabulary.
- Bookings, capacity and waitlist promotion.
- Activity and administrative analytics.
- Forge Analytics as a tenant-scoped read layer shared by administrative and
  trainer views, monthly surveys and a separate tenant CRM foundation. Support
  and any future sanitized crash analytics consumers keep independent
  authorization boundaries. See
  [Forge Analytics](./FORGE-ANALYTICS.md).
- Umbravia Forge financial records adapted internally from App-ProTrack's budget and transaction domain.
- Internationalized user interface.
- Public legal information.
- Account identity, reversible closure scheduling and draft-only data-retention
  policies.
- Coordinated account, security, resource, environment, email, notification and
  support managers.
- A manager coordinator that owns the connection registry, rejects overlapping
  scopes and distributes sanitized confirmations and alerts; domain managers
  retain responsibility for operating their own area.
- A manager core administrator that regulates concurrency, bounded queues,
  traffic classes and priorities without executing domain work or changing
  manager configuration. See [Manager core](./MANAGER-CORE.md).
- An encrypted high-priority control channel from the manager coordinator to
  the core administrator for `high` and `critical` orders or instructions, with
  protected acknowledgements and no bypass of conflicts or capacity limits.
- A one-way, read-only Security to Encryption hardening channel that shares a
  sanitized cryptographic readiness view without key material or mutation
  authority.
- Isolated SQLite environment provisioning and reviewed PostgreSQL promotion
  planning.

## Roles

The account role (`member`, `trainer` or `admin`) describes the broad portal an
identity may enter. Every tenant operation additionally resolves an active
facility membership with a facility role (`owner`, `admin`, `trainer` or
`member`). Owners and facility administrators can manage that centre's users,
activities, operational billing records, subscription, Analytics and CRM;
trainers and members receive narrower centre-scoped views. A global `admin`
account is not permission to read another facility.

Authentication proves the current identity. Server-side facility resolution,
membership checks and capability middleware decide what that identity may do;
hiding an action in React is never an authorization control.

## Localization

`i18next` manages interface text and language selection. Browser `Intl` handles locale-sensitive dates, time zones, numbers and currencies. Spanish, English and standard German catalogues live in `client/src/i18n/locales`; `de-CH` supplies Swiss Standard German spelling and regional overrides while inheriting the common German catalogue.

The billing currency allowlist includes Swiss francs (`CHF`). Amounts are formatted by `Intl.NumberFormat` with the active interface locale, so German and Swiss German use their corresponding regional conventions without custom separators.

Known demo classes are localized at display time. User-created names and descriptions remain exactly as entered.

## Evolution boundaries

- Validate the versioned PostgreSQL migrations against an authorized staging
  instance and prove backup restoration before production.
- Keep data transfer separate from migration planning: sensitive identity,
  billing, community and authentication records require explicit approval and
  a destination-specific procedure.
- Keep the centre-to-member billing ledger separate from Stripe Billing. The
  ledger records operational status and does not move money; Stripe Checkout,
  the customer portal and signed webhooks now manage the centre's SaaS
  subscription in an explicitly selected Test or Live mode. Local billing
  records separate both modes and reject mismatched events or unconfigured
  Prices. Operational invoice events retain only a minimal attention state,
  while a privileged reconciliation reads the current Stripe Subscription
  without treating the browser return as proof of payment. Commercial
  entitlements are derived by a separate service and enforced by Analytics and
  CRM middleware. Live-capable code does not prove that Live account objects,
  secrets or end-to-end payments are configured.
- Invoice details, archived records and custom billing cycles belong to Umbravia Forge's financial domain. The visible interface does not expose App-ProTrack as a product name.
- Facility profile settings store the centre name, logo and accent colour separately from Umbravia Forge's product identity. Logo updates are admin-only and accept PNG, JPEG or WebP images up to 512 KB.
- There is no implicit or privileged compatibility facility. Every operational
  tenant must be an active `facilityProfiles` row and every user-facing context
  must resolve through an active membership. Inherited unscoped data is moved
  to a closed `legacy-import-quarantine` scope for explicit review; it never
  grants access. Platform-wide authorization is represented separately by a
  controlled `platformOperators` record, not by membership of a special
  facility. These repository controls do not replace a PostgreSQL staging
  migration, backup/restore exercise and controlled cross-tenant validation
  before commercial production.

## Community, identity and moderation

The community domain is split into social profiles, bilateral contacts,
scoped channels, messages, facility links, parental controls and moderation
cases. These modules communicate through stable account and message IDs while
keeping billing, credentials and private account data outside community
queries. Class-channel authorization is derived from bookings, the waitlist,
the assigned trainer or the administrator role.

The operational scope and consciously deferred decisions are recorded in
`docs/COMMERCIAL-POINTS-22-38.md`.

- The interface keeps three visual identities separate: the fixed Umbravia Forge product logo, the active facility logo and the signed-in user's profile photo. Profile photos can only be updated by their account owner and use the same safe image restrictions as facility logos.
- Continue adapting suitable App-ProTrack concepts instead of duplicating a second finance domain.
- Keep Umbravia Forge functional when optional integrations are unavailable.
- Keep account closure decisions separate from physical deletion. Scheduling,
  cancellation and cleanup coordination are implemented, while destructive
  data-retention execution remains disabled pending legal and operational
  policy. The lifecycle module can request a disposition preview from the
  retention module; see
  [Account lifecycle foundation](./ACCOUNT-LIFECYCLE.md).

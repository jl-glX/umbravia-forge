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
- A corporate UMF Support application for platform incidents, privacy mail and
  manually approved staff. Its platform authority and tables remain logically
  separate from each facility's tenant-scoped Forge Support module.
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

UMF Support uses a third authentication portal named `support`. Access is
granted only by an active corporate support membership. This portal does not
select a facility context and cannot be reached merely by holding the global
account role `admin` or an active commercial `platformOperators` record.
Commercial and corporate identities use different realm values and different
session, MFA and passkey cookies. The same normalized email may identify one
account in each realm without sharing a password, recovery flow or session.

Both applications use the data provider selected for the deployment:
PostgreSQL in staging and production, SQLite in isolated development and test
environments. UMF Support is not a second physical database in the current
architecture. Its isolation comes from realm-qualified account relations,
corporate-only tables and server authorization; sharing a PostgreSQL service
does not make a commercial account a corporate identity.

Corporate registration creates an independent `corporate_support` identity and
requires the ordinary bounded mailbox-verification challenge. Verification does
not create `umfSupportStaff`, a company position, a facility membership or a
commercial operator for ordinary accounts. They remain unable to enter the
staff application until an active director approves them. The one-time initial
head is the sole exception: after mailbox verification, or after the next
successful password, MFA or passkey login of an already verified account, the
server compares its normalized email with the externally configured SHA-256
digest. An exact match atomically creates the active director, `platform_head`
and persistent singleton marker. Missing or invalid configuration, a different
email and an existing different head fail closed. The local PostgreSQL-only
designation command remains an explicit recovery tool.

If historical code attached the support director, company head or bootstrap
marker to the `commercial` identity with the same normalized email, this exact
configured bootstrap may delete only those invalid corporate relations before
claiming the corporate identity. It does not update or delete the commercial
user, credentials, memberships or deletion request. A different email or a
different corporate owner is never repaired automatically.

There is no compatibility path that transfers corporate authority from a
`commercial` user. Historical misplaced relations must first be removed by the
audited support-identity reset, which is forbidden from deleting or changing
the commercial user, credentials, facility data or deletion lifecycle. Later
support accounts register and verify independently, then remain denied until an
active director approves the administrative membership. The public form never
selects a staff role.

The active corporate administration is intentionally small:
`umfSupportStaff` scopes support operations, `platformOperators` remains
commercial authority, and directors approve or revoke administrator accounts.
Collaboration spaces expose only explicitly selected, reduced capabilities and
can be disabled independently. The wider organisation and delegation model is
retained as a future draft rather than exposed as an active API or interface.
`companyStaffProfiles` currently retains the `platform_head` signal required by
the local manager boundary; a company position alone never grants technical
access.

Domain managers are shared internal infrastructure, not another account
portal. Their single administrator is available only from the local Linux
interface and every operation is explicitly scoped as `commercial` or
`support`; neither application exposes manager administration routes in the
browser. The process rejects `root` and requires the local Linux user to appear
in `UMF_MANAGER_ADMIN_LINUX_USERS` before application authority is evaluated.
Commercial views require a verified commercial platform operator. Support
views require a verified corporate identity that is both an active UMF Support
director and the active platform head. Operations and signals are filtered by
scope before they are presented.

Transactional email uses the same explicit platform boundary. Every
`emailDeliveries` row stores `commercial` or `support`; retries and failure
signals retain that stored scope. PostgreSQL migration 44 prepares the column
and only reclassifies legacy rows when a persisted UMF Support relationship is
unambiguous. Repository migrations do not prove that the live database has
already applied it.

UMF Support mail drafts are a separate encrypted domain. The application
stores To, CC, BCC, subject and body encrypted, renders only controlled HTTPS or
`mailto:` links, and creates support-scoped deliveries for immediate or future
dispatch. PostgreSQL migrations 47 and 48 add drafts, per-user notification
preferences and encrypted push subscriptions; the SQLite-to-PostgreSQL bridge
includes all three. Notification preferences are off by default and a verified
or approved account is not subscribed automatically. Email is the primary
alert channel; Web Push is optional and requires per-device consent plus VAPID
configuration outside the repository.

Account email changes belong to the identity boundary rather than facility
administration. They require the current password and a bounded code delivered
to the new inbox; completion revokes other sessions and obsolete temporary
challenges and queues a security notice to the previous address.

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

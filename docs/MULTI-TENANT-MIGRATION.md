# Multi-tenant migration

## Purpose

Umbravia Forge requires an explicit, active facility for every tenant-scoped
operation. The former compatibility identifier `primary` is retained only in
dated historical documents; it is not created, selected or authorized by the
active code.

The presence of a `facilityId` column is not proof of isolation. A phase is only
complete when reads, writes, updates, deletes, background work and exported
data all enforce the same boundary on the server.

## Current boundary

- `facilityProfiles` is the tenant root and retains the visible centre identity.
- `facilityMemberships` relates a user to a facility with the role `owner`,
  `admin`, `trainer` or `member`.
- A tenant context requires both an active profile and an active membership.
  `X-Facility-Id` is only a selector; it cannot grant access.
- When the selector is omitted, the server may choose the oldest active
  membership. It never invents a membership or falls back to a reserved centre.
- Platform-wide authority is represented separately by an active
  `platformOperators` row created through controlled provisioning. A tenant
  membership, including an administrator membership, does not confer platform
  authority.
- Account credentials, MFA, passkeys, recovery and sessions remain
  user-global. Account-global actions do not require a facility context.

## Retired compatibility data

Older migrations used `primary` as a temporary backfill target. That decision
remains visible in the dated audits and checkpoint history below so that data
lineage is not erased.

The active migration path no longer creates that centre. Existing compatibility
profiles with noncanonical identifiers are closed and their memberships are
suspended in place so their original lineage remains visible. A current
backfill that cannot yet attribute an inherited row to a real facility uses
`legacy-import-quarantine`, which is also closed. Database triggers reject new
tenant-scoped rows unless their `facilityId` belongs to an active profile.
Quarantined data therefore remains available for a controlled ownership review
without becoming accessible to a tenant by inertia.

No automated migration may assign quarantined records to a real facility.
Reclassification requires an authorized destination, a restorable backup,
category-by-category review and cross-tenant validation.

## Integrated coverage

The repository scopes activity sessions, bookings, waitlists, session content,
reputation, billing, support, moderation, community, commercial trials, SaaS
subscription state, CRM and surveys. Administrator signup provisions an
explicit facility and owner membership after the configured verification
requirements are satisfied.

Database changes are forward migrations. Before applying them outside an
isolated test database, operators must create a PostgreSQL backup, verify that
it can be read, record the active release and keep the preceding release
available. Restoring the backup and preceding release is the rollback path;
automatic destructive down migrations are not used.

## Historical checkpoints

These references explain how the boundary evolved; they do not override the
active code or the current contract above.

- `637c831`: tenant root, memberships and the historical `primary` backfill.
- `b454e9b`: server-resolved facility context and membership authorization.
- `9c0ed2c`: facility-owned classes and negative cross-facility tests.
- `35c9e5c`: facility-scoped bookings and waitlists.
- `8479bce`: facility-scoped booking reputation.
- `608d5bf`: facility-scoped billing.
- `cc138f2`: facility-scoped support.
- `90e275a`: facility-scoped moderation.
- `31c571b`: facility-scoped community data.
- `808b0fb`: commercial trial tenant provisioning and cleanup.
- `1555188`: lifecycle isolation and remaining multi-tenant safeguards.
- `ae23459`: integration of the foundation and safeguards in `main`.
- `e449a9b`: tenant CRM and monthly analytics surveys.

These checkpoints demonstrate repository implementation and automated
coverage at their respective dates. They do not prove that an external
PostgreSQL instance has been migrated, restored and exercised with real
operational data.

## Data classification

| Category                | Scope                                           | Examples                                                                                      |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Global identity         | User                                            | credentials, MFA, passkeys, recovery, sessions                                                |
| Tenant root             | Facility                                        | facility profile, membership, commercial trial, SaaS subscription                             |
| Direct facility data    | Facility                                        | activity sessions, billing records, support queue, moderation cases                           |
| Parent-derived data     | Parent facility                                 | bookings through session, support messages through ticket, community messages through channel |
| Explicit cross-facility | Relationship                                    | facility links and approved inter-centre community connections                                |
| Platform operations     | Platform with facility context where applicable | security events, delivery jobs, retention execution and manager signals                       |

## Release gates

No phase may be presented as production-ready until all of the following hold:

1. migrations are idempotent in isolated SQLite and parsed/validated for
   PostgreSQL;
2. quarantined legacy data cannot grant access or accept new tenant writes;
3. cross-facility reads and writes are rejected by server tests;
4. `npm run ci:validate` passes;
5. a staging PostgreSQL migration, backup and restore exercise succeeds;
6. ownership of every quarantined category has been resolved or the data
   remains closed;
7. the active service, health endpoints and real schema are checked after a
   controlled deployment.

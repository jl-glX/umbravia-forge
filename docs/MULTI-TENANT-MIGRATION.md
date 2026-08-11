# Multi-tenant migration

## Purpose

Umbravia Forge currently operates as one installation with the compatibility
facility `primary`. The multi-tenant transition must preserve that behaviour
until every operational query has an explicit facility boundary and negative
cross-facility tests.

The presence of a `facilityId` column is not proof of isolation. A phase is only
complete when reads, writes, updates, deletes, background work and exported
data all enforce the same boundary on the server.

## Stable baseline

The validated baseline before this work is commit `61c3b65`. Development is
isolated from `main`, and each phase is saved only after its focused checks and
the repository validation gate pass.

Database changes are forward migrations. Before applying them outside an
isolated test database, operators must create a PostgreSQL backup, verify that
it can be read, record the active release and keep the preceding release
available. Restoring the backup and preceding release is the rollback path;
automatic destructive down migrations are not used.

## Ownership model

- `facilityProfiles` is the tenant root and retains the visible centre identity.
- `facilityMemberships` relates a user to a facility.
- Facility roles are `owner`, `admin`, `trainer` and `member`.
- Account credentials, MFA, passkeys, recovery and sessions remain user-global.
- Facility permissions must come from an active membership, not from a value
  supplied by the browser.
- The legacy `users.role` remains temporarily available during the transition;
  it must not become the source of cross-facility authorization.

## Migration phases

1. Add tenant identity and membership tables and backfill `primary`.
2. Introduce a server-resolved facility context and membership authorization.
3. Scope classes and derive bookings, waitlists and session content through the
   owning class.
4. Scope billing, facility administration and commercial trials.
5. Enforce facility boundaries in support, moderation and community data.
6. Create administrator sign-up as an atomic account, facility and owner
   membership operation after email verification requirements are satisfied.
7. Remove compatibility fallbacks only after production data and every route
   have passed isolation tests.

## Initial data classification

| Category                | Scope                                           | Examples                                                                                    |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Global identity         | User                                            | credentials, MFA, passkeys, recovery, sessions                                              |
| Tenant root             | Facility                                        | facility profile, membership, commercial trial                                              |
| Direct facility data    | Facility                                        | classes, billing records, support queue, moderation cases                                   |
| Parent-derived data     | Parent facility                                 | bookings through class, support messages through ticket, community messages through channel |
| Explicit cross-facility | Relationship                                    | facility links and approved inter-centre community connections                              |
| Platform operations     | Platform with facility context where applicable | security events, delivery jobs, retention execution and manager signals                     |

## Release gates

No phase may be presented as production-ready until all of the following hold:

1. migration is idempotent in an isolated database;
2. existing `primary` data remains usable;
3. cross-facility reads and writes are rejected by server tests;
4. `npm run ci:validate` passes;
5. a staging PostgreSQL migration, backup and restore exercise succeeds;
6. the active service, health endpoints and real schema are checked after a
   controlled deployment.

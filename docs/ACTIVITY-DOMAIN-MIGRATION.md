# Activity domain migration

## Purpose

Umbravia Forge supports facilities whose scheduled services are not always
described as gym classes. Yoga, pilates, personal training, multidisciplinary
centres and custom facilities need the same operational model without inheriting
fitness-specific technical names.

This migration makes `activitySession` the canonical internal term. Visible
labels remain localizable: a facility may still present an activity session as
a class, course, appointment, practice or another configured term.

## Integrated baseline and restoration

The validated baseline before this work is commit `e449a9b` and the annotated
restore tag is `restore/pre-domain-neutralization-20260816`. The migration is
now integrated in `main`; `activitySession` and the neutral API paths are the
canonical contracts, while the former branch name remains historical context.

The baseline passed `npm run ci:validate` before the branch and tag were
created, and the integrated code retains focused migration and compatibility
tests. No security configuration, credentials, key material or production
database was changed while establishing the checkpoint.

Database changes are forward-only and idempotent. Before applying them outside
an isolated database, operators must create and verify a PostgreSQL backup,
record the active release and preserve the preceding release. Restoring that
backup together with the preceding release is the rollback path; destructive
down migrations are not used.

## Canonical names

| Legacy technical name        | Canonical technical name               |
| ---------------------------- | -------------------------------------- |
| `GymClass`                   | `ActivitySession`                      |
| `gymClasses`                 | `activitySessions`                     |
| `ClassBookingConfiguration`  | `ActivitySessionBookingConfiguration`  |
| `classBookingConfigurations` | `activitySessionBookingConfigurations` |
| `ClassSessionContent`        | `ActivitySessionContent`               |
| `classSessionContents`       | `activitySessionContents`              |
| `classId`                    | `activitySessionId`                    |
| `/api/classes`               | `/api/activity-sessions`               |
| `/api/admin/classes`         | `/api/admin/activity-sessions`         |

User-facing routes and translations are not database contracts. They may retain
words such as `classes` when those are the clearest labels for the selected
facility and language.

## Compatibility boundary

The neutral endpoints are canonical. During one controlled compatibility
window, the server may expose the legacy HTTP paths as aliases so a cached
client from the preceding release can complete requests while a deployment is
converging.

Compatibility code must remain at the HTTP boundary. Services, database types,
queries and new tests must use only the canonical names. Legacy aliases must:

1. call the same neutral router rather than duplicate business logic;
2. emit deprecation and successor-link headers;
3. be covered by a focused compatibility test;
4. be removed only after production access logs show that the preceding client
   release is no longer in use.

Request-body compatibility follows the same rule: a boundary parser may accept
legacy `classId`, but it must normalize immediately to `activitySessionId`.
Canonical responses do not introduce new legacy fields.

## Migration order

1. Verify the stable baseline and restoration tag.
2. Rename PostgreSQL tables, columns, constraints and indexes in an idempotent
   migration.
3. Upgrade an existing SQLite database before current-schema creation runs;
   new SQLite databases are created directly with canonical names.
4. Change the typed database map and services to the canonical schema.
5. Mount the neutral APIs and retain only the isolated HTTP aliases described
   above.
6. Move the client and tests to the neutral APIs and payloads.
7. Validate fresh-schema creation, legacy-schema upgrade, preserved rows,
   foreign keys, uniqueness constraints and tenant isolation.

## Data and isolation invariants

- Every activity session retains the same identifier, facility, trainer,
  schedule, capacity and related rows after the rename.
- Bookings, waitlists, session content, progress and analytics remain attached
  to the same activity session.
- The migration must not synthesize or discard operational records.
- Facility authorization continues to be resolved by the server; renaming an
  identifier must not weaken tenant boundaries.
- Existing unique active-booking and waitlist constraints remain equivalent.
- A migration may be rerun safely after partial deployment recovery.
- A multi-day creation is a transaction over independent activity sessions,
  not one booking shared across several dates. Per-session booking opening
  timestamps are stored in `activitySessionBookingConfigurations` and enforced
  by the booking service before capacity or waitlist changes occur.

## Release gates

No phase is considered ready for production until all of the following hold:

1. a legacy SQLite fixture upgrades without data loss and a fresh SQLite schema
   contains only canonical activity-domain tables and columns;
2. the PostgreSQL migration is idempotent in an isolated database;
3. focused route tests prove both the canonical endpoint and the temporary
   alias use the same tenant authorization;
4. repository searches find legacy database names only in immutable migration
   history, the upgrade adapter, compatibility tests and this document;
5. `npm run ci:validate` passes;
6. staging has a verified backup before migration and its real schema, active
   service and health endpoints are checked after controlled deployment.

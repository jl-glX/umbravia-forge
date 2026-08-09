# Umbravia Forge

Umbravia Forge is a modular gym-management application for classes, bookings, waitlists, users, trainers and activity analytics. The responsive interface supports Spanish, English, German and Swiss Standard German.

> Project status: active development. Umbravia Forge is not yet ready for commercial production or real payments.

## Current capabilities

- Account registration and persistent, revocable sessions.
- Versioned legal acknowledgements and six-digit email verification with a
  provider-neutral SMTP transport.
- Member, trainer and administrator permissions enforced by the API.
- Class calendar, capacity, bookings and FIFO waitlist promotion.
- Member, trainer and administrator dashboards.
- User and class administration.
- Attendance export to CSV.
- Spanish, English, German and Swiss Standard German interface with persisted language selection.
- Public legal notice, terms and conditions, and conditions of use drafts.
- Security headers, restricted CORS, request limits, rate limiting and input validation.
- Public support IDs, reversible account-closure scheduling and draft-only
  retention policies for demonstration.
- Product-first commercial foundation with an editable 31-day trial and a
  non-destructive data-classification draft.
- Forge Support tickets with private conversations, staff-only notes, SLA
  targets, protected attachments, a knowledge base and auditable triage.
- A first-party transactional queue with encrypted payloads, bounded retries,
  delivery tracing and coordinated maintenance.

## Technology

- React 19, TypeScript 6, Vite 8 and Tailwind CSS 4.
- Node.js 24 LTS, Express 5 and Kysely.
- PostgreSQL as the primary engine for staging and production, with SQLite
  reserved for local development, automated tests and isolated commercial demos.
- Vitest, ESLint and Prettier.

## Start locally

```bash
npm ci
npm run dev
```

One command starts both the frontend and API. By default:

- Frontend: <http://127.0.0.1:3000>
- API: <http://127.0.0.1:3001>

Copy `.env.example` to `.env` only when local overrides are needed.

## Quality checks

```bash
npm run format       # apply Prettier
npm run format:check # verify formatting without changing files
npm run lint
npm run typecheck
npm run test
npm run test:watch # persistent cross-platform test session for development
npm run build
npm run check        # run the complete validation sequence
npm run security:probe # local-only black-box probe; requires a running API
npm run security:password-resilience # synthetic bcrypt laboratory check
```

## Documentation

- [Development guide](./DEVELOPMENT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Security](./docs/SECURITY.md)
- [Integral security audit standard](./docs/SECURITY-AUDIT-STANDARD.md)
- [Latest integral black/gray/white-box assessment](./docs/SECURITY-AUDIT-2026-08-05.md)
- [Initial local black/gray/white-box assessment](./docs/SECURITY-ASSESSMENT-EXTREME-2026-08-01.md)
- [Account lifecycle foundation](./docs/ACCOUNT-LIFECYCLE.md)
- [Legal readiness checklist](./docs/LEGAL-READINESS.md)
- [Commercial foundation audit](./docs/COMMERCIAL-FOUNDATION-AUDIT.md)
- [Self-hosted production readiness](./docs/SELF-HOSTED-PRODUCTION.md)
- [Forge Notify and transactional email](./docs/FORGE-NOTIFY.md)
- [Forge Support](./docs/FORGE-SUPPORT.md)

## Demo data

Development mode seeds demonstration accounts and classes. Demo credentials are shown on the sign-in page and must never be enabled in production. The server now rejects a production startup when `SEED_DEMO_DATA=true` instead of creating accounts with public passwords.

## Known limitations

- The shared database client now selects PostgreSQL in staging/production and
  SQLite in explicitly isolated environments. PostgreSQL still requires an
  authorized integration test, backup and restoration exercise before launch.
- SQLite-to-PostgreSQL promotion currently provides inventory and a guarded
  review plan. It deliberately does not transfer identity, billing, community
  or authentication data without a separately approved migration procedure.
- Commercial trials still use a single shared centre and remain disabled by
  default in production until tenant isolation is implemented.
- Password recovery remains pending. Email verification is implemented through
  the encrypted Forge Notify queue and SMTP; production fails closed until a
  relay or local mail transfer agent is configured. Optional two-factor
  authentication remains a separate account-security capability.
- Payments, subscriptions and refunds are not implemented.
- Legal pages are drafts and still require real contact, tax and business information plus professional review.
- Forge Notify currently covers transactional account and support email. Push,
  SMS, inbound email parsing and real-time support updates are not implemented.

## Ownership and licence

Umbravia Forge is owned and operated by Javier López Díaz. The repository currently has no open-source licence; reuse rights are not granted by default.

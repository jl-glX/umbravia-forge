# Security

The latest integral black-box, gray-box and white-box assessment is documented
in [SECURITY-AUDIT-2026-08-05.md](./SECURITY-AUDIT-2026-08-05.md).

Future reviews follow the
[`SECURITY-AUDIT-STANDARD.md`](./SECURITY-AUDIT-STANDARD.md) internal standard.
The initial local black-box, gray-box and white-box assessment is documented in
[`SECURITY-ASSESSMENT-EXTREME-2026-08-01.md`](./SECURITY-ASSESSMENT-EXTREME-2026-08-01.md).
The related hardening review remains available in
[`SECURITY-AUDIT-2026-08-01.md`](./SECURITY-AUDIT-2026-08-01.md).

## Account protection

Umbravia Forge supports TOTP two-step verification with common authenticator apps,
single-use recovery codes, revocable server-side sessions, WebAuthn passkeys and
a recent security activity log. MFA secrets are encrypted with AES-256-GCM and
recovery codes are stored as keyed hashes. Production deployments must provide
a unique `MFA_ENCRYPTION_KEY`; it must not be committed or shared between
unrelated environments.

Security configuration is treated as protected persistent state. Environment
files, provider keys, certificates and signing material must not be removed or
replaced by source cleanup or release automation. Any justified rotation or
migration requires an impact review, a recoverable protected copy and explicit
validation of the replacement before the previous material is retired.

The implementation uses browser standards and responsive web controls, so the
same flow is available in current browsers on Windows, macOS, Android and iOS.
Physical-device and native-app verification is still required before claiming
platform certification. Umbravia Forge does not store passwords or session tokens
in browser storage. WebAuthn delegates biometric or PIN verification to the
device; Umbravia Forge stores a public credential, never a fingerprint, face
template or device PIN.

## Delegation history

Active permissions and accepted delegations remain visible while they can be
used. Inactive delegation history is visible to each participant for up to 30
days and can also be cleared manually from that participant's view.

Clearing history is not permission revocation and never removes an active
delegation. Each participant has independent visibility: a row is physically
removed only after no participant still needs it. This keeps the everyday
account view compact without using display cleanup as a substitute for a
security audit or a future legally required record.

## Authentication portals

Umbravia Forge presents members and centre staff with separate sign-in portals. The
member portal accepts only member accounts. The staff portal accepts trainer
and administrator accounts and can identify a centre account by its corporate
email address or registered centre phone number. This separation is enforced
by the API as well as the interface; choosing a different portal cannot elevate
an account's role or permissions.

## Human verification

Signup, password login, passkey initiation, feedback and generic protected
forms use Cloudflare Turnstile. The browser renders the challenge explicitly
and sends its short-lived token with the protected request. The API validates
every token with Cloudflare and, in production, checks both the expected action
and the configured trusted hostname.

`VITE_TURNSTILE_SITE_KEY` is public and belongs in the frontend build
environment. `TURNSTILE_SECRET_KEY` is private and belongs only in the server
environment. Production rejects missing, placeholder and official test keys.
This control does not prove mailbox ownership: email verification, MFA,
session controls, rate limiting and monitoring remain independent layers.

## Implemented baseline

- Password hashing with Argon2id (`m=19456`, `t=2`, `p=1`). Existing bcrypt
  hashes remain readable only for a gradual upgrade after valid authentication.
- Password policy of at least 12 characters, uppercase, lowercase and digits,
  with a hard maximum of 1024 UTF-8 bytes to bound request and hashing cost.
- Opaque random session tokens; only their SHA-256 hashes are stored.
- Persistent, expiring and revocable database sessions.
- Browser-session cookies by default, plus optional remembered sessions with an explicit 30-day expiry and server-side revocation.
- WebAuthn passkeys requiring user verification for passwordless sign-in.
- `HttpOnly`, `SameSite=Strict` session cookies and `Secure` cookies in production.
- Server-side authentication and role authorization.
- Helmet protections, production CSP and HSTS.
- Restricted CORS with credentials.
- Server-side origin checks for state-changing API requests.
- Passkey challenges bound to configured trusted origins and RP IDs.
- API and authentication rate limits.
- Server-validated Cloudflare Turnstile on signup, password login, passkey
  initiation, feedback and generic protected forms.
- Hashed, expiring email-verification codes with bounded attempts.
- AES-256-GCM encryption for pending transactional-email payloads, with
  bounded retry, stale-job recovery and delivery tracing.
- Versioned XChaCha20-Poly1305 encryption at rest for private community
  justifications and Forge Support attachments when the private-content
  profile is enabled; legacy plaintext remains readable for controlled
  migration.
- TLS 1.3 enforced by Caddy at the application origin. Ordinary community
  messages remain server-readable for moderation and are not represented as
  end-to-end encrypted.
- Forge Support authorization, private attachments, staff-only notes and an
  auditable ticket event history.
- Small configurable request bodies and centralized error handling.
- Input validation and automated security tests.
- Local databases and environment files excluded from version control.
- SQLite foreign-key enforcement and transactional reservation changes.
- Spreadsheet-formula neutralization in attendee CSV exports.

## Production work still required

- Operational validation of SMTP delivery, bounce handling, DKIM/SPF/DMARC,
  suppression and sender reputation before inviting real users at scale.
- Optional enforcement of 2FA or passkeys for privileged roles.
- Physical verification of passkeys on representative Android, iOS and macOS devices.
- CSRF review if cross-site deployment requirements change.
- Deployment proxy and HTTPS configuration review.
- Versioned database migrations, encrypted backups and retention rules.
- Expansion of audit coverage for every sensitive administrative operation.
- Monitoring, alerting and a documented incident-response process.
- Secret management outside local `.env` files.

## Reporting a vulnerability

The repository owner is Javier López Díaz. A dedicated security contact and private reporting channel must be added before the repository or service is made public.

Do not disclose active vulnerabilities in a public issue when a private reporting channel is available.

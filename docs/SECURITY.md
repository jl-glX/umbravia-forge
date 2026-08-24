# Security

The latest integral black-box, gray-box and white-box assessment preserved in
the repository is the historical review of 12 August 2026, documented in
[SECURITY-AUDIT-2026-08-12.md](./SECURITY-AUDIT-2026-08-12.md). The manager
console received a later, narrower review in
[MANAGER-CONSOLE-SECURITY-AUDIT-2026-08-15.md](./MANAGER-CONSOLE-SECURITY-AUDIT-2026-08-15.md).
The code, versioned infrastructure, documentation and interface contracts
affected by the Stripe and commercial-capability work received a narrower
readiness review on 21 August 2026 in
[INTEGRAL-READINESS-AUDIT-2026-08-21.md](./INTEGRAL-READINESS-AUDIT-2026-08-21.md).
It is not a new production black-box assessment and does not replace live
environment verification.

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

Passkey registration requires the current account password before a
session-bound WebAuthn challenge is issued. Expected password, expired
challenge and device-registration failures return stable error codes which the
interface translates instead of exposing raw server messages. Local automated
coverage verifies the same-password confirmation path, but physical validation
on the deployed Android origin remains a separate release check.

Session inactivity and maximum lifetime are independent limits. The account
preference controls how long a session may remain idle. A non-remembered
session still has a 24-hour absolute lifetime and a session explicitly
remembered at sign-in has a 30-day absolute lifetime; whichever deadline occurs
first closes the session. The security screen labels whether the next deadline
comes from inactivity or from that absolute lifetime.

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

Umbravia Forge presents members, centre staff and corporate UMF Support with
three separate sign-in portals. The member portal accepts member accounts. The
facility staff portal accepts trainer and administrator accounts. The corporate
portal accepts only personnel approved in UMF Support. A centre administrator
or commercial platform operator is not corporate support staff, and corporate
support membership grants no facility context. Commercial and corporate
identities have distinct realm values and cookies, even when they use the same
email address. Passwords, recovery challenges, MFA/passkey challenges and
sessions remain separate. This boundary is enforced by the API as well as the
interface; choosing a different portal or replaying the other application's
cookie cannot elevate an account's role or permissions.

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
- Browser-session cookies by default, plus optional remembered sessions with
  an explicit 30-day expiry and server-side revocation.
- A configurable server-enforced inactivity limit, displayed separately from
  each session's 24-hour or 30-day absolute lifetime.
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
- Adaptive confirmation for full account closure: password plus TOTP when it is
  enabled, password plus a session-bound verified-email code when it is not, or
  the email code (and enabled TOTP) when no usable local password exists.
- Account email replacement only after password confirmation and a distinct
  bounded code delivered to the new mailbox; facility administrators cannot
  bypass this flow by editing the user record.
- AES-256-GCM encryption for pending transactional-email payloads, with
  bounded retry, stale-job recovery and delivery tracing.
- Versioned AES-256-GCM encryption at rest for private community content,
  Forge Support bodies and attachments when the private-content profile is
  enabled; legacy XChaCha20-Poly1305 envelopes and plaintext remain readable
  for controlled migration.
- TLS 1.3 enforced by Caddy at the application origin. Ordinary community
  messages remain server-readable for moderation and are not represented as
  end-to-end encrypted.
- Forge Support authorization, private attachments, staff-only notes and an
  auditable ticket event history.
- UMF Support self-registration creates an independent corporate password and
  `corporate_support` identity and requires the ordinary hashed
  mailbox-verification challenge. Verification grants only access to the
  account's own security centre; it does not create support staff, a company
  position, facility membership or commercial authority. Active direction
  must approve later administrators. The first head is the sole exception and
  is limited to a mailbox hash designated outside the repository. Historical
  preauthorization and activation-code rows authorize nothing in the current
  flow. MFA-compatible sign-in, encrypted message bodies,
  HMAC-authenticated inbound email and security events remain independent
  controls. Corporate registration creates no facility membership, never
  transfers authority from a commercial identity and fails closed in
  production when private-content encryption is not active.
- Corporate mail attachments and centre ticket attachments use separate
  tables, storage domains and authorization. Extension and MIME must both
  match an explicit allowlist; GIF and executable formats are rejected. PDF
  and compatible raster previews are served only after authorization with
  `nosniff` and isolated rendering. Inbound corporate messages with
  attachments remain rejected until an equivalent ingestion path is built and
  validated.
- Account-facing security activity is bounded to thirty days. The existing
  hourly lifecycle scheduler purges older `securityEvents` for every event
  type; this is a product-history retention rule, not a substitute for any
  separate operational or legal evidence that must be retained elsewhere.
- Manager administration is not exposed in either web application. One local
  Linux administrator serves the shared manager infrastructure and every
  operation must carry an explicit `commercial` or `support` scope. It rejects
  `root`, requires the local user in `UMF_MANAGER_ADMIN_LINUX_USERS` and then
  checks scope-specific application authority. Support access additionally
  requires an active corporate director and active platform-head position;
  commercial operator status is not accepted as a substitute.
- Transactional email rows and manager signals carry the same explicit scope.
  A support retry or failure cannot surface in the commercial administrator
  view, and legacy rows are not reclassified from recipient data alone.
- The historical Windows launcher contains no credentials, runs without
  elevation and delegates authentication to the canonical HTTPS origin, but it
  is not a current UMF Support distribution channel. Re-enabling it requires a
  separate signing and human-validation decision.
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
- Operational validation of the versioned PostgreSQL migrations, encrypted
  backups, restoration and retention rules in every authorized environment.
- Expansion of audit coverage for every sensitive administrative operation.
- Monitoring, alerting and a documented incident-response process.
- Secret management outside local `.env` files.
- Code signing, SmartScreen and clean-device validation for the Windows test
  package before it can be presented as a stable distribution.

## Reporting a vulnerability

The repository owner is Javier López Díaz. The source repository is public, but
a dedicated private security contact and a documented incident-response channel
are still required before a general commercial launch.

Do not disclose active vulnerabilities in a public issue when a private reporting channel is available.

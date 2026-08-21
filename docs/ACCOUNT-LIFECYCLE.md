# Account lifecycle foundation

This document describes the technical foundation used to demonstrate account
identity, closure and data-retention flows. It is not a legal policy and does
not define production retention periods.

## Scope of the demo

The current implementation can demonstrate:

- a stable internal account identifier that is never shown as a credential;
- a public support identifier that can be shown, copied and rotated;
- an optional user-selected inactivity period;
- a guided review where the user can select particular data categories without
  closing the account;
- a reversible account-closure request with a 30-day grace period;
- cancellation of a scheduled closure;
- administrator-created, versioned retention-policy drafts with an internal
  review state;
- non-executable account-deletion jobs that remain blocked until data has been
  classified;
- limited account-representation drafts for continuity situations, without
  transferring identity or credentials;
- internal extension points for retained records, legal holds and future
  deletion candidates.
- progressive personal signup with surname, jurisdiction, preferred language
  and versioned acknowledgements;
- hashed, expiring email-verification challenges with attempt limits;
- verified email changes requiring the current password and a separate,
  hashed six-hour challenge sent to the new inbox; the original address stays
  active and receives an immediate recovery warning, while expiry cancels the
  request automatically; completion revokes other sessions and obsolete
  temporary challenges and queues a second notice to the old address;
- a confirmed-compromise action that revokes secondary sessions and pending
  challenges, marks the account for review and rotates the support alias;
- a recovery centre with passkey access and an email-code password-reset flow:
  identifiers are resolved without revealing account existence, challenges are
  hashed, expiring, single-use and attempt-limited, password reuse is rejected,
  and a successful reset revokes sessions and pending challenges;
- cancellation of a scheduled deletion as part of a successful owner recovery;
- Cloudflare Turnstile challenges for signup, password login and passkey login,
  with every token validated by the server;
- queued transactional verification email with encrypted pending payloads,
  bounded retries and delivery tracing;
- a five-attempt delivery ceiling: once exhausted (or after expiry), retries
  stop and both recipient and message content are erased immediately. A
  minimal terminal result remains for 30 days so failures are not reported as
  successful deliveries and can still be audited.

The demo deliberately does not:

- delete or anonymize user data;
- suspend account access when a closure is scheduled;
- treat an internal policy review as legal approval;
- transfer an account identity, credentials or personal history to a
  representative;
- execute deletion jobs or retained-record actions;
- decide which law applies to a user or a record;
- claim that a retention duration or legal basis is valid;
- replace professional legal review.
- complete support-assisted recovery;
- automatically remove passkeys after a reported compromise.

Each protected request obtains a short-lived Turnstile token in the browser.
The server validates the token with Cloudflare and checks its intended action
and trusted hostname in production. Rate limits, email ownership, MFA and
monitoring remain separate controls.

## Progressive account creation

Personal account creation remains separate from joining or creating a sports
centre. The server stores the selected jurisdiction and locale together with
the exact draft versions acknowledged at signup. New accounts remain
`pending_verification` until the mailbox challenge is completed. Codes are
scoped to the user, stored as hashes, expire after 15 minutes and stop after
five failures. Production rejects a configuration that disables this control
or lacks SMTP and queue encryption.

## Corporate support pre-enrolment

UMF Support does not use the sports-centre signup path. Its public request
collects a name, email address and password with local confirmation, but
persists that password only as a separate Argon2id hash. The pre-enrolment
credential expires after seven days and is removed on rejection, activation,
expiry or lockout. Approval never exposes the hash.

Activation requires the same normalized email, the same password and the
bounded code sent after approval. The designated first company head receives
that code automatically only while no corporate initialization has ever
existed; every later account requires manual review. A successful activation
marks the mailbox as verified because the code was delivered there, creates
the corporate support membership and creates no `facilityMemberships` row.

## Reported account compromise

The authenticated security panel can begin a security review after password
confirmation and, when enabled, a valid MFA or recovery code. It keeps the
current verified session so the owner can continue remediation, while closing
other sessions, invalidating pending authentication challenges, rotating the
public support ID and recording security events. It does not silently remove
passkeys because the user still needs to review which authenticators are
legitimate.

## Verified account email changes

The authenticated account-security screen accepts a new sign-in address only
after confirming the current password. It stores a hashed six-digit challenge
for six hours and sends the code exclusively to the new inbox. The account
continues to use the original verified address until that challenge is
consumed successfully.

Starting the process immediately queues a warning to the current address with
a link to `/recover-account`. If the code is not verified in time, the enabled
authentication cleanup removes the challenge within its 30-minute cycle and
erases any still-pending verification delivery; attempting to use an expired
code also performs the same cleanup. The owner can cancel the pending request
from the screen, with the same preservation of the original address.

Successful verification changes the address once, revokes every other session,
invalidates obsolete authentication and recovery challenges, and queues a
second warning to the previous address. These repository guarantees do not by
themselves demonstrate live SMTP delivery or a running cleanup manager in a
deployed environment.

## Recovery foundation

`/recover-account` exposes the implemented passkey route and the email-code
password-reset flow. A request can start from email, username or public support
ID without disclosing whether the account exists. Codes expire, have bounded
attempts and are consumed once; the new password cannot reuse the current
credential. A successful reset revokes existing sessions and challenges,
rotates the public support ID and cancels a scheduled deletion so the verified
owner can regain access. Merely opening the page or requesting a code does none
of those things.

Support-assisted recovery remains unavailable until identity evidence,
operator permissions, escalation, audit and abuse controls are defined.

## Account continuity and representation

The continuity module allows the owner to prepare a limited representation
draft for hospitalization, temporary or permanent incapacity, death or another
documented continuity reason. A representative receives only explicitly
selected scopes, an optional end date and a temporary or permanent designation.

This foundation never changes the account owner, shares credentials, enables
impersonation or grants blanket access to the profile. Draft creation and
revocation are auditable, while activation and documentary verification remain
future controlled processes.

## Data review before account closure

The inactivity preference remains on the account-lifecycle screen. Manual data
and account actions begin from a single **Delete my data and account** entry
point so that a user can review the consequences before choosing an action.

The review screen offers two distinct intentions:

- select one or more data categories and save a data-deletion request draft
  without closing the account;
- schedule closure of the complete account using the existing 30-day grace
  period.

Saving a selective request does not delete data. It records the categories and
the user's intention so a future verified request workflow can evaluate
ownership, dependencies, applicable retention rules and execution results.

The screen also explains that some records may need to remain restricted for a
legal or operational reason. This is intentionally general: the demo does not
state final legal bases, jurisdictions or retention periods.

## Separation of identifiers

An account has two different identifiers:

| Identifier          | Purpose                                                        | Lifecycle                   |
| ------------------- | -------------------------------------------------------------- | --------------------------- |
| Internal account ID | Database relationships and audit continuity                    | Immutable and not public    |
| Public support ID   | Help the user identify the account to authorized support staff | Can be revoked and replaced |

A public support ID is an alias, not a password, session token or proof of
ownership. Rotating it must not change the internal account ID or break
historical audit relationships.

## Account lifecycle states

The shared lifecycle vocabulary is:

```text
pending_verification | active | security_review | recovery_in_progress
inactive | suspended_pending_deletion | deletion_cancelled
closure_requested | deletion_processing | retained_legal | legal_hold
anonymized | deleted
```

Only states backed by current behaviour are derived automatically. A manual
closure request becomes `closure_requested`; an inactivity-triggered request is
shown as `suspended_pending_deletion`; otherwise the stored account state is
reported. Scheduling also creates a deletion job in
`blocked_retention_review` with execution explicitly disabled. Cancelling the
request cancels that job.

The remaining states are a stable contract for future services, not simulated
transitions. A production design must separately authorize what is deleted,
anonymized, retained under restriction or blocked from ordinary use.

Only an authenticated action by the account owner should cancel a scheduled
closure. Merely opening an email link or receiving an automated request must
not count as proof of control.

## Inactivity preference

The user may choose an inactivity period or disable automatic scheduling. The
current scheduler can create the same reversible closure request and blocked
deletion job when the threshold is reached. It never executes deletion.

Before enabling that automation, define and test:

- which user actions reset the inactivity timer;
- which server-side jobs must not reset it;
- warning channels and delivery failures;
- recovery during the grace period;
- active subscriptions, disputes and other closure blockers;
- accessibility and support-assisted recovery.

## Versioned retention policies

An administrator can create a policy with:

- a descriptive name;
- a jurisdiction label;
- a data category;
- an optional draft duration;
- an optional reference that still requires review.

Policies are versioned by jurisdiction and data category. An administrator can
mark a version active or retired only after an explicit internal review. An
active version requires a duration and reference; activating it retires an
older active version for the same jurisdiction and category.

This status is operational metadata, not legal approval. Every policy reports
`legalValidationProvided: false`, and execution remains disabled.

The current classification catalogue covers account profile, preferences,
bookings, sessions, authentication factors, delegations, billing records and
security events. The first six categories default to delete or anonymize;
billing and security data can only be retained when an applicable reviewed
policy actually requires it.

The server contains narrow internal helpers for future work:

- register a record only against an active, reviewed policy;
- place or remove a legal hold;
- find expired records that are not on hold.

These helpers exist to make future responsibilities visible and testable. They
are not connected to an automatic deletion worker.

## Module collaboration

Account closure and retention remain separate modules because they answer
different questions, but they are not isolated:

- the lifecycle service asks the retention service for a disposition preview;
- the data-review screen presents closure choices and data classification
  together;
- active policies, draft policies and unclassified categories produce
  different review states;
- linked retention records can be counted without exposing their contents;
- both modules keep execution disabled until the future review and executor
  exist.

This boundary prevents closure scheduling from containing legal-policy logic,
while still giving the user and future operators one coherent workflow.

## Future execution contract

A later implementation should keep decision-making and execution separate:

```text
reviewed policy
  -> classify record
  -> calculate review date
  -> evaluate blockers and legal hold
  -> create auditable action proposal
  -> authorized execution
  -> record outcome
```

The executor should be idempotent, produce an audit trail, tolerate partial
failures and never infer legal rules from a country code alone.

## Confirmed product decisions

- The internal account ID is immutable and never acts as a credential.
- The public support ID is a rotatable alias and does not prove ownership.
- Account identity is never transferred to a representative.
- Representation is scoped, revocable and separately verifiable.
- Manual closure includes a 30-day grace period and remains reversible before
  execution.
- Selective data deletion and full account closure are separate intentions.
- Retention is configurable and versioned; it is not one hard-coded timer.
- Legal holds override ordinary expiration until explicitly released.
- Destructive execution stays disabled until classification, authorization and
  auditing are complete.
- Sensitive authenticated forms require a recent human-verification session;
  direct API requests are subject to the same gate.

## Open product and legal decisions

The following items deliberately remain unresolved rather than being guessed:

- final public support-ID format and rotation policy;
- selectable inactivity periods and the exact definition of meaningful
  activity;
- roles and authentication strength required for each lifecycle operation;
- evidence and review procedure for incapacity, death and legal
  representation;
- countries and controller arrangements supported at launch;
- validated retention rules, purposes and legal bases per data category;
- irreversible anonymization strategy and collision risks;
- final retention period for security audit events;
- operational responsibility for review, authorization and execution;
- data export scope, format and delivery controls;
- final user interface, notifications, accessibility and recovery handling.

## Documentation still pending

Before a public or commercial release, the legal notice, privacy policy and
terms of use must be updated together with the final product behaviour. That
future review must cover at least:

- purposes and lawful bases for each data category;
- final retention criteria and applicable jurisdictions;
- account closure, recovery, restriction and deletion behaviour;
- data retained for legal obligations or claims;
- processors, recipients and international transfers;
- user rights and verified request channels;
- consequences for invoices, security logs and active disputes;
- revision dates, change notices and renewed consent where required.

Do not copy the illustrative durations from the demo into legal documents
without a separate legal and operational review.

## Historical email-record sanitation

Transactional email delivery keeps operational status and attempt counters so
that delivery problems can be diagnosed without retaining message content
indefinitely. A managed sanitation task now applies the following boundary:

- the resource manager owns the schedule and conflict prevention;
- the email manager performs the sanitation and confirms the result;
- the first deployment runs one review when no prior execution marker exists;
- later reviews are due 30 days after the last completed review, including
  across application restarts;
- only terminal `sent`, `failed` and `superseded` records are stripped;
- queued, retrying and processing messages remain untouched;
- recipient addresses and encrypted payloads are removed, while delivery kind,
  outcome, attempt count, timestamps and safe failure codes remain available;
- the persistent audit marker stores only the sanitized count and interval, not
  message identifiers, recipients or content.

The schedule is implemented inside the existing resource manager rather than
as an operating-system script or an additional system timer. Long waits are
split internally to avoid the runtime timer limit while preserving one exact
30-day due date.

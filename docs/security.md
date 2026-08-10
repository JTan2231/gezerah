# Security and trust boundaries

## Current deployment classification

As of 2026-08-09, dnd has a public-addressable Railway preview backed by
managed PostgreSQL. It is not designated public production, and no
public-release gate or production-audience commitment has been opened. The
conditions in this document therefore remain requirements before broader or
real-user use; reachability and a healthy smoke check do not satisfy them.

dnd now has native username/password authentication and revocable
server sessions. A caller-supplied user UUID is not an authentication mechanism:
the former `X-DND-User-ID` adapter and public user directory are gone. Health,
signup, and signin are the explicit public API exceptions; every other product
endpoint derives its actor from a valid session.

This closes the direct impersonation gap identified in the identity audit. The
active preview has Railway HTTPS termination and an exact external
`DND_PUBLIC_ORIGIN`, but broader public use still needs deployed secure-cookie
verification, backups, monitoring, capacity/abuse testing, and an explicit
support policy. The account model intentionally collects no email and therefore
provides no password recovery.

## Authentication model

### Accounts and passwords

- Signup accepts `username`, `display_name`, and `password`; no email address is
  requested or stored.
- Usernames are 3–64 ASCII characters, begin with a letter or number, and may
  otherwise contain letters, numbers, `.`, `_`, and `-`.
- The chosen casing is preserved for display; normalized lowercase usernames
  are unique and signin is case-insensitive.
- New passwords must contain at least 8 Unicode code points.
- PostgreSQL stores only an Argon2id PHC string with a random salt. The current
  work factor is 19 MiB, two iterations, and one lane; supported hashes are
  parsed with explicit parameter and decoded-length bounds.
- Unknown usernames, wrong passwords, and disabled accounts receive the same
  signin error. A fixed dummy Argon2id verification reduces username timing
  disclosure.
- Successful verification can upgrade an older supported hash to the current
  work factor.

There is no email recovery, security question, password hint, MFA, OAuth/OIDC,
administrator account-claim flow, or seeded account. Password change requires
the current password and revokes all earlier sessions before issuing one
replacement session.

### Sessions

Signup/signin creates 32 random bytes and puts their unpadded URL-safe encoding
in an HttpOnly cookie. The database stores only the SHA-256 digest of that raw
token. A session has a seven-day sliding idle expiry, a 30-day absolute expiry,
and an explicit revocation timestamp. Disabled users cannot authenticate an
otherwise valid session.

Every authenticated request checks the session and account read-only. Ordinary
activity attempts a database-guarded touch only when `last_seen_at` is at least
five minutes old; that update repeats token, revocation, expiry, and
active-account predicates, so it cannot revive an invalid session. Opening an
SSE stream follows the ordinary path once. Its subsequent 1.5-second
reauthorization checks are read-only, so merely holding a stream open does not
extend idle expiry. Revocation, expiry, or account disablement closes the stream
on its next reauthorization cycle.

Session creation serializes per account, removes expired/revoked rows, and
retains at most 20 active sessions including the newly issued one. Crossing the
cap invalidates the least recently seen sessions.

The storage shape is enforced by migration constraints and targeted contract
reads of `users.password_hash` and `auth_sessions.token_hash` for signup-created
fixtures. Those reads verify the inspected rows; they are not an exhaustive
inspection of PostgreSQL or platform diagnostic logging.

Loopback-only local HTTP uses `dnd_session`. HTTPS uses `__Host-dnd_session`, which is
`Secure`, host-only by construction, and scoped to `/`. Both variants are
`HttpOnly` and `SameSite=Lax`; logout clears both names. Configured non-loopback
HTTP origins are rejected, and an unset origin fails closed to secure cookies
unless both the request host and network peer are loopback. Configure the exact
external HTTPS origin in `DND_PUBLIC_ORIGIN` when deploying behind a proxy.

`POST /api/auth/logout` revokes the current session. `POST
/api/auth/logout-all` revokes every active session for the account. Password
change does the same before creating its replacement. Revocation/expiry is
checked in PostgreSQL rather than trusted from the cookie.

### Origin and CSRF

Every unsafe authenticated request requires both:

- one `Origin` header exactly matching `DND_PUBLIC_ORIGIN`, or the request's own
  scheme and host when the setting is empty (with plain HTTP requiring both a
  loopback request host and loopback network peer); and
- `X-DND-CSRF` equal to a token derived with a domain-separated SHA-256 digest
  from that session's random token.

Signup and signin also require the exact origin, although they do not require a
preexisting CSRF token. The CSRF value is returned by signup, signin, `GET
/api/me`, and password change. The React client keeps it in module memory only;
it is neither a cookie nor browser storage. A page reload reacquires it through
`GET /api/me` using the HttpOnly session cookie.

The server does not emit permissive CORS headers. Browser security headers
include a same-origin Content Security Policy, frame denial, MIME sniffing
protection, no-referrer policy, a restrictive permissions policy, and HSTS when
the request/public origin is HTTPS. Authenticated and authentication responses
are `private, no-store` and vary on `Cookie`.

## Endpoint trust matrix

| Surface                             | Gate                                            | Additional authority                                                      |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| SPA/static assets                   | Public                                          | Content only.                                                             |
| `GET /api/health`                   | Public                                          | Database readiness only.                                                  |
| Signup/signin                       | Exact origin + in-memory throttle               | Creates a user/session or verifies credentials.                           |
| `GET /api/me`                       | Active session                                  | Returns current user and session CSRF token.                              |
| Logout/password change              | Active session + origin + CSRF                  | Revokes current/all sessions as documented above.                         |
| Invite preview                      | Active session + opaque bearer token            | Exposes active invite/world metadata.                                     |
| Invite redemption                   | Session + origin + CSRF + bearer token          | Creates/reactivates one membership; never changes an already-active role. |
| World list/read                     | Active session + active membership              | Returns only worlds for the session user.                                 |
| World configuration/setup reads     | Active session + active membership              | Server-side scope and visibility projections still apply.                 |
| World configuration/setup mutations | Active owner/editor + origin + CSRF             | Resource scope and revisions still apply.                                 |
| Character profiles                  | Active member; controller/facilitator filtering | Restricted definitions/values are removed server-side.                    |
| World archive                       | Active owner                                    | Requires no unfinished interaction.                                       |
| Live reads/events                   | Active, play-ready membership                   | Streams periodically revalidate session and membership.                   |
| Facilitator commands                | Active owner/editor                             | Lifecycle, scope, revision, and idempotency checks apply.                 |
| Player actions                      | Active ready eligible player                    | Server enforces responder, ownership, and control.                        |

Network reachability, React routes, and hidden controls are never treated as
authorization.

## Resource authorization

Authentication proves which `user` is acting. Existing world authorization
continues to decide what that user may do:

- world lists are membership-filtered and direct reads require active
  membership;
- configuration, invite, entity, and setup-state mutation requires
  owner/editor authority;
- archive requires owner authority and no unfinished interaction;
- controller grants name active player memberships and entities in the same
  world and use `table_revision`;
- profile writes require owner/editor or current control and check profile plus
  field-schema revisions;
- restricted fields and facilitator-private prose are removed server-side;
- live access requires player readiness;
- only eligible players submit, with at most one current action each;
- players withdraw only their own submitted actions;
- referenced mechanic/entity/membership/action IDs are checked against the path
  world;
- interaction lifecycle, expected revisions, and resolve idempotency gate live
  mutation;
- final interaction roots, applied receipts, and world events have database
  immutability protections.

Command bodies cannot choose the actor. On an anonymous request, a retired
identity header does not authenticate; on an authenticated request, it is
ignored and cannot override the session user. A user UUID in a command body
likewise does not replace the actor established by the session.

## Data boundaries

### World scope

The world is the tenant/resource boundary. Composite `world_id` foreign keys
and application checks prevent mechanics, entities, memberships, profiles,
interactions, effects, receipts, and events from crossing worlds. There is no
second API surface that bypasses membership.

### Invite bearer scope

An invite is still a bearer capability layered on authentication. Its raw 256-
bit token is returned once, while PostgreSQL stores only a SHA-256 digest. A
valid invite can be previewed and redeemed by any signed-in account that holds
the link; it is not bound to an email or intended username and has no maximum
use count. It expires, can be revoked, is unavailable after world archive, and
cannot change the role of an already-active membership.

Treat invite URLs as secrets. Request logs redact their bearer path segment.

### Participant versus entity

`users` and `world_memberships` represent real participants. `entities`
represent fictional state owners. A username, mechanic name, entity name, or
profile value grants no product authority. Facilitator authority comes from an
owner/editor membership, not a mechanical class.

`world_membership_entity_controls` is the only character-authority edge.
Profile text cannot grant control, mutate mechanical state, or become an effect
target.

### Private data

Facilitator-private interaction/Consequence notes and restricted character
fields are filtered in server query/mapping paths. Frontend hiding is secondary.
World events contain invalidation identifiers, not passwords, profile text,
action text, or private narrative.

The standard request/recovery logger records method, a redacted path, status,
bytes, and duration. It does not intentionally log request/response bodies,
cookies, passwords, CSRF tokens, invitation bearer tokens, or query strings.
Focused application tests cover invitation-bearer redaction in ordinary request
and panic logs. That scope does not prove absence from reverse-proxy, database,
hosting-provider, or newly added diagnostic logs; those need separate review.

## Abuse controls

The process has bounded in-memory throttles for every signup (120 per direct
peer per 10 minutes), every signin (120 per direct peer per five minutes),
failed signin (100 per peer and 10 per normalized account per five minutes),
and failed current-password checks (10 per user per five minutes).
Authentication request bodies retain the global 1 MiB cap and strict JSON
decoding.

At most four Argon2id jobs run concurrently; excess authentication work fails
quickly with `429` and `Retry-After` instead of multiplying memory use. Throttle
keys hash direct-peer and normalized-account inputs. The current-password
failure key instead contains the already-authenticated internal user UUID. The
entry map evicts old records at a fixed ceiling so random usernames cannot grow
it without bound.

These controls are per process and trust the directly connected peer address;
they do not consume forwarded-address headers. A shared reverse proxy can
therefore aggregate unrelated users into one bucket and cause an availability
lockout. Public or multi-replica deployments need a trusted, shared,
proxy-aware limiter. World writes, invite use, actions, resolutions, and SSE
connections still have no general per-user quotas.

## Future-target risks and hardening

If a public launch is ever proposed:

1. Terminate TLS at a trusted proxy, redirect HTTP to HTTPS, set the exact HTTPS
   `DND_PUBLIC_ORIGIN`, and verify secure-cookie/HSTS behavior end to end.
2. Decide the no-email support policy: lost passwords currently mean creating a
   new account; there is no automated recovery or account-administration API.
3. Decide whether MFA or federated login is needed for the threat model.
4. Move authentication/command/stream abuse controls to a shared proxy-aware
   system and add aggregate quotas/backpressure.
5. Separate migration and least-privilege runtime database roles.
6. Add actor-attributed audit facts for privileged configuration, membership,
   and direct state changes, with privacy-aware retention.
7. Establish backup/restore evidence, monitoring, alerting, dependency scanning,
   incident response, and an external security review.
8. Define user-data export/erasure and retention policies for display names,
   actions, narrative, profiles, sessions, and logs.
9. Load/soak test Argon2id concurrency and SSE behavior for the target capacity.

The process still has no built-in TLS server, WAF, metrics/tracing, complete
configuration audit history, or separate migration role. Those are distinct
from the now-enforced application authentication boundary.

## Security review checklist

For every route or field:

- Is the route explicitly public or wrapped by session authentication?
- For an unsafe route, are origin and CSRF enforced before the handler?
- Is the actor taken only from authenticated request context?
- Is membership/role/readiness/control checked for the exact path world?
- Can any referenced ID be substituted from another world?
- Does the response omit private notes and restricted profile prose?
- Is a revision/idempotency guard required?
- Can failure partially mutate state or create an incomplete receipt?
- Do the application, proxy, database, and provider logging paths omit or redact
  password, cookie, CSRF, invite, and narrative values?
- Are anonymous, expired/revoked-session, forged-header, CSRF/origin,
  wrong-role, and cross-world failures tested server-side?

## Responsible operation

- Use a fresh empty database for the password-auth migration; it intentionally
  refuses to invent credentials for preexisting users.
- Keep `DND_PUBLIC_ORIGIN` aligned exactly with the browser-visible origin.
- Do not put personal secrets in narrative/profile fields.
- Protect database and deployment configuration independently of application
  authentication.
- Treat invite URLs and browser sessions as bearer secrets.

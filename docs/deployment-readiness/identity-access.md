# Identity and access readiness

Audit date: 2026-08-07
Remediation status: **Implemented; deployment controls remain conditional**

## Conclusion

The original audit found no signup, signin, logout, or server session. A public
endpoint created UUID/display-name records, the UI enumerated every user, and a
caller could assume any account by sending its UUID as `X-DND-User-ID`.

That identity adapter has been removed. Worldwright now uses native
username/password accounts, Argon2id password hashes, opaque revocable server
sessions, exact-origin validation, and session-bound CSRF tokens. All product
routes—including invite preview and redemption—require authentication; only
health, signup, and signin are public. World membership and role authorization
remain layered after authentication.

## Product decisions

| Question | Decision |
| -------- | -------- |
| Existing accounts | There are no users to preserve. The migration fails closed if the `users` table is nonempty. |
| Account identifier | User-chosen username; normalized uniqueness and signin are case-insensitive. |
| Email | Not collected or stored. |
| Password storage | Argon2id PHC string with a random salt and bounded parser. |
| Browser credential | Opaque random token in an HttpOnly SameSite cookie. |
| Server credential storage | SHA-256 digest only; raw tokens never enter PostgreSQL. |
| CSRF | Exact `Origin` plus a session-bound token on every unsafe authenticated request. |
| Recovery | None in this release. A lost password cannot be recovered by email. |
| Federated identity/MFA | Not in this release. |
| Legacy UUID adapter | Removed; `X-DND-User-ID` cannot authenticate or override a session. |

The lack of email is deliberate, not an incomplete form field. It avoids
collecting a contact identifier when the product has no recovery/delivery
system, at the cost of no automated password reset.

## Implemented account lifecycle

### Signup

`POST /api/auth/signup` accepts username, display name, and password. Usernames
contain 3–64 ASCII characters, start with a letter or number, and otherwise use
letters, numbers, dots, underscores, or hyphens. New passwords contain 15–128
Unicode code points.

The command hashes the password before insertion, creates the user and first
session in one transaction, sets the session cookie, and returns the user plus
an in-memory CSRF token. Duplicate normalized usernames return a field-specific
conflict. The endpoint is public but requires the exact browser origin and is
rate-limited per directly connected client address.

### Signin

`POST /api/auth/signin` normalizes the username, performs an Argon2id
verification, creates a new independent session on success, and returns the
same authentication response as signup. Unknown username, wrong password, and
disabled account use one generic credential error. Unknown accounts still run
a dummy Argon2id verification. Every signin is capped at 120 per directly
connected peer per five minutes; failures additionally cap at 100 per peer and
10 per normalized account in that window.

### Session bootstrap

`GET /api/me` requires a valid cookie. It returns the current account and the
CSRF value for that session, letting a page reload restore authenticated state
without exposing the cookie to JavaScript. A missing, malformed, expired,
revoked, or disabled-account session returns the same authentication-required
boundary.

Sessions have a seven-day sliding idle lifetime and a 30-day absolute lifetime.
Each authenticated request revalidates the database row and account status.
Session creation removes expired/revoked rows and keeps no more than 20 active
sessions per account.

### Logout and password change

`POST /api/auth/logout` revokes the current session and expires both supported
cookie names. `POST /api/auth/logout-all` revokes every session for the account.

`PUT /api/me/password` requires the current password and a valid new password.
It replaces the password hash, revokes all existing sessions, and creates one
new session atomically. Wrong current-password errors remain validation errors,
not session-expiry errors, so the authenticated UI can report the problem
without logging the user out.

There is no forgotten-password endpoint. Account recovery or administrative
support would require a separately designed trust boundary.

## Browser boundary

The React application preserves the requested Play, Build, or invite URL while
showing signin/signup. Signup and password change confirm the new password in
the browser because there is no recovery channel. The application no longer
fetches a user list or stores a UUID in local storage. The session cookie is inaccessible to JavaScript; the CSRF token
exists only in module memory and is reacquired through `/api/me` after reload.

A 401 belonging to the current session ends frontend authenticated state,
clears the in-memory CSRF value, and returns the protected surface to signin; a
late 401 from a superseded session cannot tear down a newer one. If another tab
rotates the same account's shared cookie, the client refreshes its stale CSRF
value through `/api/me` and replays only the mutation rejected by the CSRF
middleware. It refuses that replay if the cookie now belongs to a different
account. Signout is available from the Play/Build libraries, workspaces, and
invite surface. Password change and all-session signout live in account
controls. The SSE client stops reconnecting when authentication ends.

Deep-link behavior is preserved: signing in on an invite URL returns to that
same opaque token rather than losing the onboarding context.

## Route classification

Route registration is deny-by-default for the product API:

- `GET /api/health` is explicitly public;
- signup and signin are explicitly public exact-origin mutations;
- authenticated safe methods require a valid session;
- authenticated unsafe methods require session, exact origin, and CSRF;
- application authorization then applies membership, role, readiness, control,
  visibility, revision, lifecycle, and world-scope rules.

Invite preview now requires a session in addition to the opaque token.
Redemption rejects archived worlds. If the account already has an active
non-owner membership, redeeming a differently roled invite keeps the existing
role rather than escalating or downgrading it.

## Persistence boundary

`users` now stores:

- immutable UUID;
- chosen and normalized usernames;
- display name;
- Argon2id password hash;
- `active`/`disabled` account status;
- timestamps.

`auth_sessions` stores:

- independent session UUID and user foreign key;
- unique SHA-256 token digest;
- creation and last-seen timestamps;
- sliding idle and fixed absolute expiries;
- optional revocation timestamp.

No raw password, raw session token, email address, recovery secret, provider
subject, or seed account is stored. The forward migration refuses a nonempty
`users` table because there is no legitimate way to infer passwords for old
UUID-only records.

## Invitation and onboarding implications

Invites remain bearer capabilities, but they no longer double as an anonymous
identity surface. A recipient opens the area-scoped link, signs up or signs in,
previews it as that authenticated account, and redeems with session CSRF
protection. The resulting membership belongs to the authenticated user.

This preserves the gameplay scenarios after a one-time authentication prelude:

- an owner signs up before creating a world;
- each invited participant signs up (or signs in) in an isolated browser
  context before redemption;
- reloads retain the server session without retaining a script-readable UUID;
- logout invalidates subsequent API calls and live streams;
- membership, role, readiness, control, private-field, and cross-world scenarios
  continue unchanged because they consume the authenticated actor.

## Automated evidence

The test harness creates isolated account contexts with independent cookie jars
and CSRF tokens. Contract requests no longer pass an actor UUID header. The
scenario catalog covers signup, signin, reload/session continuity, current and
all-session logout, anonymous denial, wrong credentials, forged identity-header
rejection, CSRF/origin denial, and expired/revoked-session behavior alongside
the existing authorization matrices.

The UI-authentic lifecycle spine signs up its actors through the browser and
keeps invitation deep links intact. Direct contract setup still uses public
signup, then performs protected requests through that actor's cookie context.
SSE probes use an authenticated cookie and verify stream termination after
session invalidation.

See [Testing](../testing.md) for suite mechanics and the generated scenario
evidence.

## Remaining deployment conditions

Authentication is no longer the public-release blocker, but identity operations
remain conditional on the following:

1. Terminate and redirect HTTPS correctly, set the exact external HTTPS
   `DND_PUBLIC_ORIGIN`, and verify `__Host-dnd_session` in the deployed browser.
2. Decide how support handles a forgotten password when no email/recovery proof
   exists; do not invent an administrator bypass ad hoc.
3. Decide whether the production threat model requires MFA or federated login.
4. Replace per-process peer-address throttles with trusted, shared proxy-aware
   abuse controls before public traffic passes through a shared reverse proxy
   or the service scales to multiple replicas.
5. Add account disable/delete/export administration and privacy retention if
   real personal data will be stored.
6. Add actor-attributed audit history for privileged membership/configuration
   operations.
7. Complete backup/restore, monitoring, capacity, incident-response, dependency,
   and external security-review evidence.

## Exit criteria

The identity impersonation finding is closed when CI proves that:

- anonymous callers cannot access product or invite resources;
- signup/signin establish only the returned account's server session;
- wrong credentials and disabled accounts do not establish sessions;
- a user UUID header cannot authenticate or override the cookie actor;
- unsafe requests fail without exact origin and the current session's CSRF
  token;
- logout, logout-all, password change, expiry, and revocation invalidate the
  intended sessions and SSE streams;
- existing membership/role/readiness/privacy/world-scope matrices pass through
  isolated authenticated contexts;
- no password or raw session token is stored or logged.

Public-production readiness remains a broader gate tracked in this directory.

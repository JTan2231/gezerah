# Identity and access readiness audit

**Audited:** 2026-08-07

**Scope:** users, signup/signin behavior, sessions, world memberships,
invitations, authorization boundaries, player onboarding, and relevant tests.

**Verdict:** the application has a meaningful world membership and invitation
model, but it does not have production authentication or an account lifecycle.
It is blocked from untrusted or public deployment.

This audit is based on the implemented Go handlers, PostgreSQL schema, React
flows, and automated tests. Existing claims in [Security](../security.md),
[API](../api.md), [Frontend](../frontend.md), and
[Domain model](../domain-model.md) were cross-checked against the code.

## Answer at a glance

| Capability | Status | Implemented behavior |
| --- | --- | --- |
| Signup | Blocked | A public development endpoint creates a UUID and display name. There is no verified account. |
| Signin | Blocked | The browser lists all local users and lets the visitor select any one. |
| Signout | Blocked | “Switch profile” only clears a UUID from local storage; there is no server session to revoke. |
| User records | Conditional | UUID, display name, and timestamps exist, but no email, provider subject, credentials, verification, or account state exists. |
| Server sessions | Blocked | No session, access token, refresh token, cookie, expiry, or revocation model exists. |
| World memberships | Conditional | Owner, editor, player, and spectator roles are implemented and world-scoped, but member lifecycle management is incomplete. |
| World invitations | Conditional | Expiring/revocable bearer links and transactional redemption exist, with important policy and implementation gaps below. |
| Resource authorization | Conditional | Role, world, controller, readiness, and visibility checks are substantial, but they trust a forgeable user UUID. |
| Player onboarding | Ready within the trusted model | Invite redemption, character assignment, required fields, and play-readiness gating are implemented. |
| Account recovery and privacy lifecycle | Blocked | No recovery, account deletion, export, erasure, or retention workflow exists. |

“Character profile” is not an account profile. It is world-authored presentation
data for a fictional entity and has a separate authorization model.

## Current identity flow

The apparent account screen is deliberately named **Trusted development
profile** in
[IdentityGate.tsx](../../web/frontend/src/features/IdentityGate.tsx). It:

1. requests every local user from `GET /api/users`;
2. lets the visitor select any returned user; or
3. creates a user from only a display name through `POST /api/users`.

The selected UUID is stored indefinitely as `dnd.selected-user` in browser
local storage by [client.ts](../../web/frontend/src/api/client.ts). Normal API
requests and SSE connections send it as `X-DND-User-ID`.

The backend in [support.go](../../internal/app/support.go) checks only that the
header is a UUID and that a matching `users` row exists. It does not prove that
the caller owns that identity. Anyone who can reach the application can list
the available UUIDs, choose one, and receive all authority associated with that
user's memberships.

Consequently:

- creating a local profile is not signup;
- selecting a profile is not signin;
- switching profiles is not logout; and
- `authentication_required` means “development identity header required,” not
  “authenticated account required.”

There is no password, magic link, passkey, OAuth/OIDC flow, provider-subject
mapping, MFA, verification, session cookie, access/refresh token, expiration,
logout revocation, or account recovery implementation.

## User and account model

The `users` table in
[001_worldwright.sql](../../internal/migrations/001_worldwright.sql) contains
only:

- UUID;
- display name;
- creation timestamp; and
- update timestamp.

Display names are not unique and are identifiers only for presentation. There
is no immutable external subject or verified address to bind a person to a row.

[users.go](../../internal/app/users.go) and
[routes.go](../../internal/app/routes.go) expose only global user listing and
creation. There is no:

- authenticated `GET /api/me` equivalent;
- user read-by-ID handler;
- display-name or account-settings update;
- account disable/delete operation;
- data export or erasure operation; or
- signup policy, consent, or terms checkpoint.

The create handler sets `Location: /api/users/{id}`, but that resource route is
not registered. This is a smaller API consistency issue to fix when the account
surface is redesigned.

## Membership and authorization model

The application correctly separates real participants from fictional entities.
A world membership grants one of four roles:

- `owner`;
- `editor`;
- `player`; or
- `spectator`.

World creation transactionally creates an owner membership. Invitation
redemption creates or reactivates a non-owner membership. Owners and editors
receive configuration/facilitator authority; players receive action authority
only when they are admitted and ready.

Once the server accepts the caller's identity, the downstream authorization is
substantial:

- active membership is required for direct world access;
- owner/editor/facilitator operations have server-side role checks;
- referenced resources are rechecked against the path world;
- profile fields and interaction details are filtered server-side;
- character control is an explicit membership-to-entity relationship;
- players must control a completed character before entering live play; and
- revisions and transaction locks protect sensitive mutations.

These controls should be retained. Their readiness is **conditional** because
they currently derive the actor from a caller-controlled header.

Membership lifecycle is incomplete. The schema permits `active` and `left`, but
the application exposes no command to:

- change a non-owner's role;
- remove or suspend a member;
- leave a world;
- transfer ownership; or
- review/revoke a participant's account sessions.

The People screen is therefore member observation plus invitation management,
not full member administration.

## Invitation model

### Implemented strengths

World invitations are real product capabilities, not placeholders:

- owners/editors can create editor, player, or spectator invitations;
- expiry is restricted to one through 90 days;
- tokens contain 256 random bits and are encoded for URLs;
- PostgreSQL stores only a SHA-256 digest;
- the raw link appears only in the create response;
- authors can list metadata and revoke invitations;
- preview hides invalid, revoked, expired, and archived-world invitations behind
  the same `invite_not_found` response;
- redemption is transactional;
- one invite/user pair produces one redemption and one use count;
- owner memberships are not overwritten by a non-owner invitation; and
- application request logs redact invite bearer path segments.

The React flow in
[PeopleWorkspace.tsx](../../web/frontend/src/features/PeopleWorkspace.tsx)
creates, copies, lists, and revokes links. The recipient flow in
[InvitePage.tsx](../../web/frontend/src/features/InvitePage.tsx) previews the
world, inviter, and offered role and requires an explicit Join action.

### Readiness gaps

Invitations are reusable bearer grants. They have no:

- intended-recipient or email binding;
- maximum-use setting;
- single-use policy across different users;
- recipient proof;
- creation, preview, or redemption rate limit; or
- account-level invitation separate from world admission.

Because public local-user creation is unrestricted, a bearer holder can create
an arbitrary local identity and redeem the link. Production needs an explicit
decision about open signup versus invite-only/account-admin provisioning, and
the invite URL must survive the real signin/signup flow.

Invite tokens appear in browser URLs. The application logger redacts them, but
deployment-provider access logs, browser history/referrer behavior, support
artifacts, analytics, and error reporting must also be checked before treating
the tokens as production bearer secrets.

### Implementation findings requiring focused tests

#### Different-role redemption contradicts the documented policy

The API and domain documentation say redemption does not escalate an
already-active member. In [worlds.go](../../internal/app/worlds.go), however,
redeeming a new invitation replaces every existing non-owner role with the
invitation's role. A player redeeming an editor invitation becomes an editor;
an editor redeeming a player invitation becomes a player. Only owner
preservation is explicit.

The product must choose and document one policy: preserve an active role,
permit deliberate promotion only, or replace the role. The implementation,
response, audit event, UI warning, and tests must then agree.

#### Archived-world preview and redemption apply different rules

Invite preview joins the world row and requires `world.status = 'active'`.
Redemption checks token digest, expiry, and revocation but does not check the
world status. Static review therefore indicates that a previously known token
can admit or reactivate a member after the world is archived, even though the
same token cannot be previewed. The normal revoke endpoint also requires an
active world, so the token cannot then be revoked through that API.

This should be confirmed with a focused database-backed test and then rejected
transactionally unless archived-world admission is an explicit product
requirement.

## Browser, abuse, and audit boundaries

The application has request body limits, strict JSON decoding, world-scoped
authorization, and JSON `nosniff`. It does not yet provide:

- identity, invitation, command, or stream rate limits/quotas;
- CSP, HSTS, frame, referrer, or permissions policies;
- explicit CORS or Origin policy;
- CSRF protection for a future cookie-authenticated design;
- explicit private/no-store cache policy or `Vary` behavior for
  identity-specific responses; or
- deny-by-default authentication middleware for route registration.

Invite creation/revocation do not produce world audit events. A redemption that
changes an existing membership still emits `membership-created`, so the event
stream must not be treated as a complete or precise security audit log.

## Player onboarding

Within the trusted identity model, player onboarding is coherent:

1. a player redeems a world invitation;
2. the player waits until an owner/editor assigns a controlled entity;
3. the player can save partial values for the world's authored character
   fields; and
4. live play opens after at least one controlled entity has all required fields.

The frontend withholds the live interaction/event surface while a player is not
ready, and the backend independently enforces readiness. This workflow should
be preserved when real authentication is added.

## Test evidence and gaps

Existing browser and contract tests cover:

- local development-profile creation;
- player, spectator, and editor invitation paths;
- raw-token omission from invite lists;
- invitation preview, redemption, expiry, revocation, and invalid tokens;
- repeat redemption by the same invite/user pair;
- preservation of an owner's role;
- world isolation and role denials;
- player waiting, character assignment, profile completion, and readiness; and
- direct Builder denial for player/spectator memberships.

No focused automated coverage was found for:

- a real authenticated account lifecycle;
- missing, malformed, unknown, expired-session, or revoked-session identity
  behavior under a production authentication adapter;
- signup verification, duplicate-account handling, logout, or recovery;
- different-role redemption for existing non-owner members;
- redemption after world archival;
- concurrent invite revocation versus redemption;
- recipient binding, maximum uses, or invite abuse controls;
- security headers, CORS/Origin/CSRF, response cache isolation, or rate limits;
  or
- member removal, leaving, role administration, and ownership transfer.

The first three are absent because production authentication does not yet
exist. The two implementation findings above should receive regression tests
before any broader deployment work relies on invite semantics.

## Prioritized public-release work

### P0 — establish a trustworthy actor

1. Choose the production account policy and authentication method.
2. Map an immutable authenticated provider subject or secure credential to a
   local `users` row.
3. Add a secure server-side session/token lifecycle with expiration and
   revocation.
4. Replace public user enumeration/creation with protected provisioning and an
   authenticated current-user endpoint.
5. Derive the request actor only from authenticated middleware; do not accept a
   caller-selected user UUID.
6. Classify every route as explicitly public or authenticated and enforce that
   classification deny-by-default.

### P1 — make invitation and browser boundaries production-safe

1. Resolve the different-role and archived-world redemption findings.
2. Define recipient binding, maximum-use, expiry, signup, and existing-member
   policies.
3. Preserve invite intent across signin/signup without persisting the raw token
   beyond what is necessary.
4. Add logout/revocation UI and session-expiry handling.
5. Add CSRF protection if cookie authentication is selected, a narrow CORS
   policy, security headers, cache isolation, and rate/connection limits.
6. Verify that infrastructure and telemetry never retain raw invitation bearer
   paths beyond the approved secret-handling policy.

### P2 — complete lifecycle and accountability

1. Add deliberate member role/removal/leave and ownership-transfer workflows.
2. Define account disable/delete, export, erasure, and retention behavior.
3. Add actor-attributed audit history for privileged account, membership, and
   setup-state changes.
4. Expand browser and database-backed security tests and arrange external
   review before public launch.

## Public-release exit criteria

The identity/access gate can be marked ready only when automated evidence shows
that:

- an anonymous caller cannot enumerate/provision users or access protected
  world resources;
- an authenticated user cannot select or forge another local user identity;
- session expiration, logout, and revocation remove access;
- all world authorization continues to use the authenticated actor and retains
  current role, scope, visibility, controller, and readiness checks;
- invite behavior is explicit for existing members, archived worlds, expiry,
  revocation, recipient policy, and use limits;
- invite acceptance works through signin/signup without leaking the bearer;
- browser/network defenses and abuse limits match the selected auth model; and
- account, membership, and invitation security paths pass database-backed and
  browser tests.

## Product decisions needed before implementation

1. Is account creation open, world-invite-only, or administrator-provisioned?
2. Which authentication method/provider and recovery model should be used?
3. May one verified account have multiple display identities, or exactly one?
4. Should a world invite be recipient-bound, single-use, limited-use, or
   reusable until expiry?
5. What should a different-role invite do for an existing member?
6. Who can change roles, remove members, transfer ownership, or leave a world?
7. What account deletion, world-history retention, and privacy promises apply?

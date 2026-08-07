# Security and trust boundaries

## Current deployment classification

The application is a **trusted-development build**. It is not safe for direct
public or untrusted-network exposure.

The selected browser user UUID is stored in local storage and sent as
`X-DND-User-ID`. Any client can forge that header. `GET /api/users` enumerates
local users and `POST /api/users` creates them without authentication. World
endpoints enforce membership, role, readiness, scope, and visibility only after
resolving that forgeable identity.

Resource authorization remains valuable, but it does not turn a caller-chosen
UUID into authentication.

## Endpoint trust matrix

| Surface                                  | Current gate                                     | Exposure                                              |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| SPA/static assets                        | None                                             | Public content.                                       |
| `/api/health`                            | None                                             | Reveals service/database readiness.                   |
| `/api/users` GET/POST                    | None                                             | Local identities can be enumerated/created.           |
| Invite preview                           | Opaque bearer token                              | Exposes active world, inviter, role, and expiry.      |
| Invite redemption                        | Known UUID header + bearer token                 | Creates/reactivates one world membership.             |
| World list/read                          | Known UUID + active membership                   | Returns only worlds for the resolved identity.        |
| World configuration/entities/setup state | Active owner/editor                              | Correct role check only if identity were trustworthy. |
| Character fields                         | Active member read; owner/editor write           | Restricted definitions filtered server-side.          |
| Character profiles                       | Owner/editor or active controller                | Values filtered by field visibility.                  |
| Character control                        | Active owner/editor + table revision             | Grants only same-world active-player control.         |
| World archive                            | Active owner                                     | Requires no unfinished interaction.                   |
| Live reads/events                        | Active, play-ready membership                    | Onboarding players are denied live resources.         |
| Facilitator commands                     | Active owner/editor                              | Lifecycle, scope, and revision checks apply.          |
| Player actions                           | Active ready player + eligible responder/control | Server enforces ownership and audience.               |

Do not treat network reachability, the React UI, or hidden controls as access
control.

## Enforced authorization behavior

Within the trusted identity assumption, the server enforces:

- actor user and membership are derived from request context, never body IDs;
- world lists are membership-filtered and direct reads require active
  membership;
- configuration/invite/entity/setup-state mutation requires owner/editor;
- archive requires owner and no unfinished interaction;
- controller grants name active player memberships and entities in the same
  world and use `table_revision`;
- character-field replacement is owner/editor-only, revision-guarded, and
  blocked from changing active IDs while an interaction is unfinished;
- profile writes require owner/editor or current control and check profile plus
  field-schema revisions;
- restricted field definitions/values are omitted from unauthorized responses;
- invite tokens are stored only as SHA-256 digests, expire, can be revoked, and
  count one redemption per invite/user;
- live interaction/event access requires readiness for players;
- only owners/editors facilitate interactions and Consequences;
- only eligible players submit, with at most one current action each;
- acting-entity attribution requires a ready controlled world entity and stores
  a server-captured display name;
- players withdraw only their own submitted actions;
- interaction lifecycle and expected revisions gate live mutation;
- every mechanic/entity/membership/action ID is checked against the path world;
- incomplete entities cannot be new context or effect targets;
- non-facilitator interaction visibility requires audience membership and a
  visible lifecycle state;
- private notes and restricted profile prose are removed server-side;
- SSE rechecks membership/readiness and filters visible events;
- final interaction roots, applied receipt trees, and event rows have database
  immutability triggers.

Tests should preserve role denials, cross-world substitution failures, private
field omission, visibility, revision conflicts, and multi-browser refresh when
real authentication is added.

## Data boundaries

### World scope

The world is the single authorization and storage boundary. Composite
`world_id` foreign keys and application checks prevent mechanics, entities,
memberships, profiles, interactions, effects, receipts, and events from
crossing worlds. This is strong data integrity, but it is not secure tenant
isolation while identities are forgeable.

There is no second API surface that bypasses world membership.

### Invite bearer scope

The raw invite token is returned only at creation and is not recoverable from
the database or invite list. Anyone holding a valid token can preview it and
redeem the offered role using any selected development identity. There is no
maximum-use count, email binding, rate limit, or intended-recipient binding.
Production needs authenticated accounts and an explicit invitation policy.

### Test-only controlled time

The product exposes no clock-control or database-maintenance endpoint. During
an E2E run only, ignored runtime metadata is created with mode `0600` and holds
the disposable database URL alongside the loopback application URL. A direct
contract helper may read that credential, but it first validates a canonical
invite UUID and its SQL updates only the matching invite's `expires_at`. All
identity, world, membership, invite, preview, and redemption operations remain
on the public HTTP surface.

This privileged fixture exists only to cross the real expiry boundary without
waiting a day. It is outside scenario/journey exports, is forbidden in the
UI-authentic lifecycle spine, points at the per-run disposable database, and is
removed with runtime metadata at teardown after that database is dropped.

### Participant versus entity

`users` and `world_memberships` represent real participants. `entities`
represent fictional state owners. No mechanic name or entity name grants
real-world authority. “Dungeon Master” is UI language for owner/editor
facilitator authority, not a mechanical class.

`world_membership_entity_controls` is the only character-authority edge.
Profile content cannot grant control, mutate mechanical state, or become an
effect target. Completing all active fields is an explicit player admission
gate and character eligibility requirement.

### Private data

Facilitator-private fields include interaction/Consequence private notes and any
facilitator-only context. Filtering happens in server query/mapping paths;
frontend hiding is secondary.

Character fields marked `controllers-and-facilitators` are similarly
sensitive. Spectators receive neither their definitions nor values; other
non-controller members receive no value. World events contain identifiers only,
not profile text, action text, or private narrative.

## Existing defensive controls

- parameterized pgx queries;
- strict JSON with unknown-field rejection;
- 1 MiB request-body limit;
- UUID/length/enum/scalar-union validation;
- exact finite decimal validation;
- centralized error envelopes that hide unexpected details;
- panic recovery and server-side stack logging;
- `X-Content-Type-Options: nosniff` on JSON;
- world membership, role, readiness, visibility, and scope checks;
- optimistic revisions and idempotent live resolve;
- normalized relations and cross-world composite foreign keys;
- applied-receipt/final-interaction/event protections;
- HTTP timeouts and bounded shutdown.

These reduce malformed input and integrity risk. They do not replace real
authentication, TLS, abuse controls, or least-privilege database access.

## Known gaps and threats

### Authentication and account lifecycle

- identity is a user-supplied UUID header;
- user discovery/creation are unauthenticated;
- no password, session, OAuth/OIDC, MFA, logout/revocation, or recovery;
- local storage identity is readable by same-origin scripts;
- no linkage to a verified provider subject.

Impact: complete impersonation of any user and all world roles.

### Privileged writes and audit

- impersonation can assume owner/editor authority;
- direct Builder state corrections do not create live Consequence receipts;
- configuration/state changes lack a complete actor-attributed audit history.

Impact: a reachable client can alter world configuration/state as another user,
and some privileged changes cannot be reconstructed from durable history.

### Network and browser controls

- no application TLS;
- no explicit CORS policy;
- no CSRF defense for a future cookie-authenticated deployment;
- no CSP, HSTS, frame-ancestor protection, Referrer Policy, or Permissions
  Policy;
- no application rate limiting/connection quotas;
- default `:8080` bind listens on all interfaces.

### Abuse and denial of service

- public identity creation and forgeable-identity world creation have no quota;
- SSE holds requests and polls PostgreSQL per client;
- no per-user/IP command throttles;
- request/effect/text limits exist, but aggregate counts and event retention do
  not;
- no general log sampling/retention/redaction policy beyond avoiding bodies and
  redacting invitation bearer paths in request summaries and panic records.

### Audit and privacy operations

- applied receipts/events are durable, but not every final interaction child is
  trigger-protected;
- no retention/deletion policy for user names, actions, narratives, or notes;
- no user export/erasure workflow;
- no documented backup/log encryption or retention controls;
- no dependency vulnerability workflow in repository CI.

### Infrastructure

- one database role performs schema and runtime work;
- that role can alter immutability triggers;
- database URL is the only application secret and has no rotation helper;
- no metrics, intrusion alerting, WAF, production threat model, or penetration
  test is recorded.

## Required hardening path

Before untrusted/public use:

1. **Install real authentication.** Validate a server-side session/provider
   token and map an immutable provider subject to a local user.
2. **Protect provisioning and discovery.** Define signup/invite/admin policy;
   prevent arbitrary enumeration/creation.
3. **Bind world authorization to authenticated identity.** Preserve all current
   membership, role, readiness, resource, and visibility checks.
4. **Define setup-state audit policy.** Decide whether direct Builder state
   changes need actor-attributed before/after history.
5. **Use deny-by-default route middleware.** Require an explicit public or
   authenticated classification for every route.
6. **Add browser/network defenses.** TLS, secure cookies if used, CSRF, narrow
   CORS, CSP, HSTS, frame protection, and referrer/permissions headers.
7. **Add abuse controls.** Rate/size/count limits for identity, invites, writes,
   actions, resolutions, and streams; add event retention/backpressure.
8. **Separate database roles.** Migration role owns DDL; runtime gets only
   required table/sequence permissions.
9. **Add auditability.** Actor-attributed append-only facts for privileged
   configuration/state/membership operations with privacy-aware retention.
10. **Operationalize secrets, backups, monitoring, and incident response.**
11. **Expand security testing.** Anonymous/wrong-user/wrong-role/cross-world,
    CSRF/CORS, dependency/static analysis, and external review.

Authentication proves who the user is; world membership and role checks still
decide what that user may do.

## Security review checklist

For every endpoint or field:

- Is it public, authenticated, active-member, owner/editor, player, audience,
  or controller scoped?
- Can any referenced ID be substituted from another world?
- Is the actor derived from trusted request context rather than the body?
- Does the response include notes, hidden context, identities, or restricted
  profile prose?
- Can an event reveal a hidden interaction?
- Is a revision/idempotency guard required?
- Can failure partially mutate state or create an incomplete receipt?
- Does final history remain immutable/readable?
- Are nested/text/stream limits sufficient?
- Are logs/errors free of narrative, action text, profile prose, and tokens?
- Are both forbidden status and sensitive-field absence tested server-side?

## Responsible operation

Until hardening is complete:

- bind local use to `127.0.0.1` or independently restrict the network;
- do not share the deployment with untrusted users;
- do not store sensitive personal information or secrets in prose fields;
- use disposable/non-sensitive databases for demonstrations;
- restrict database/network access independently;
- stop managed services after debugging;
- treat world data as writable by anyone who can forge a selected identity.

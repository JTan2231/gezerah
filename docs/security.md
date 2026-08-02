# Security and trust boundaries

## Current deployment classification

The application is a **trusted-development build**. It is not safe for direct
public or untrusted-network exposure.

The selected browser user UUID is stored in local storage and sent as
`X-DND-User-ID`. Any client can forge that header. `GET /api/users` exposes
local users, `POST /api/users` creates them without authentication, and the
ruleset authoring/state/runtime endpoints have no authentication checks at all.

Server-side game role checks are valuable authorization logic, but they do not
turn a forgeable identity into authentication.

## Endpoint trust matrix

| Surface                  | Current gate                                   | Consequence                                                                        |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| SPA/static assets        | None                                           | Public content.                                                                    |
| `/api/health`            | None                                           | Reveals service/database readiness.                                                |
| `/api/users` GET/POST    | None                                           | Users can be enumerated/created.                                                   |
| `/api/rule-sets/**`      | None                                           | Any reachable client can read/change all authored configuration and generic state. |
| `POST /api/games`        | Known UUID header                              | Any known user can create a game for any ruleset and claim unassigned entities.    |
| `GET /api/games`         | Known UUID header                              | Returns games in which that user has an active membership.                         |
| `/api/play/rule-sets/**` | Known UUID header                              | Any known user can enumerate unassigned entities in an arbitrary ruleset.          |
| Game reads               | Active membership after header lookup          | Sound authorization only if identity were trustworthy.                             |
| Facilitator commands     | Active facilitator role                        | Sound role check only if identity were trustworthy.                                |
| Player actions           | Active player + eligible responder + ownership | Server-enforced, but actor identity is forgeable.                                  |

Do not treat network reachability, the React UI, or hidden controls as an access
control.

## Authorization behavior that is already enforced

Within the trusted identity assumption, the server enforces:

- acting user is derived from the header, never chosen in a command body;
- active membership is required to read a game/connect its event stream;
- facilitator role is required for game management and interaction rulings;
- only eligible active players can submit, at most one current action each;
- a player can withdraw only their own action;
- game status and interaction lifecycle gate live-game API mutations;
- expected revisions prevent stale overwrites;
- live receipt effect targets and reference values remain inside the game
  mapping;
- an entity belongs to at most one game;
- a game retains at least one active facilitator;
- non-facilitator interaction visibility requires audience membership and an
  open/resolved presented status;
- adjudicating/draft/cancelled interactions are hidden from non-facilitators;
- private notes are omitted from non-facilitator responses;
- SSE events are filtered and membership is rechecked every batch;
- applied resolution roots and their receipt trees, final interaction root rows,
  and existing event rows have PostgreSQL immutability triggers.

Tests exercise role denials, visibility, private-field omission, game scope, and
multi-browser event behavior. These checks should be preserved when real
authentication is added.

## Data boundaries

### Ruleset scope

Composite database foreign keys and domain checks prevent configuration and
generic state references from crossing rulesets. This is data integrity, not
tenant isolation: every caller can currently access every ruleset authoring
endpoint.

### Game scope

Game-scoped entity reads use the game's explicit entity mapping, and live receipt
targets, reference operands, and captured before/after values must remain in that
mapping. Variable definitions remain ruleset-scoped. Their defaults and generic
`state_values` may reference another entity in the ruleset even when that entity
is not assigned to the game; assignment and release do not validate this
reference closure. The game definition response can therefore contain such a
default, and a later live resolution may reject incompatible stored references.

Generic builder and problem-runtime endpoints are broader and must not be
exposed as player APIs. They can mutate game-assigned entities without the live
game lifecycle or receipt path.

### Participant versus entity

`users` and `game_memberships` represent real participants. `entities` represent
fictional/generic state owners. No configured schema/key grants real-world
authority. The UI label “Dungeon Master” maps only to membership role
`facilitator`.

### Private data

Facilitator-private fields include interaction/ruling private notes and
facilitator-only event/context details. Filtering happens in server query/mapping
paths; frontend hiding is secondary. When extending payloads, explicitly decide
which fields non-facilitators may receive and test JSON absence.

## Existing defensive controls

- parameterized pgx queries rather than string-concatenated user values;
- strict JSON decoding with unknown-field rejection;
- 1 MiB request body limit;
- UUID/key/length/enum/tagged-union validation;
- exact finite decimal validation;
- centralized error envelopes that avoid returning raw unexpected errors;
- panic recovery and server-side stack logging;
- `X-Content-Type-Options: nosniff` on JSON responses;
- optimistic revision guards and idempotent live resolve;
- normalized relational constraints and cross-scope composite foreign keys;
- applied-receipt and event update/delete protection triggers;
- HTTP read/write/idle timeouts and a bounded shutdown attempt.

These reduce malformed input and integrity risk. They do not replace
authentication, transport security, authorization on builder APIs, or abuse
controls.

## Known gaps and threats

### Authentication and account lifecycle

- identity is a user-supplied UUID header;
- user discovery and creation are unauthenticated;
- no passwords, sessions, OAuth/OIDC, MFA, logout/revocation, or account
  recovery;
- local storage identity is readable by any same-origin script;
- no linkage to a provider subject or verified human.

Impact: complete impersonation of any user and all game roles.

### Builder/state authorization

- ruleset/configuration/entity/state/problem runtime endpoints are
  unauthenticated;
- no ruleset owner/editor/viewer model;
- any known user can create a game for any ruleset and exclusively claim its
  unassigned entities;
- generic state writes and generic problem-choice resolution can modify entities
  assigned to active or archived games outside a live resolution receipt or game
  lifecycle gate.

Impact: complete configuration/state compromise and bypass of live audit
history by any reachable client.

### Network and browser controls

- the application itself provides no TLS;
- no explicit CORS policy/middleware;
- no CSRF defense designed around authenticated browser sessions;
- no Content Security Policy, HSTS, frame-ancestor protection, Referrer Policy,
  or Permissions Policy;
- no application rate limiting or connection quotas;
- the default `:8080` bind, including the `./run.sh` default, listens on all
  interfaces rather than loopback.

Same-origin browser defaults help the current UI but do not protect direct HTTP
clients or a future cookie-authenticated deployment.

### Abuse and denial of service

- public user/configuration creation has no quota;
- SSE holds connections and polls PostgreSQL per client;
- no per-user/IP command throttles;
- collection limits and request/body/effect/tree limits exist, but aggregate
  count and event retention quotas do not;
- logs have no built-in sampling/redaction policy beyond not logging bodies in
  request summaries.

### Audit and privacy operations

- live applied receipts/events are durable, but final interaction children and
  event-type field shapes are not fully protected as an audit record;
- configuration/state edits lack an actor audit trail;
- no retention/deletion policy for user names, actions, narratives, or private
  notes;
- no user export or erasure workflow;
- backups and logs have no documented encryption/retention controls;
- no secret scanning or dependency vulnerability workflow in repository CI.

### Infrastructure

- one database role performs migrations and runtime reads/writes;
- that role has schema-change privileges, so DDL can remove the triggers and the
  immutable rows are not tamper-evident against a database credential holder;
- database URL is the sole application secret and has no rotation helper;
- no metrics, intrusion alerting, WAF, or provider policy is defined here;
- no production threat model or penetration test is recorded.

## Required hardening path

Before untrusted/public use, implement and verify at least:

1. **Real authentication.** Validate a server-side session or identity-provider
   token and map an immutable provider subject to a local user. Remove the
   client-chosen identity header as an authority source.
2. **Protect user discovery/provisioning.** Define signup/invite/admin policy;
   do not allow arbitrary enumeration/creation.
3. **Authorize every ruleset use.** Add explicit ruleset ownership or
   editor/viewer memberships and apply it to configuration, generic entities,
   state, conditions, problem runtime, ruleset-level Play queries, and game
   creation/entity claiming.
4. **Resolve game-state write policy.** Decide whether builder state edits are
   allowed for entities assigned to a game, including generic problem
   resolution, and, if so, audit them with actor and before/after receipt.
5. **Use deny-by-default middleware.** Make new routes private unless explicitly
   classified; preserve resource-level game checks after authentication.
6. **Add browser security.** TLS at the edge, secure/HttpOnly/SameSite cookies if
   used, CSRF protection, explicit narrow CORS, CSP, HSTS, frame protection,
   and appropriate referrer/permissions headers.
7. **Add abuse controls.** Rate/size/count limits for login, user/config writes,
   actions, resolves, and SSE connections; backpressure and event retention.
8. **Separate database roles.** A migration role owns schema changes; runtime
   receives only required table/sequence permissions.
9. **Add auditability.** Actor-attributed append-only events for privileged
   configuration/state/membership operations, with privacy-aware retention.
10. **Operationalize secrets, backups, monitoring, and incident response.** Test
    rotation/recovery and alert on auth failures, privilege denials, anomalous
    writes, 5xx, and connection saturation.
11. **Expand security testing.** Route matrix tests for anonymous/wrong-user/
    wrong-role/cross-ruleset/cross-game cases, CSRF/CORS tests, dependency and
    static analysis, and external review.

Authentication should be introduced without deleting the existing resource-
level authorization helpers. Authentication proves the user; membership and
role checks decide what that proven user may do.

## Security review checklist for changes

For every new endpoint or field, answer:

- Is it public, authenticated, ruleset-authorized, active-member, facilitator,
  player, or audience scoped?
- Can the resource ID be substituted with one from another ruleset/game?
- Is the actor derived from trusted request context rather than body input?
- Does a response include private notes, hidden context, user identity, or
  unassigned entities?
- Does an SSE event reveal that a hidden interaction exists?
- Is a revision/idempotency guard required?
- Can failure partially mutate state or write an incomplete receipt?
- Does archive/final history remain immutable and readable?
- Are limits sufficient for nested arrays/text/streams?
- Are logs/errors free of private narrative/action content and credentials?
- Are both forbidden status and sensitive-field absence tested server-side?

## Responsible operation in the current state

Until hardening is complete:

- set `DND_ADDR=127.0.0.1:8080` for local use, or place the wildcard-bound service
  on an access-controlled private network;
- do not share it with untrusted users;
- do not store sensitive personal information or secrets in prompts/notes;
- use a disposable/non-sensitive database for demonstrations;
- restrict database/network access independently of application checks;
- stop local managed services when debugging is complete;
- treat all configured data and game state as writable by anyone who can reach
  the current API.

# HTTP API reference

## Scope

The public same-origin API is rooted at `/api`; for example, health is
`https://wrought.joeytan.dev/api/health`. The application and API share the
browser origin `https://wrought.joeytan.dev`. The React application is the
primary client. There is no version prefix, so coordinated client/server
changes land together. Every authored and live resource is scoped through a
World URL.

Except for health, signup, and signin, every API endpoint requires an active
server session. World resources additionally apply server-side membership-role,
current-play-role, Play-status, scope, and visibility checks. See [Security](security.md) for
the browser and session boundaries.

## Conventions

### JSON

- Success responses are direct objects or arrays, not wrapped in `data`.
- Creates normally return `201 Created` and a `Location` header.
- Updates, previews, and commands normally return `200 OK`.
- Bodies are limited to 1 MiB.
- Decoding rejects unknown properties and trailing JSON values.
- Properties use `snake_case`.
- Times are RFC 3339 UTC strings.
- Blank optional prose is normally trimmed to absence.
- Create DTOs may accept an optional caller-supplied UUID; otherwise the server
  generates one.

Exact decimal fields use JSON strings, such as `"1.25"`. Inputs may use any
finite decimal spelling accepted by the domain parser and responses canonicalize
it; JSON number tokens, `NaN`, and infinities are rejected for these fields.
Revisions, counts, positions, and priorities remain JSON numbers.

### Authentication and CSRF

Accounts use a username and password; email is neither requested nor stored.
Successful signup/signin returns the authenticated user plus a CSRF token and
sets an opaque HttpOnly session cookie:

```json
{
  "user": {
    "id": "2a7c0a53-65be-47d6-9e71-a97cbb1e53d4",
    "username": "river.song",
    "display_name": "River",
    "created_at": "2026-08-07T12:00:00Z",
    "updated_at": "2026-08-07T12:00:00Z"
  },
  "csrf_token": "..."
}
```

The cookie is `wrought_session` only for loopback HTTP development and
`__Host-wrought_session` for an HTTPS public origin. Non-loopback configured origins
must use HTTPS. The cookie is `HttpOnly`, `SameSite=Lax`, and scoped to `/`.
Clients must send the returned token as `X-WROUGHT-CSRF` on authenticated methods
other than GET, HEAD, and OPTIONS. Those requests must also have an `Origin`
matching `WROUGHT_PUBLIC_ORIGIN`, or the request's own origin when that setting is
empty. An unset origin permits plain HTTP authentication only when both the
request host and network peer are loopback. The token is session-bound and
changes when the password is changed.

The `__Host-` contract requires `Path=/`, so the secure cookie is available to
all Wrought application routes on `wrought.joeytan.dev`. The separate
`joeytan.dev` personal site cannot receive it.

The server stores only a SHA-256 digest of the random session token. Passwords
are stored as Argon2id hashes. Command bodies and headers never select the
acting user or membership; the server derives both from the session. Caller-selected
identity headers do not authenticate or override the session.

Sessions have a seven-day sliding idle lifetime and a 30-day absolute lifetime.
Issuing a session removes expired/revoked rows and keeps at most 20 active
sessions for the account, pruning least-recently-seen sessions first.

### Error envelope

```json
{
  "error": {
    "code": "validation_failed",
    "message": "mechanic is invalid",
    "fields": {
      "step": "must be positive"
    }
  }
}
```

`fields` is optional. Common status/code pairs include:

| Status | Typical codes                                                                   | Meaning                                                             |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 400    | `invalid_json`, `invalid_id`, `invalid_cursor`                                  | Transport, path, or query syntax is malformed.                      |
| 401    | `authentication_required`, `invalid_credentials`                                | Session is absent/expired/revoked, or signin credentials are wrong. |
| 403    | `csrf_invalid`, origin/authority/forbidden/readiness codes                      | Browser-integrity check or resource authority failed.               |
| 404    | `not_found`, `invite_not_found`, `world_template_not_found`, `endpoint_not_found` | Resource, invite, template, or endpoint is absent or hidden.      |
| 409    | `revision_conflict`, `conflict`, `world_archived`, `interactions_unfinished`, `responses_incomplete`, lifecycle/idempotency errors | Current state conflicts with the command. |
| 422    | `validation_failed`, `invalid_reference`, `transition_failed`                   | Structurally readable JSON violates a domain/database rule.         |
| 429    | `rate_limited`                                                                  | Authentication attempt/work limit was reached; honor `Retry-After`. |
| 500    | `internal_error`, `database_error`                                               | Unexpected server or database failure.                              |
| 502    | `model_failed`, `model_invalid_output`                                           | Provider call or returned model output failed.                       |
| 503    | `database_unavailable`, `model_unavailable`                                      | The database or required model configuration is unavailable.         |
| 504    | `model_timeout`                                                                 | Model generation exceeded its request deadline.                      |

Unknown API paths and unsupported methods on known paths reach the methodless
API catchall and return `404 endpoint_not_found` in the JSON error envelope.

### Optimistic concurrency

Overwrite-sensitive commands carry an expected revision. A mismatch returns
`409 revision_conflict`. Counters are aggregate-specific:

| Request field                                               | Protects                                      |
| ----------------------------------------------------------- | --------------------------------------------- |
| `expected_revision` on world update/archive/facilitator assignment | World settings/lifecycle/facilitator assignment revision. |
| `expected_roster_revision` on controller replacement         | World roster revision.                        |
| `expected_logical_state_revision` on logical-state replacement | Entity logical state.                       |
| `expected_revision` on character-field replacement          | World character-field set.                    |
| `expected_revision` on profile replacement                  | Entity profile values.                        |
| `expected_character_field_set_revision` on profile replacement | Character-field set used to build the profile draft. |
| `expected_revision` on interaction command/action creation  | Interaction.                                  |
| `expected_revision` on action withdrawal                    | Action.                                       |
| `expected_rules_revision` on mechanic mutation              | World mechanic graph.                         |
| `expected_rules_revision` on logical-state replacement      | World mechanic graph used to construct the logical input map. |
| Both revisions on Consequence compilation or Terra decision | Interaction plus exact graph used to compile. |
| `expected_rules_revision` on preview/resolve                | Exact graph used to evaluate the Consequence. |

Preview does not reserve a revision. Use the latest authoritative response
before a consequential write.

### Mechanic collection filters and wrappers

The optional mechanic `kind` filter is `capacity` or `capability`; collections
include active and archived resources. Mechanic reads are wrapped with the
rules revision so clients never have to combine a catalog with a revision
from a separate request:

```json
{ "revision": 7, "mechanics": [] }
{ "revision": 7, "mechanic": { "id": "..." } }
```

Create/update/archive commands require the wrapper's revision as
`expected_rules_revision`; their response contains the advanced revision.

## Route catalog

Path placeholders are UUIDs unless noted otherwise.

### Health and accounts

| Method and path             | Authority     | Request/response                                                                                                                  |
| --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | Public        | `{"ok":true,"timestamp":"..."}` after a database ping.                                                                            |
| `POST /api/auth/signup`     | Public+origin | `{username,display_name,password}`; creates the first session and returns the authentication response.                            |
| `POST /api/auth/signin`     | Public+origin | `{username,password}`; returns the same generic error for unknown usernames and wrong passwords.                                  |
| `GET /api/me`               | Session       | Returns the current authentication response so the browser can restore its in-memory CSRF token.                                  |
| `POST /api/auth/logout`     | Session+CSRF  | Revokes the current session and clears both possible cookie names; `204`.                                                         |
| `POST /api/auth/logout-all` | Session+CSRF  | Revokes all sessions belonging to the current account; `204`.                                                                     |
| `PUT /api/me/password`      | Session+CSRF  | `{current_password,new_password}`; revokes every old session, creates a replacement, and returns the new authentication response. |

Usernames contain 3–64 ASCII characters, begin with a letter or number, and
otherwise accept letters, numbers, `.`, `_`, and `-`. Uniqueness is
case-insensitive. New passwords must contain at least 8 Unicode code points.
Because no email is collected, this release intentionally has no
password-recovery flow.
An incorrect current password on the change endpoint is a field-specific
`422 validation_failed`; it does not invalidate the still-valid session.

### Worlds

| Method and path                                | Authority                                      | Request/response                                                                 |
| ---------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/worlds`                              | Authenticated user                             | Active memberships only; membership-role/count/activity and derived play fields. |
| `POST /api/worlds`                             | Authenticated user                             | Name, optional description, and optional prose guide; creates World, owner membership, character-field/mechanic-graph roots, and event. |
| `GET /api/world-templates`                     | Authenticated user                             | The three embedded starting templates as `id`, `version`, name, card description, setting, prose guide, and Character count. |
| `POST /api/world-templates/{template_id}/clone` | Authenticated user                            | `{id}` with a client-generated destination World UUID; atomically creates and returns an ordinary agent-facilitated World. |
| `GET /api/worlds/{world_id}`                   | Active world member                            | World summary for the current member.                                            |
| `PATCH /api/worlds/{world_id}`                 | Owner/editor, active world                     | Name, nullable description, nullable prose guide, and `expected_revision`.       |
| `PUT /api/worlds/{world_id}/facilitator`       | Owner/editor or current human facilitator      | Replaces the human/Terra/agent assignment against `expected_revision`.           |
| `POST /api/worlds/{world_id}/archive`          | Owner                                          | `expected_revision`; rejects unfinished interactions.                            |
| `GET /api/worlds/{world_id}/members`           | Active world member                            | Memberships, controls, revisions, readiness, and current play roles.             |

World creation is transactional and returns membership role `owner`; that owner
is also the initial human facilitator. The contextual `role` field remains one of
`owner`/`editor`/`player`/`spectator`. `current_play_role` is derived separately
as `facilitator`, `player`, or `spectator`, so Facilitator reassignment never rewrites access.
`play_status` remains the non-spectator membership's player-seat readiness even
while it is the facilitator; facilitators bypass that gate while assigned, and
spectators return `ready` but stay read-only.

`revision` protects world settings/archive. `roster_revision` protects
controller changes. `rules_revision` protects the world mechanic graph; all
three are returned on every `World` response.

`prose_guide` is optional World-authored text for how model-authored public
Problems and Consequences should sound. It shapes expression such as diction,
rhythm, narrative distance, and imagery; it does not establish facts, change
Mechanics, reveal restricted information, or choose a player's Action. World
creation may omit it. On PATCH, omission preserves the current value and
`null`, empty text, or whitespace-only text clears it. Non-empty input is
trimmed and limited to 10,000 Unicode code points. It shares the World settings
revision and changes only prose authored afterward.

Template catalog content is embedded Markdown with strict YAML front matter.
The catalog endpoint exposes selection metadata, including each authored prose
guide so a requested tone can inform selection. Clone materializes the
selected template into the ordinary normalized World tables with fresh Mechanic,
expression-node, Character-field, Entity, membership, and profile identities.
File-local aliases never cross the HTTP or database boundary. The new owner is a
current player, the Facilitator source is `agent`, all five Entities begin
uncontrolled and ready to claim, and no Interaction or other live history is
created.

The caller-generated destination `id` is also the retry key. First success
returns `201` and `Location: /api/worlds/{id}`. An equivalent retry by the same
owner returns the existing World with `200`; a reused ID whose World does not
match the selected template returns `409 idempotency_conflict`. Existing copies
do not change when an embedded template version changes.

Every World returns one `facilitator` object. For a human assignment it
contains `source:"human"`,
`membership_id`, and `display_name`; Terra and agent assignments contain only
their source. Ordinary World PATCH cannot change the assignment. The dedicated
assignment command accepts exactly one of:

```json
{ "source": "human", "membership_id": "membership UUID", "expected_revision": 4 }
{ "source": "terra", "expected_revision": 4 }
{ "source": "agent", "expected_revision": 4 }
```

The human target must be an active non-spectator in the world. A meaningful
Facilitator reassignment advances the world revision and emits `facilitator-changed`; an
unchanged assignment is idempotent. Any draft, open, or adjudicating
interaction normally returns `409 interactions_unfinished`. The only exception
is an owner assigning the facilitator to their own membership when exactly one
unfinished Interaction exists, it is authored by the currently assigned Terra
source, and it is open or adjudicating. That transaction
withdraws the owner's submitted action if present, advances the interaction
revision for that withdrawal, and lets the owner close/adjudicate as needed and
finish with human-Facilitator commands.
The world description is the world brief when Terra is designated. The prose
guide separately governs Terra's public Problem and Consequence expression and
is not supplied to Luna's mechanical compilation.

### Capacities and capabilities

| Method and path                                                  | Authority                  | Notes                                                                        |
| ---------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/mechanics?kind=capacity\|capability` | Active world member        | `{revision,mechanics}` with active/archived definitions.                     |
| `POST /api/worlds/{world_id}/mechanics`                          | Owner/editor, active world | Creates input/derived mechanic against expected rules revision.              |
| `GET /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Active world member        | `{revision,mechanic}`.                                                       |
| `PUT /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Owner/editor, active world | Replaces definition/expression against expected rules revision.              |
| `POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive`    | Owner/editor, active world | Archives if no active derived dependency or active Status-instance reference remains. |

Capacity `score`/`pool` and capability `rating` are numeric; capability
`binary` is Boolean. Each is either an `input` with an authored default and
optional stored override, or a `derived` Mechanic with an expression. Every
Mechanic applies to every Entity.

Archiving an active mechanic fails with `409 mechanic_has_dependents` while an
active derived Mechanic references it, or `409 mechanic_has_active_status_instances`
while any active Status-instance modifier references it. Remove those Status instances
before archiving. Archived mechanics remain readable but cannot be changed or
restored through the product API.

### Character fields, Entities, profiles, and sheets

| Method and path                                               | Authority                         | Notes                                                               |
| ------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/character-fields`                 | Active world member               | Ordered character fields plus character-field-set revision; visibility-filtered. |
| `PUT /api/worlds/{world_id}/character-fields`                 | Owner/editor, active world        | Atomically replaces the active character-field set.                 |
| `GET /api/worlds/{world_id}/entities`                         | Active world member               | Roster with Entity sheets and Character completion.                 |
| `POST /api/worlds/{world_id}/entities`                        | Owner/editor, active world        | Creates an Entity, logical-state root, and status-set root; optional Controller memberships. |
| `GET /api/worlds/{world_id}/entities/{entity_id}`             | Active world member               | One world entity.                                                   |
| `PUT /api/worlds/{world_id}/entities/{entity_id}`             | Owner/editor, active world        | Replaces display name/archive flag fields accepted by the command.  |
| `POST /api/worlds/{world_id}/entities/{entity_id}/archive`    | Owner/editor, active world        | Terminally archives the entity; the record remains readable.        |
| `GET /api/worlds/{world_id}/entities/{entity_id}/sheet`       | Active world member               | Generated logical, effective, evaluation, and active-Status-instance view. |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/logical-state` | Owner/editor, active world      | Complete logical input values plus logical-state and rules revisions. |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/controllers` | Owner/editor, active world        | Complete active non-spectator controller set using `expected_roster_revision`. |
| `GET /api/worlds/{world_id}/available-entities`             | Waiting player in agent world     | Narrow unclaimed preset projection plus current `roster_revision`.       |
| `POST /api/worlds/{world_id}/entities/{entity_id}/claim`      | Waiting player in agent world     | Atomically claims one uncontrolled active entity using `expected_roster_revision`. |
| `GET /api/worlds/{world_id}/entities/{entity_id}/profile`     | Active world member               | Fields/values filtered by visibility and control.                   |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/profile`     | Owner/editor or active controller | Complete non-empty values using profile and character-field-set revisions. |

Until ready, a player's Entity collection, Entity-detail, and sheet reads are
restricted to controlled entities. Profile reads are filtered separately: a
different completed Entity may expose only its world-visible values, while
restricted values require current control, owner/editor authority, or the
currently designated human facilitator. Profile editing remains owner/editor
or Controller authority. Direct logical-state writes remain owner/editor setup
operations; players edit only authorized profile text. An archived entity
remains readable, but its identity/display archive transition has no product
restore operation.

### Invite links

| Method and path                                          | Authority                  | Notes                                                                       |
| -------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/invites`                     | Owner/editor, active world | Metadata only; never returns existing raw tokens.                           |
| `POST /api/worlds/{world_id}/invites`                    | Owner/editor, active world | Membership role and 1–90 expiry days; response alone includes `/play/invite/{token}` or `/build/invite/{token}` as its area-scoped `join_path`. |
| `POST /api/worlds/{world_id}/invites/{invite_id}/revoke` | Owner/editor, active world | Idempotently revokes.                                                       |
| `GET /api/world-invites/{opaque_token}`                  | Authenticated user         | Preview when active, unexpired, not revoked, and its world is active.       |
| `POST /api/world-invites/{opaque_token}/redeem`          | Authenticated user + CSRF  | Creates/reactivates one matching world membership atomically.               |

Tokens contain 256 random bits encoded as unpadded URL-safe base64. Only their
SHA-256 digest is stored. Redemption counts once per invite/user. An already
active non-owner membership keeps its membership role; a different-membership-role invite
cannot silently escalate or downgrade it.

### Interactions and actions

| Method and path                                                                          | Authority                    | Notes                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/interactions`                                                | Play-ready world member      | Visibility-filtered feed.                                              |
| `POST /api/worlds/{world_id}/interactions`                                               | Current human facilitator    | Creates draft or creates/presents with `present:true`.                 |
| `GET /api/worlds/{world_id}/interactions/{interaction_id}`                               | Visible play-ready member    | One interaction; private data omitted for non-facilitators.            |
| `PUT /api/worlds/{world_id}/interactions/{interaction_id}`                               | Current human facilitator    | Replaces editable draft using expected revision.                       |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/present`                      | Current human facilitator    | `draft → open`.                                                        |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/adjudicate`                   | Current human facilitator    | `open → adjudicating`.                                                 |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/cancel`                       | Current human facilitator or ready current player with Terra | Human: any unfinished state; Terra: open/adjudicating → cancelled. |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions`                      | Eligible current player      | Creates an action/pass; optional ready controlled acting entity.       |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions/{action_id}/withdraw` | Owning current player        | Withdraws submitted action using action revision.                      |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/preview`                      | Current human facilitator    | Advisory Consequence; no idempotency key required.                     |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/resolve`                      | Current human facilitator    | Atomic state, immutable Resolution receipt, lifecycle, and World event. |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/compile-consequence`          | Current human facilitator    | Luna compilation and advisory preview for the human's supplied prose. |
| `POST /api/worlds/{world_id}/terra/continue`                                            | Ready current player         | Terra creates and presents the next Interaction; empty body.          |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/terra/decide`                | Ready current player         | Terra adjudicates, compiles, previews, and resolves autonomously.      |
| `POST /api/worlds/{world_id}/agent/continue`                                            | Ready current player         | Creates and presents an agent-supplied Problem; no server model call.  |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/agent/resolve`               | Ready current player         | Applies an agent-supplied Consequence through the ordinary Resolution-receipt path. |

### World events (SSE)

| Method and path                     | Authority               | Request                                        |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `GET /api/worlds/{world_id}/events` | Play-ready world member | `?after=<non-negative ID>` or `Last-Event-ID`. |

The stream sends `retry: 1500`, keep-alive comments, and compact events:

```text
id: 42
event: world-event
data: {"id":42,"type":"resolution-committed","interaction_id":"...","resolution_id":"...","actor_membership_id":"...","actor_source":"human","created_at":"..."}

```

After the ordinary authenticated handshake, the handler reauthorizes the
session read-only and rechecks membership on each cycle. It emits at most 100
visible rows per query and immediately repeats authorization/querying after a
full batch so a known backlog drains without the 1.5-second wait. Empty streams
wait for a local mutation wake or the fallback poll.

Each write/flush has a five-second deadline, cleared while the stream waits, so
the ordinary 130-second response timeout does not end a healthy connection. The
handler closes on process/request cancellation, session revocation/expiry or
account disablement, membership revocation, query failure, or write failure.
The client reconnects with its cursor unless authentication has ended. Events
are invalidation signals only.

An ordinary human adjudication or cancellation may invalidate the audience's
interaction projection. Non-facilitators receive such a marked cursor
projected as `interaction-feed-invalidated`: `id` and `created_at` remain, while
`interaction_id`, `action_id`, `resolution_id`, and
`actor_membership_id` are omitted. Facilitators receive the original lifecycle
event. Autonomous Terra adjudication is different: its full
`interaction-adjudicating` event is not marked or redacted and the interaction
remains visible while the decision finishes or is retried. Clients always
advance the cursor and reload authoritative visibility.

Every event returns `actor_source`. Human events also return
`actor_membership_id`; Terra events omit that field. Continue and Decide events
are attributed to Terra rather than the current player who paced them. A ready current player's
Skip is a human-attributed cancellation event; the interaction itself remains
Terra-authored.

## Payload reference

### Mechanic

An input Mechanic request defines an authored default and optional stored override behavior:

```json
{
  "kind": "capacity",
  "mode": "pool",
  "source_kind": "input",
  "name": "Resolve",
  "description": "Composure under pressure.",
  "minimum": "0",
  "maximum": "12",
  "step": "1",
  "default_number": "8",
  "unit": "grit",
  "mutable_during_play": true,
  "archived": false,
  "expected_rules_revision": 6
}
```

Capacities accept `score`/`pool`; capabilities accept `binary`/`rating`.
Binary inputs omit numeric fields and default logically to false.

A derived mechanic replaces defaults/bounds/step/mutability with a recursive
typed expression:

```json
{
  "kind": "capacity",
  "mode": "score",
  "source_kind": "derived",
  "name": "Guard",
  "unit": "points",
  "mutable_during_play": false,
  "expression": {
    "operation": "add-number",
    "operands": [
      { "operation": "mechanic-reference", "mechanic_id": "armor UUID" },
      { "operation": "literal", "value": { "kind": "number", "value": "10" } }
    ]
  },
  "archived": false,
  "expected_rules_revision": 6
}
```

Expression nodes use one of these shapes:

- `literal` with a typed `value`;
- `mechanic-reference` with `mechanic_id`;
- an operation with recursive `operands`.

Numeric operations are `add-number`, `subtract-number`, `multiply-number`,
`min-number`, `max-number`, and `negate-number`. Boolean operations are `and`,
`or`, and `not`. `equal` accepts two operands of the same kind. Numeric
comparisons are `less-than`, `less-than-or-equal`, `greater-than`, and
`greater-than-or-equal`. `if` takes a Boolean condition and two same-kind
branches. The server infers node types and rejects bad arity, type mismatches,
unknown/cross-world references, active references to archived dependencies, and
dependency cycles without advancing the revision.

List responses are `{revision,mechanics}`. Single-resource reads and every
mutation return `{revision,mechanic}`. Archival accepts only
`{"expected_rules_revision":6}`. It preserves stored overrides and
historical Resolution-receipt/Status-instance references, but rejects active derived dependents and
modifiers from active Status instances before making the Mechanic terminally archived.

### Logical state and Entity sheets

Mechanic values are tagged number or Boolean scalars:

```json
{ "kind": "number", "value": "6" }
{ "kind": "boolean", "value": true }
```

Replacement:

```json
{
  "expected_logical_state_revision": 3,
  "expected_rules_revision": 7,
  "logical_input_values": {
    "input mechanic UUID": { "kind": "number", "value": "6" }
  }
}
```

Response:

```json
{
  "entity_id": "entity UUID",
  "logical_state_revision": 4,
  "status_set_revision": 2,
  "rules_revision": 7,
  "logical_input_values": {
    "input mechanic UUID": { "kind": "number", "value": "6" }
  },
  "effective_values": {
    "input mechanic UUID": { "kind": "number", "value": "8" },
    "derived mechanic UUID": { "kind": "number", "value": "18" }
  },
  "evaluations": {
    "input mechanic UUID": {
      "source_kind": "input",
      "presence": "stored-override",
      "intrinsic": { "kind": "number", "value": "6" },
      "effective": { "kind": "number", "value": "8" },
      "modifiers": [
        {
          "status_instance_id": "instance UUID",
          "status_name": "Inspired",
          "modifier_id": "snapshotted modifier UUID",
          "operation": "add-number",
          "priority": 10,
          "operand": { "kind": "number", "value": "2" },
          "before": { "kind": "number", "value": "6" },
          "after": { "kind": "number", "value": "8" }
        }
      ]
    },
    "derived mechanic UUID": {
      "source_kind": "derived",
      "presence": "derived",
      "intrinsic": { "kind": "number", "value": "18" },
      "effective": { "kind": "number", "value": "18" },
      "modifiers": []
    }
  },
  "active_status_instances": [
    {
      "id": "instance UUID",
      "name": "Inspired",
      "description": "A surge of confidence after the rescue.",
      "source_interaction_id": "problem UUID",
      "source_resolution_id": "resolution UUID",
      "source_effect_id": "apply-status effect UUID",
      "applied_order": 12,
      "applied_at": "2026-01-01T00:00:00Z",
      "modifiers": [
        {
          "id": "snapshotted modifier UUID",
          "mechanic_id": "input mechanic UUID",
          "operation": "add-number",
          "value": { "kind": "number", "value": "2" },
          "priority": 10,
          "position": 0
        }
      ]
    }
  ],
  "authored_default_input_mechanic_ids": []
}
```

`logical_input_values` is the complete writable logical input map. Derived IDs are rejected
on replacement. `effective_values` contains every Mechanic's effective value;
`evaluations` explains each intrinsic-to-effective transition, and
`active_status_instances` exposes persistent snapshotted layers with the problem,
resolution, and apply effect that created each one. Status names are
presentation only; the instance UUID is the removal identity. Values equal to
authored defaults normalize out of `entity_input_value_overrides` while remaining materialized in
the response.

### Controller replacement

```json
{
  "expected_roster_revision": 4,
  "controller_world_membership_ids": ["membership UUID"]
}
```

The response returns `entity_id`, the normalized controller membership IDs,
and the new `roster_revision`.

Available-Entity selection in an agent-facilitated World is deliberately narrower than Controller
replacement. `GET .../available-entities` returns only `id`, `display_name`,
an optional world-visible `profile_summary`, and the world `roster_revision`.
`POST .../entities/{entity_id}/claim` accepts only `expected_roster_revision`.
It requires the signed-in membership to be waiting for a Character and the
Entity to have no active non-spectator Controller; the World lock makes two
simultaneous claims produce one winner. Its response adds the resulting
`play_status`.

### Character fields and profiles

```json
{
  "expected_revision": 3,
  "fields": [
    {
      "id": "existing field UUID; omit for new",
      "label": "Backstory",
      "help_text": "Where did this character come from?",
      "visibility": "world"
    },
    {
      "label": "Hidden oath",
      "visibility": "restricted"
    }
  ]
}
```

Omitted active fields archive. An empty field list is valid. Adding/removing
character fields is rejected while an Interaction is unfinished.

```json
{
  "expected_revision": 2,
  "expected_character_field_set_revision": 3,
  "values": [
    {
      "field_id": "Backstory field UUID",
      "value": "Aria grew up beside the glass sea."
    }
  ]
}
```

A profile replacement may remain incomplete. Owners/editors and active
controllers see all authorized fields; other members receive completed
world-visible values only.

### Interaction draft

```json
{
  "title": "The broken bridge",
  "prompt": "The center span gives way beneath you.",
  "private_notes": "Optional facilitator-only setup.",
  "audience_membership_ids": ["membership UUID"],
  "eligible_responder_membership_ids": ["current-player membership UUID"],
  "context_entity_ids": ["entity UUID"],
  "present": true
}
```

Draft replacement adds `expected_revision`. Audience/responders/entities must
belong to the same world; responders must be active ready current players in the
audience, and context entities must be active and eligible. Omitting
`audience_membership_ids` applies the default Play audience: the designated
human facilitator, active spectators, and ready current players;
supplying an explicit empty array persists an audience-free draft. Such a
draft remains editable, but `present: true` or a later presentation command is
rejected atomically until it has at least one audience member.

Every Interaction includes `facilitator_source`. A human-authored row includes
`created_by_membership_id`; Terra- and agent-authored rows omit it. A returned
resolution has its own `facilitator_source` and includes
`resolved_by_membership_id` only for a human resolution. After the owner
recovery path, the interaction correctly retains its Terra source while
its resolution is human-attributed.

In an `agent` World, `POST .../agent/continue` accepts an optional `title`
and required `prompt`, derives the same ready audience/responders/context as
Terra, and creates the interaction directly as `open`. Once responders have
acted, `POST .../agent/resolve` accepts the ordinary expected Interaction and
rules revisions, idempotency key, optional selected-Action metadata, public
`narrative`, and concrete `effects`. It does not accept private notes. The
server enters adjudication, previews deterministically, and commits through the
same atomic transition and immutable Resolution-receipt path; an equivalent retry returns
`replayed:true`, while different key reuse conflicts.

Presented cancelled interactions remain readable to their audience and contain
no resolution. A cancelled draft remains visible only to the human facilitator.

### Human Consequence compilation and autonomous Terra

A current human facilitator may compile their own prose through
`POST /api/worlds/{world_id}/interactions/{interaction_id}/compile-consequence`:

```json
{
  "expected_revision": 4,
  "expected_rules_revision": 7,
  "narrative": "You reach the far bank, but the current tears away your pack."
}
```

The response preserves that narrative, supplies Luna's optional selected-Action
metadata and concrete Effects, and includes the ordinary advisory
preview. It is read-only; the human decides whether to send those values to
`/resolve` with a fresh idempotency key.

Terra exposes lifecycle commands instead of model-output preparation commands.
With Terra currently assigned, a ready current player sends an empty request
to `POST /api/worlds/{world_id}/terra/continue`. There must be no draft, open,
or adjudicating interaction. The server generates the prompt, then atomically
creates and presents one interaction, returning it with `201 Created` and a `Location`
header. Its audience is every ready active membership, its responders are all
ready non-spectators, and its context contains every ready controlled entity.

While that Terra-authored interaction is open or adjudicating and Terra remains
assigned, any ready current player may send its current `expected_revision` to
the existing `POST .../interactions/{interaction_id}/cancel` endpoint. The UI
labels this **Skip problem**. The command records the player as the human event
actor, makes the interaction `cancelled` without a Consequence or effects, and
does not change the Terra assignment. It returns Play to idle and never
generates a replacement; Continue remains a separate command.

Each eligible responder submits an Action before Terra decides. Passing uses
the ordinary Action endpoint with `text:"I pass."` and no acting Entity; it is
not a separate resource or command. When all responders have acted or passed,
any ready current player calls
`POST /api/worlds/{world_id}/interactions/{interaction_id}/terra/decide`:

```json
{
  "expected_revision": 4,
  "expected_rules_revision": 7,
  "idempotency_key": "client-generated unique key"
}
```

The command changes an open Terra interaction to `adjudicating`, generates
Terra's narrative, compiles it with Luna, runs the deterministic preview, and
resolves through the normal locked Resolution-receipt path in the same request. The
requester cannot supply or edit narrative, selected-Action metadata, notes, or Effects,
and no model output is returned for human approval before commit. A successful
response is the ordinary resolution result:

```json
{
  "interaction_id": "interaction UUID",
  "interaction_revision": 6,
  "rules_revision": 7,
  "narrative": "You reach the far bank, but the current tears away your pack.",
  "applications": [],
  "effective_changes": [],
  "entity_sheets": {}
}
```

If generation or compilation fails after adjudication begins, reload the
interaction and retry the same decision with its current revision and the same
idempotency key. An equivalent successful replay returns `replayed:true`;
different reuse conflicts. Luna may return no Effects for a narrative-only
Consequence. The pacing current player's membership is not persisted as Terra's creator,
resolver, or Continue/Decide event actor. Alternatively, the owner may use the
narrow Facilitator recovery above; their own Action is withdrawn before the
human Consequence path opens.

### Action and Consequence

```json
{
  "text": "I jump for the hanging rope.",
  "acting_entity_id": "controlled entity UUID",
  "expected_revision": 3
}
```

The acting entity is optional but, when supplied, must be active, ready, and
controlled by the player. The server snapshots its display name.

The Problem's Consequence is transported by the Resolution request. Its
required `narrative` field is the public prose account, with optional
selected-Action metadata and an ordered `effects` array. Effects use exactly
these four tagged shapes:

```json
{ "id": "optional UUID", "type": "set", "entity_ids": ["UUID"], "mechanic_id": "UUID", "value": { "kind": "boolean", "value": true } }
{ "id": "optional UUID", "type": "adjust-number", "entity_ids": ["UUID"], "mechanic_id": "UUID", "amount": "-2" }
{
  "id": "optional UUID",
  "type": "apply-status",
  "targets": [{ "entity_id": "UUID" }],
  "status": {
    "name": "Shaken",
    "description": "The fall leaves Aria unsteady.",
    "modifiers": [
      {
        "id": "optional modifier UUID",
        "mechanic_id": "Resolve UUID",
        "operation": "add-number",
        "value": { "kind": "number", "value": "-2" },
        "priority": 10
      }
    ]
  }
}
{
  "id": "optional UUID",
  "type": "remove-status",
  "targets": [
    { "entity_id": "UUID", "status_instance_id": "active instance UUID" }
  ]
}
```

Scalar operations keep `entity_ids` and can target only active mutable inputs.
Status operations instead use ordered `targets` and carry no scalar
mechanic/value/amount fields. Every apply target omits `status_instance_id` and
creates a distinct instance from the effect's inline status. Every remove target
requires the exact active instance belonging to that entity and omits `status`;
an unknown, already removed, cross-world, or mismatched instance is a validation
failure. Equal status names from independent effects are allowed because name
is never identity.

Inline modifier operations are `set`, `add-number`, and `multiply-number`.
`set` matches the target mechanic's scalar kind; the other operations require
a numeric target and value. Request order becomes the zero-based snapshot
position, and an empty modifier list is valid for a named condition with no
mechanical adjustment. Scalar Effects operate on the logical input value;
active Status modifiers are not folded into that value or persisted as stored overrides.

Consequence request:

```json
{
  "expected_revision": 4,
  "expected_rules_revision": 7,
  "idempotency_key": "client-generated unique key",
  "selected_action_id": "optional submitted action UUID",
  "action_summary": "Aria catches the rope.",
  "narrative": "You swing clear but strike the stone wall.",
  "private_notes": "Optional facilitator-only note.",
  "effects": [
    {
      "type": "adjust-number",
      "entity_ids": ["Aria UUID"],
      "mechanic_id": "Resolve UUID",
      "amount": "-2"
    },
    {
      "type": "apply-status",
      "targets": [{ "entity_id": "Aria UUID" }],
      "status": {
        "name": "Shaken",
        "description": "The collision leaves Aria unsteady.",
        "modifiers": [
          {
            "mechanic_id": "Resolve UUID",
            "operation": "add-number",
            "value": { "kind": "number", "value": "-2" },
            "priority": 10
          }
        ]
      }
    }
  ]
}
```

Preview permits an empty idempotency key and never writes. Resolve requires a
non-empty key up to 200 characters. Both require the current rules
revision. The result contains `rules_revision`, ordered scalar and Status
Applications, `effective_changes`, and Entity sheets for target
Entities. A Status instance projected only in preview omits `source_resolution_id`, because
no committed Resolution exists yet; a committed result always includes it. Each
apply-status or remove-status Status Application has exactly these fields (an
apply example follows):

```json
{
  "type": "apply-status",
  "effect_id": "effect UUID",
  "entity_id": "entity UUID",
  "status_instance_id": "instance UUID",
  "status_name": "Shaken",
  "active_before": false,
  "active_after": true,
  "changed": true
}
```

Source provenance appears on the active Status instance rather than being repeated in an
Application. Effective changes report every before/after effective
value that moved, including derived values changed transitively by a scalar Effect
or Status modifier. Equivalent replay adds `replayed:true`; the embedded committed
Resolution receipt retains the original rules revision and effective-change list. The
resulting active Status instance reports `source_interaction_id`,
`source_resolution_id`, and `source_effect_id`, tying the persistent instance
to the Problem that created it.

## Limits and notable validation rules

| Item                                                           | Limit/rule                                   |
| -------------------------------------------------------------- | -------------------------------------------- |
| API request body                                               | 1 MiB                                        |
| Names/labels/display names                                     | Usually 200 characters                       |
| Interaction title                                              | 200 characters                               |
| Interaction prompt/action text                                 | 10,000 characters                            |
| Consequence action summary                                     | 10,000 characters                            |
| Interaction private notes; Consequence narrative/private notes | 20,000 characters                            |
| Character fields                                               | 50 active; label 200/guidance 2,000          |
| Character-field value                                          | 20,000 characters                            |
| World prose guide                                               | 10,000 Unicode code points                   |
| Consequence effects                                            | No separate item cap; 1 MiB body cap applies |
| Inline status description                                      | 2,000 characters                             |
| World list; interaction feed                                   | 500 each                                     |
| Entity/member/mechanic lists                                   | No explicit application cap                  |
| SSE batch                                                      | 100 events                                   |

For mechanical and lifecycle invariants, see [Domain model](domain-model.md).

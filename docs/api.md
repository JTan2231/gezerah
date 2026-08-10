# HTTP API reference

## Scope

The same-origin API is rooted at `/api`; the React application is its primary
client. There is no version prefix, so coordinated client/server changes land
together. Every authored and live resource is scoped through a world URL.

Except for health, signup, and signin, every API endpoint requires an active
server session. World resources additionally apply server-side membership,
role, readiness, scope, and visibility checks. See [Security](security.md) for
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

The cookie is `dnd_session` only for loopback HTTP development and
`__Host-dnd_session` for an HTTPS public origin. Non-loopback configured origins
must use HTTPS. The cookie is `HttpOnly`, `SameSite=Lax`, and scoped to `/`.
Clients must send the returned token as `X-DND-CSRF` on authenticated methods
other than GET, HEAD, and OPTIONS. Those requests must also have an `Origin`
matching `DND_PUBLIC_ORIGIN`, or the request's own origin when that setting is
empty. An unset origin permits plain HTTP authentication only when both the
request host and network peer are loopback. The token is session-bound and
changes when the password is changed.

The server stores only a SHA-256 digest of the random session token. Passwords
are stored as Argon2id hashes. Command bodies and headers never select the
acting user or membership; the server derives both from the session. Supplying
the former `X-DND-User-ID` header has no effect.

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
| 403    | `csrf_invalid`, origin/role/forbidden/readiness codes                           | Browser-integrity check or resource authority failed.               |
| 404    | `not_found`, `invite_not_found`, `endpoint_not_found`                           | Resource, invite, or endpoint is absent or hidden.                  |
| 409    | `revision_conflict`, `conflict`, `world_archived`, lifecycle/idempotency errors | Current state conflicts with the command.                           |
| 422    | `validation_failed`, `invalid_reference`, `transition_failed`                   | Structurally readable JSON violates a domain/database rule.         |
| 429    | `rate_limited`                                                                  | Authentication attempt/work limit was reached; honor `Retry-After`. |
| 500    | `internal_error`, `database_error`                                              | Unexpected server or database failure.                              |
| 503    | `database_unavailable`                                                          | Health check cannot ping PostgreSQL.                                |

Unknown API paths and unsupported methods on known paths reach the methodless
API catchall and return `404 endpoint_not_found` in the JSON error envelope.

### Optimistic concurrency

Overwrite-sensitive commands carry an expected revision. A mismatch returns
`409 revision_conflict`. Counters are aggregate-specific:

| Request field                                               | Protects                                      |
| ----------------------------------------------------------- | --------------------------------------------- |
| `expected_revision` on world update/archive                 | World settings/lifecycle revision.            |
| `expected_table_revision` on controller replacement         | World table/control revision.                 |
| `expected_revision` on state replacement                    | Entity state record.                          |
| `expected_revision` on character-field replacement          | World character-field set.                    |
| `expected_revision` on profile replacement                  | Entity profile values.                        |
| `expected_character_fields_revision` on profile replacement | Field schema used to build the profile draft. |
| `expected_revision` on interaction command/action creation  | Interaction.                                  |
| `expected_revision` on action withdrawal                    | Action submission.                            |
| `expected_rules_revision` on mechanic mutation              | World mechanic dependency graph.              |
| `expected_rules_revision` on state replacement              | Rule schema used to construct the input map.  |
| `expected_rules_revision` on preview/resolve                | Exact graph used to evaluate the Consequence. |

Preview does not reserve a revision. Use the latest authoritative response
before a consequential write.

### Mechanic collection filters and wrappers

The optional mechanic `kind` filter is `capacity` or `capability`; collections
include active and archived resources. Mechanic reads are wrapped with the
world rules revision so clients never have to combine a catalog with a revision
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

| Method and path                       | Authority                  | Request/response                                                                 |
| ------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/worlds`                     | Authenticated user         | Active memberships only; role/count/activity and derived `play_status`.          |
| `POST /api/worlds`                    | Authenticated user         | Name/description; creates world, owner membership, field/rules roots, and event. |
| `GET /api/worlds/{world_id}`          | Active world member        | World summary for the current member.                                            |
| `PATCH /api/worlds/{world_id}`        | Owner/editor, active world | Name, nullable description, and `expected_revision`.                             |
| `POST /api/worlds/{world_id}/archive` | Owner                      | `expected_revision`; rejects unfinished interactions.                            |
| `GET /api/worlds/{world_id}/members`  | Active world member        | Memberships, controls, revisions, and derived readiness.                         |

World creation is transactional and returns role `owner`. Owners and editors
have facilitator authority; there is no separate facilitator membership.

`revision` protects world settings/archive. `table_revision` protects
controller changes. `rules_revision` protects the world mechanic graph; all
three are returned on every `World` response.

### Capacities and capabilities

| Method and path                                                  | Authority                  | Notes                                                                        |
| ---------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/mechanics?kind=capacity\|capability` | Active world member        | `{revision,mechanics}` with active/archived definitions.                     |
| `POST /api/worlds/{world_id}/mechanics`                          | Owner/editor, active world | Creates input/derived mechanic against expected rules revision.              |
| `GET /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Active world member        | `{revision,mechanic}`.                                                       |
| `PUT /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Owner/editor, active world | Replaces definition/expression against expected rules revision.              |
| `POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive`    | Owner/editor, active world | Archives if no active derived dependency or active status reference remains. |

Capacity `score`/`pool` and capability `rating` are numeric; capability
`binary` is Boolean. Each is either a stored/defaulted `input` or a calculated
`derived` mechanic. Every mechanic applies to every entity.

Archiving an active mechanic fails with `409 mechanic_has_dependents` while an
active derived mechanic references it, or `409 mechanic_has_active_statuses`
while any active status modifier references it. Remove those active statuses
before archiving. Archived mechanics remain readable but cannot be changed or
restored through the product API.

### Character fields, entities, profiles, and state

| Method and path                                               | Authority                         | Notes                                                               |
| ------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/character-fields`                 | Active world member               | Ordered requirements plus schema revision; visibility-filtered.     |
| `PUT /api/worlds/{world_id}/character-fields`                 | Owner/editor, active world        | Atomically replaces active requirements.                            |
| `GET /api/worlds/{world_id}/entities`                         | Active world member               | Roster with state and character completion.                         |
| `POST /api/worlds/{world_id}/entities`                        | Owner/editor, active world        | Creates entity/state root; optional controller memberships.         |
| `GET /api/worlds/{world_id}/entities/{entity_id}`             | Active world member               | One world entity.                                                   |
| `PUT /api/worlds/{world_id}/entities/{entity_id}`             | Owner/editor, active world        | Replaces display name/archive flag fields accepted by the command.  |
| `POST /api/worlds/{world_id}/entities/{entity_id}/archive`    | Owner/editor, active world        | Terminally archives the entity; the record remains readable.        |
| `GET /api/worlds/{world_id}/entities/{entity_id}/state`       | Active world member               | Input, effective, evaluation, and active-status state.              |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/state`       | Owner/editor, active world        | Full input values plus state and rules revisions.                   |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/controllers` | Owner/editor, active world        | Complete controller set using `expected_table_revision`.            |
| `GET /api/worlds/{world_id}/entities/{entity_id}/profile`     | Active world member               | Fields/values filtered by visibility and control.                   |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/profile`     | Owner/editor or active controller | Complete non-empty values using profile and field-schema revisions. |

Until ready, a player's entity collection, entity-detail, and state reads are
restricted to controlled entities. Profile reads are filtered separately: a
different completed entity may expose only its table-visible values, while
restricted values require controller or facilitator authority. Direct state
writes remain owner/editor setup operations; players edit only authorized
profile text. An archived entity remains readable, but its identity/display
archive transition has no product restore operation.

### Invite links

| Method and path                                          | Authority                  | Notes                                                                       |
| -------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/invites`                     | Owner/editor, active world | Metadata only; never returns existing raw tokens.                           |
| `POST /api/worlds/{world_id}/invites`                    | Owner/editor, active world | Role and 1–90 expiry days; response alone includes area-scoped `join_path`. |
| `POST /api/worlds/{world_id}/invites/{invite_id}/revoke` | Owner/editor, active world | Idempotently revokes.                                                       |
| `GET /api/world-invites/{opaque_token}`                  | Authenticated user         | Preview when active, unexpired, not revoked, and its world is active.       |
| `POST /api/world-invites/{opaque_token}/redeem`          | Authenticated user + CSRF  | Creates/reactivates one matching world membership atomically.               |

Tokens contain 256 random bits encoded as unpadded URL-safe base64. Only their
SHA-256 digest is stored. Redemption counts once per invite/user. An already
active non-owner membership keeps its current role; a different-role invite
cannot silently escalate or downgrade it.

### Interactions and actions

| Method and path                                                                          | Authority                 | Notes                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `GET /api/worlds/{world_id}/interactions`                                                | Play-ready world member   | Visibility-filtered feed.                                    |
| `POST /api/worlds/{world_id}/interactions`                                               | Owner/editor facilitator  | Creates draft or creates/presents with `present:true`.       |
| `GET /api/worlds/{world_id}/interactions/{interaction_id}`                               | Visible play-ready member | One interaction; private data omitted for non-facilitators.  |
| `PUT /api/worlds/{world_id}/interactions/{interaction_id}`                               | Owner/editor facilitator  | Replaces editable draft using expected revision.             |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/present`                      | Owner/editor facilitator  | `draft → open`.                                              |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/adjudicate`                   | Owner/editor facilitator  | `open → adjudicating`.                                       |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/cancel`                       | Owner/editor facilitator  | Any unfinished state → cancelled.                            |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions`                      | Eligible player           | Creates action; optional ready controlled acting entity.     |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions/{action_id}/withdraw` | Owning player             | Withdraws submitted action using action revision.            |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/preview`                      | Owner/editor facilitator  | Advisory Consequence; no idempotency key required.           |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/resolve`                      | Owner/editor facilitator  | Atomic state, immutable receipt, lifecycle, and world event. |

### World events (SSE)

| Method and path                     | Authority               | Request                                        |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `GET /api/worlds/{world_id}/events` | Play-ready world member | `?after=<non-negative ID>` or `Last-Event-ID`. |

The stream sends `retry: 1500`, keep-alive comments, and compact events:

```text
id: 42
event: world-event
data: {"id":42,"type":"resolution-applied","interaction_id":"...","resolution_id":"...","actor_membership_id":"...","created_at":"..."}

```

After the ordinary authenticated handshake, the handler reauthorizes the
session read-only and rechecks membership on each cycle. It emits at most 100
visible rows per query and immediately repeats authorization/querying after a
full batch so a known backlog drains without the 1.5-second wait. Empty streams
wait for a local mutation wake or the fallback poll.

Each write/flush has a five-second deadline, cleared while the stream waits, so
the ordinary 30-second response timeout does not end a healthy connection. The
handler closes on process/request cancellation, session revocation/expiry or
account disablement, membership revocation, query failure, or write failure.
The client reconnects with its cursor unless authentication has ended. Events
are invalidation signals only.

When an open interaction moves to adjudicating or cancelled, it leaves a
non-facilitator audience member's visible feed. That former audience still
receives the marked cursor row, projected as
`interaction-feed-invalidated`: `id` and `created_at` remain, while
`interaction_id`, `submission_id`, `resolution_id`, and
`actor_membership_id` are omitted. Facilitators receive the original lifecycle
event. Clients advance the cursor and reload the visible interaction feed for
either form.

## Payload reference

### Mechanic

An input mechanic request is a normal stored/defaulted definition:

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
`{"expected_rules_revision":6}`. It preserves stored input values and
historical receipt/status references, but rejects active derived dependents and
active status modifiers before making the mechanic terminally archived.

### State

State values are tagged number or Boolean scalars:

```json
{ "kind": "number", "value": "6" }
{ "kind": "boolean", "value": true }
```

Replacement:

```json
{
  "expected_revision": 3,
  "expected_rules_revision": 7,
  "values": {
    "input mechanic UUID": { "kind": "number", "value": "6" }
  }
}
```

Response:

```json
{
  "entity_id": "entity UUID",
  "revision": 4,
  "status_revision": 2,
  "rules_revision": 7,
  "values": {
    "input mechanic UUID": { "kind": "number", "value": "6" }
  },
  "effective_values": {
    "input mechanic UUID": { "kind": "number", "value": "8" },
    "derived mechanic UUID": { "kind": "number", "value": "18" }
  },
  "evaluations": {
    "input mechanic UUID": {
      "source_kind": "input",
      "presence": "stored",
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
  "active_statuses": [
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
  "defaulted_mechanic_ids": [],
  "updated_at": "2026-01-01T00:00:00Z"
}
```

`values` is the complete writable logical input map. Derived IDs are rejected
on replacement. `effective_values` contains every calculated mechanic;
`evaluations` explains intrinsic-to-effective calculation, and
`active_statuses` exposes persistent snapshotted layers with the problem,
resolution, and apply effect that created each one. Status names are
presentation only; the instance UUID is the removal identity. Values equal to
input defaults normalize out of `state_values` while remaining materialized in
the response.

### Controller replacement

```json
{
  "expected_table_revision": 4,
  "controller_world_membership_ids": ["membership UUID"]
}
```

The response returns `entity_id`, the normalized controller membership IDs,
and the new `table_revision`.

### Character fields and profiles

```json
{
  "expected_revision": 3,
  "fields": [
    {
      "id": "existing field UUID; omit for new",
      "label": "Backstory",
      "help_text": "Where did this character come from?",
      "visibility": "table"
    },
    {
      "label": "Hidden oath",
      "visibility": "controllers-and-facilitators"
    }
  ]
}
```

Omitted active fields archive. An empty field list is valid. Adding/removing
requirements is rejected while an interaction is unfinished.

```json
{
  "expected_revision": 2,
  "expected_character_fields_revision": 3,
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
table-visible values only.

### Interaction draft

```json
{
  "title": "The broken bridge",
  "prompt": "The center span gives way beneath you.",
  "private_notes": "Optional facilitator-only setup.",
  "audience_membership_ids": ["membership UUID"],
  "eligible_responder_membership_ids": ["player membership UUID"],
  "entity_ids": ["entity UUID"],
  "present": true
}
```

Draft replacement adds `expected_revision`. Audience/responders/entities must
belong to the same world; responders must be active ready players in the
audience, and context entities must be active and eligible. Omitting
`audience_membership_ids` preserves the compatible table-audience default;
supplying an explicit empty array persists an audience-free draft. Such a
draft remains editable, but `present: true` or a later presentation command is
rejected atomically until it has at least one audience member.

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

The problem's Consequence is transported by the existing resolution request.
Its required `narrative` field is the single public prose summary, followed by
an ordered `effects` array. Live effects are exactly these four tagged shapes:

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
mechanical adjustment. `set`/`adjust-number` effects always mutate logical base
input; an active status's effective adjustment is not included in their stored
operand or baked back into state.

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
non-empty key up to 200 characters. Both require the current mechanic rules
revision. The result contains `rules_revision`, ordered scalar/status
`applied_effects`, `effective_changes`, and evaluated state records for target
entities. A status shown only in preview omits `source_resolution_id`, because
no durable resolution exists yet; resolved state always includes it. Each
`apply-status` or `remove-status` application has exactly these fields (an
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

Source provenance appears on active state rather than being repeated in an
application receipt. Effective changes report every before/after calculated
mechanic that moved, including derived values changed transitively by a scalar
or status effect. Equivalent replay adds `replayed:true`; the embedded applied
receipt retains the original rules revision and effective-change list. The
resulting active status reports `source_interaction_id`,
`source_resolution_id`, and `source_effect_id`, tying the persistent instance
to the problem that created it.

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
| Consequence effects                                            | No separate item cap; 1 MiB body cap applies |
| Inline status description                                      | 2,000 characters                             |
| World list; interaction feed                                   | 500 each                                     |
| Entity/member/mechanic lists                                   | No explicit application cap                  |
| SSE batch                                                      | 100 events                                   |

For mechanical and lifecycle invariants, see [Domain model](domain-model.md).

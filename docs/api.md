# HTTP API reference

## Scope

The same-origin API is rooted at `/api`; the React application is its primary
client. There is no version prefix, so coordinated client/server changes land
together. Every authored and live resource is scoped through a world URL.

Except for health, local-user provisioning, and invite preview, endpoints use a
development identity header plus server-side world membership/role checks. See
[Security](security.md) before exposing the service outside a trusted network.

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

Numeric decoding uses `json.Number` and exact decimals. Send finite JSON
numbers, not quoted numbers, `NaN`, or infinities.

### Identity

`GET /api/users` and `POST /api/users` are public within the trusted deployment.
Every world query or command and invite redemption requires:

```http
X-DND-User-ID: 2a7c0a53-65be-47d6-9e71-a97cbb1e53d4
```

The UUID must name a row in `users`. This is a forgeable development adapter,
not authentication. Command bodies never select the acting user or membership;
the server derives both from the header and world membership.

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

| Status | Typical codes                                                                                       | Meaning                                                              |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 400    | `invalid_json`, `invalid_id`, `invalid_cursor`                                                      | Transport, path, or query syntax is malformed.                       |
| 401    | `authentication_required`, `invalid_identity`                                                       | Development identity is absent, malformed, or unknown.               |
| 403    | `world_forbidden`, role-required codes, `character_setup_required`, `entity_profile_forbidden`       | Actor lacks world/resource authority or is not ready for live play.  |
| 404    | `not_found`, `invite_not_found`, `endpoint_not_found`                                               | Resource, invite, or endpoint is absent or hidden.                   |
| 409    | `revision_conflict`, `conflict`, `world_archived`, lifecycle/idempotency errors                      | Current state conflicts with the command.                            |
| 422    | `validation_failed`, `invalid_reference`, `effect_application_failed`                               | Structurally readable JSON violates a domain/database rule.          |
| 500    | `internal_error`, `database_error`                                                                  | Unexpected server or database failure.                              |
| 503    | `database_unavailable`                                                                              | Health check cannot ping PostgreSQL.                                 |

The standard-library mux may emit its own `405 Method Not Allowed` for a known
path with the wrong method.

### Optimistic concurrency

Overwrite-sensitive commands carry an expected revision. A mismatch returns
`409 revision_conflict`. Counters are aggregate-specific:

| Request field                                               | Protects                                      |
| ----------------------------------------------------------- | --------------------------------------------- |
| `expected_revision` on world update/archive                 | World settings/lifecycle revision.            |
| `expected_table_revision` on controller replacement        | World table/control revision.                 |
| `expected_revision` on state replacement                   | Entity state record.                          |
| `expected_revision` on character-field replacement         | World character-field set.                    |
| `expected_revision` on profile replacement                 | Entity profile values.                        |
| `expected_character_fields_revision` on profile replacement| Field schema used to build the profile draft. |
| `expected_revision` on interaction command/action creation | Interaction.                                  |
| `expected_revision` on action withdrawal                   | Action submission.                            |

Preview does not reserve a revision. Use the latest authoritative response
before a consequential write.

### Archive filters

Mechanic collections accept `?archived=true|false`: `true` returns archived,
`false` returns active, and absence returns both. The optional `kind` filter is
`capacity` or `capability`.

## Route catalog

Path placeholders are UUIDs unless noted otherwise.

### Health and local users

| Method and path   | Authority | Request                  | Response                                                        |
| ----------------- | --------- | ------------------------ | --------------------------------------------------------------- |
| `GET /api/health` | Public    | None                     | `{"ok":true,"timestamp":"..."}` after a database ping.     |
| `GET /api/users`  | Public    | None                     | Up to 1000 local identities.                                    |
| `POST /api/users` | Public    | `{id?,display_name}`     | Creates a local development identity.                           |

### Worlds

| Method and path                              | Authority                  | Request/response                                                                    |
| -------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/worlds`                            | Known user                 | Active memberships only; role/count/activity and derived `play_status`.             |
| `POST /api/worlds`                           | Known user                 | Name/description; creates world, owner membership, field root, and event.            |
| `GET /api/worlds/{world_id}`                 | Active world member        | World summary for the current member.                                               |
| `PATCH /api/worlds/{world_id}`               | Owner/editor, active world | Name, nullable description, and `expected_revision`.                                |
| `POST /api/worlds/{world_id}/archive`        | Owner                      | `expected_revision`; rejects unfinished interactions.                               |
| `GET /api/worlds/{world_id}/members`         | Active world member        | Memberships, controls, revisions, and derived readiness.                            |

World creation is transactional and returns role `owner`. Owners and editors
have facilitator authority; there is no separate facilitator membership.

`revision` protects world settings/archive. `table_revision` protects
controller changes and is returned on every `World` response.

### Capacities and capabilities

| Method and path                                                  | Authority                  | Notes                                          |
| ---------------------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| `GET /api/worlds/{world_id}/mechanics?kind=capacity\|capability` | Active world member        | Active/archived scalar mechanics.              |
| `POST /api/worlds/{world_id}/mechanics`                          | Owner/editor, active world | Creates one user-authored mechanic.            |
| `GET /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Active world member        | Reads one mechanic.                            |
| `PUT /api/worlds/{world_id}/mechanics/{mechanic_id}`             | Owner/editor, active world | Replaces the author-facing definition.         |
| `POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive`    | Owner/editor, active world | Archives while retaining state/history.        |

Mechanics are scalar only. Capacity `score`/`pool` and capability `rating` are
numeric; capability `binary` is Boolean. Every mechanic applies to every entity.

### Character fields, entities, profiles, and state

| Method and path                                               | Authority                         | Notes                                                                  |
| ------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/character-fields`                 | Active world member               | Ordered requirements plus schema revision; visibility-filtered.        |
| `PUT /api/worlds/{world_id}/character-fields`                 | Owner/editor, active world        | Atomically replaces active requirements.                               |
| `GET /api/worlds/{world_id}/entities`                         | Active world member               | Roster with state and character completion.                            |
| `POST /api/worlds/{world_id}/entities`                        | Owner/editor, active world        | Creates entity/state root; optional controller memberships.            |
| `GET /api/worlds/{world_id}/entities/{entity_id}`             | Active world member               | One world entity.                                                      |
| `PUT /api/worlds/{world_id}/entities/{entity_id}`             | Owner/editor, active world        | Replaces display name/archive flag fields accepted by the command.     |
| `POST /api/worlds/{world_id}/entities/{entity_id}/archive`    | Owner/editor, active world        | Archives the entity.                                                   |
| `GET /api/worlds/{world_id}/entities/{entity_id}/state`       | Active world member               | Materialized scalar state.                                             |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/state`       | Owner/editor, active world        | Full logical values plus `expected_revision`.                          |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/controllers` | Owner/editor, active world        | Complete controller set using `expected_table_revision`.               |
| `GET /api/worlds/{world_id}/entities/{entity_id}/profile`     | Active world member               | Fields/values filtered by visibility and control.                      |
| `PUT /api/worlds/{world_id}/entities/{entity_id}/profile`     | Owner/editor or active controller | Complete non-empty values using profile and field-schema revisions.    |

Onboarding players may read only controlled entities until ready. Direct state
writes remain owner/editor setup operations; players edit only authorized
profile text.

### Invite links

| Method and path                                          | Authority                  | Notes                                                                                  |
| -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/invites`                     | Owner/editor, active world | Metadata only; never returns existing raw tokens.                                      |
| `POST /api/worlds/{world_id}/invites`                    | Owner/editor, active world | Role and 1–90 expiry days; response alone includes area-scoped `join_path`.            |
| `POST /api/worlds/{world_id}/invites/{invite_id}/revoke` | Owner/editor, active world | Idempotently revokes.                                                                  |
| `GET /api/world-invites/{opaque_token}`                  | Public                     | Preview when active, unexpired, and not revoked.                                       |
| `POST /api/world-invites/{opaque_token}/redeem`          | Known user                 | Creates/reactivates one matching world membership atomically.                          |

Tokens contain 256 random bits encoded as unpadded URL-safe base64. Only their
SHA-256 digest is stored. Redemption counts once per invite/user and never
escalates an already-active role.

### Interactions and actions

| Method and path                                                                          | Authority                    | Notes                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `GET /api/worlds/{world_id}/interactions`                                                | Play-ready world member      | Visibility-filtered feed.                                                   |
| `POST /api/worlds/{world_id}/interactions`                                               | Owner/editor facilitator     | Creates draft or creates/presents with `present:true`.                      |
| `GET /api/worlds/{world_id}/interactions/{interaction_id}`                               | Visible play-ready member    | One interaction; private data omitted for non-facilitators.                 |
| `PUT /api/worlds/{world_id}/interactions/{interaction_id}`                               | Owner/editor facilitator     | Replaces editable draft using expected revision.                            |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/present`                      | Owner/editor facilitator     | `draft → open`.                                                             |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/adjudicate`                   | Owner/editor facilitator     | `open → adjudicating`.                                                      |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/cancel`                       | Owner/editor facilitator     | Any unfinished state → cancelled.                                           |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions`                      | Eligible player              | Creates action; optional ready controlled acting entity.                    |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/actions/{action_id}/withdraw` | Owning player                | Withdraws submitted action using action revision.                           |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/preview`                      | Owner/editor facilitator     | Advisory ruling; no idempotency key required.                               |
| `POST /api/worlds/{world_id}/interactions/{interaction_id}/resolve`                      | Owner/editor facilitator     | Atomic state, immutable receipt, lifecycle, and world event.                |

### World events (SSE)

| Method and path                        | Authority               | Request                                               |
| -------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `GET /api/worlds/{world_id}/events`    | Play-ready world member | `?after=<non-negative ID>` or `Last-Event-ID`.        |

The stream sends `retry: 1500`, keep-alive comments, and compact events:

```text
id: 42
event: world-event
data: {"id":42,"type":"resolution-applied","interaction_id":"...","resolution_id":"...","actor_membership_id":"...","created_at":"..."}

```

The handler reauthorizes membership, emits at most 100 visible rows per batch,
and closes on revocation, cancellation, query failure, or write failure. The
client reconnects with its cursor. Events are invalidation signals only.

## Payload reference

### Mechanic

```json
{
  "kind": "capacity",
  "mode": "pool",
  "name": "Resolve",
  "description": "Composure under pressure.",
  "minimum": 0,
  "maximum": 12,
  "step": 1,
  "default_number": 8,
  "unit": "grit",
  "mutable_during_play": true,
  "archived": false
}
```

Capacities accept `score`/`pool`; capabilities accept `binary`/`rating`.
Binary mechanics omit numeric fields and default logically to false.

### State

State values are tagged number or Boolean scalars:

```json
{ "kind": "number", "value": 6 }
{ "kind": "boolean", "value": true }
```

Replacement:

```json
{
  "expected_revision": 3,
  "values": {
    "mechanic UUID": { "kind": "number", "value": 6 }
  }
}
```

Response:

```json
{
  "entity_id": "entity UUID",
  "revision": 4,
  "values": {
    "mechanic UUID": { "kind": "number", "value": 6 },
    "binary mechanic UUID": { "kind": "boolean", "value": false }
  },
  "defaulted_mechanic_ids": ["binary mechanic UUID"],
  "updated_at": "2026-01-01T00:00:00Z"
}
```

`values` is the complete logical map. Values equal to defaults normalize out
of `state_values` while remaining materialized in the response.

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
audience, and context entities must be active and eligible.

### Action and ruling

```json
{
  "text": "I jump for the hanging rope.",
  "acting_entity_id": "controlled entity UUID",
  "expected_revision": 3
}
```

The acting entity is optional but, when supplied, must be active, ready, and
controlled by the player. The server snapshots its display name.

Live effects are exactly:

```json
{ "id": "optional UUID", "type": "set", "entity_ids": ["UUID"], "mechanic_id": "UUID", "value": { "kind": "boolean", "value": true } }
{ "id": "optional UUID", "type": "adjust-number", "entity_ids": ["UUID"], "mechanic_id": "UUID", "amount": -2 }
```

Ruling:

```json
{
  "expected_revision": 4,
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
      "amount": -2
    }
  ]
}
```

Preview permits an empty idempotency key and never writes. Resolve requires a
non-empty key up to 200 characters. The response includes interaction revision,
narrative, ordered applied before/after effects, and affected state records.
Equivalent replay adds `replayed:true`.

## Limits and notable validation rules

| Item                                           | Limit/rule                           |
| ---------------------------------------------- | ------------------------------------ |
| API request body                               | 1 MiB                                |
| Names/labels/display names                     | Usually 200 characters               |
| Interaction title                              | 200 characters                       |
| Interaction prompt/action text                 | 10,000 characters                    |
| Interaction/ruling private notes and narrative | 20,000 characters                    |
| Character fields                               | 50 active; label 200/guidance 2,000  |
| Character-field value                          | 20,000 characters                    |
| Live ruling effects                            | 100                                  |
| Entity/user/world lists                        | 500–1000 depending on resource       |
| SSE batch                                      | 100 events                           |

For mechanical and lifecycle invariants, see [Domain model](domain-model.md).

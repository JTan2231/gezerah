# HTTP API reference

## Scope and stability

The API is same-origin and rooted at `/api`. The React application is its
primary client. There is no explicit API version prefix or published backwards-
compatibility policy, so coordinated client/server changes should land together.

Ruleset authoring endpoints are trusted-environment tools and currently have no
authentication checks. Game and interaction endpoints use a development-only
identity header plus server-side membership/role authorization. See
[Security](security.md) before exposing any endpoint outside a trusted network.

## Conventions

### JSON

- Success responses are direct JSON objects or arrays, not wrapped in `data`.
- Creates normally return `201 Created` and a `Location` header.
- Updates, commands, previews, and queries normally return `200 OK`.
- Request bodies are limited to 1 MiB.
- Decoding rejects unknown properties and trailing/multiple JSON values.
- JSON properties use `snake_case`.
- Times are UTC-compatible RFC 3339 JSON strings emitted by Go's `time.Time`.
- Optional blank descriptions/notes are commonly trimmed and normalized to
  absence.
- Create DTOs often accept an optional caller-supplied UUID. The server
  generates a UUID when it is omitted. PUT body IDs, when present, must match
  the path ID.

Backend numeric decoding uses `json.Number` and exact decimals. Send finite JSON
numbers, not quoted numbers, `NaN`, or infinities.

### Identity

`GET /api/users` and `POST /api/users` are public within the trusted deployment.
Every other `/api/games*` or `/api/play*` request must include:

```http
X-DND-User-ID: 2a7c0a53-65be-47d6-9e71-a97cbb1e53d4
```

The UUID must identify a row in `users`. This header is forgeable and is an
identity adapter, not authentication. Commands never accept an acting user or
membership ID in the body; the server derives the actor from the header.

### Error envelope

Every application-generated API error has this shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "state variable is invalid",
    "fields": {
      "value_schema.step": "step must be positive"
    }
  }
}
```

`fields` is optional. Its keys are field paths, which may include collection
indices or durable nested IDs.

Common status/code pairs are:

| Status | Typical codes                                                                                         | Meaning                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 400    | `invalid_json`, `invalid_id`, `invalid_cursor`, `endpoint_not_found`                                  | The transport, path ID, or query syntax is malformed.                     |
| 401    | `authentication_required`, `invalid_identity`                                                         | The development identity header is absent, malformed, or unknown.         |
| 403    | `game_forbidden`, `facilitator_required`, `player_required`, `responder_required`, `action_forbidden` | The known actor lacks membership, role, audience, or ownership authority. |
| 404    | `not_found`                                                                                           | The resource is absent or deliberately hidden by visibility filtering.    |
| 409    | `revision_conflict`, `duplicate_key`, `configuration_changed`, lifecycle and in-use codes             | Current state conflicts with the command.                                 |
| 422    | `validation_failed`, `invalid_reference`, `archived_reference`                                        | JSON is structurally readable but violates a domain or database rule.     |
| 500    | `internal_error`, `database_error`                                                                    | Unexpected server/database failure.                                       |
| 503    | `database_unavailable`                                                                                | Health check could not ping PostgreSQL.                                   |

The standard-library mux may return its own `405 Method Not Allowed` response
for a known path with the wrong method.

### Optimistic concurrency

Overwrite-sensitive requests use an expected revision. A mismatch returns
`409 revision_conflict` with expected/actual details where available. Revisions
are aggregate-specific; do not substitute an entity state revision for a game
or interaction revision.

| Request field                                                | Protects                                                |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `expected_revision` on state replacement                     | Entity state record.                                    |
| `expected_binding_revision`                                  | Problem-instance bindings.                              |
| `expected_state_revisions`                                   | Configured-resolution state records named by entity ID. |
| `expected_revision` on membership update                     | Membership.                                             |
| `expected_revision` on game entity/archive command           | Game.                                                   |
| `expected_revision` on interaction command/action submission | Interaction.                                            |
| `expected_revision` on action withdrawal                     | Action submission.                                      |

Reads and previews do not reserve a revision. Always use the latest
authoritative response immediately before a consequential write.

### Archive filters

Configuration collection endpoints that support `?archived=true|false` behave
as follows:

- `true`: only archived resources;
- `false`: only active resources;
- absent or any other value: both active and archived.

The frontend typically requests both and filters locally.

## Route catalog

Path placeholders in the tables are UUIDs unless noted otherwise. `Trusted`
means no current authentication/authorization middleware; it does not mean safe
for public access.

### Health

| Method and path   | Authority | Request | Response                                                                             |
| ----------------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| `GET /api/health` | Public    | None    | `200 {"ok":true,"timestamp":"..."}` after a two-second database ping; otherwise 503. |

### Rulesets

| Method and path                      | Authority | Request                      | Response/notes      |
| ------------------------------------ | --------- | ---------------------------- | ------------------- |
| `GET /api/rule-sets`                 | Trusted   | None                         | Up to 500 rulesets. |
| `POST /api/rule-sets`                | Trusted   | `RuleSetCreate`              | Created `RuleSet`.  |
| `GET /api/rule-sets/{rule_set_id}`   | Trusted   | None                         | One `RuleSet`.      |
| `PATCH /api/rule-sets/{rule_set_id}` | Trusted   | Partial key/name/description | Updated `RuleSet`.  |

### Owner schemas

| Method and path                                                             | Authority | Request           | Response/notes                    |
| --------------------------------------------------------------------------- | --------- | ----------------- | --------------------------------- |
| `GET /api/rule-sets/{rule_set_id}/owner-schemas`                            | Trusted   | `?archived=`      | Ordered collection.               |
| `POST /api/rule-sets/{rule_set_id}/owner-schemas`                           | Trusted   | `OwnerSchemaSave` | Creates active schema.            |
| `GET /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}`          | Trusted   | None              | One schema.                       |
| `PUT /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}`          | Trusted   | `OwnerSchemaSave` | Complete replacement.             |
| `POST /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}/archive` | Trusted   | No body           | Soft-archives and returns schema. |

### Entities and state

| Method and path                                                  | Authority | Request                                          | Response/notes                                                        |
| ---------------------------------------------------------------- | --------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /api/rule-sets/{rule_set_id}/entities`                      | Trusted   | Optional `archived`, `owner_schema_id`, `search` | Up to 1000. Search is case-insensitive and limited to 120 characters. |
| `POST /api/rule-sets/{rule_set_id}/entities`                     | Trusted   | `EntitySave`                                     | Creates entity and empty state root.                                  |
| `GET /api/rule-sets/{rule_set_id}/entities/{entity_id}`          | Trusted   | None                                             | One `Entity`.                                                         |
| `PUT /api/rule-sets/{rule_set_id}/entities/{entity_id}`          | Trusted   | `EntitySave`                                     | Complete replacement; dependency safety is revalidated.               |
| `POST /api/rule-sets/{rule_set_id}/entities/{entity_id}/archive` | Trusted   | No body                                          | Soft-archives entity.                                                 |
| `GET /api/rule-sets/{rule_set_id}/entities/{entity_id}/state`    | Trusted   | None                                             | Materialized `StateRecord`.                                           |
| `PUT /api/rule-sets/{rule_set_id}/entities/{entity_id}/state`    | Trusted   | `StateReplace`                                   | Full stored-override replacement; no-op does not increment revision.  |

### State-variable definitions

| Method and path                                                                        | Authority | Request             | Response/notes                                            |
| -------------------------------------------------------------------------------------- | --------- | ------------------- | --------------------------------------------------------- |
| `GET /api/rule-sets/{rule_set_id}/state-variable-definitions`                          | Trusted   | `?archived=`        | Ordered collection.                                       |
| `POST /api/rule-sets/{rule_set_id}/state-variable-definitions`                         | Trusted   | `StateVariableSave` | Creates active definition.                                |
| `GET /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}`          | Trusted   | None                | One definition.                                           |
| `PUT /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}`          | Trusted   | `StateVariableSave` | Complete replacement. Used semantic fields may be locked. |
| `POST /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}/archive` | Trusted   | No body             | Soft-archives definition.                                 |

### Conditions

| Method and path                                                                 | Authority | Request             | Response/notes                                                        |
| ------------------------------------------------------------------------------- | --------- | ------------------- | --------------------------------------------------------------------- |
| `GET /api/rule-sets/{rule_set_id}/condition-sets`                               | Trusted   | `?archived=`        | Ordered collection.                                                   |
| `POST /api/rule-sets/{rule_set_id}/condition-sets`                              | Trusted   | `ConditionSetSave`  | Creates active set.                                                   |
| `GET /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}`            | Trusted   | None                | One set.                                                              |
| `PUT /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}`            | Trusted   | `ConditionSetSave`  | Complete replacement; existing problem invocations must remain valid. |
| `POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/duplicate` | Trusted   | No body             | Deep copy with fresh owned IDs and available key.                     |
| `POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/archive`   | Trusted   | No body             | Soft-archives set.                                                    |
| `POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/evaluate`  | Trusted   | `ConditionEvaluate` | Repeatable-read `ConditionEvaluation`.                                |

### Problem definitions and instances

| Method and path                                                                                         | Authority | Request                                | Response/notes                                                  |
| ------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- | --------------------------------------------------------------- |
| `GET /api/rule-sets/{rule_set_id}/problem-definitions`                                                  | Trusted   | `?archived=`                           | Ordered collection.                                             |
| `POST /api/rule-sets/{rule_set_id}/problem-definitions`                                                 | Trusted   | `ProblemDefinitionSave`                | Creates active definition.                                      |
| `GET /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}`                          | Trusted   | None                                   | One complete aggregate.                                         |
| `PUT /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}`                          | Trusted   | `ProblemDefinitionSave`                | Complete replacement and projection against existing instances. |
| `POST /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/duplicate`               | Trusted   | Empty or `{key?,name?}`                | Deep copy with fresh owned IDs.                                 |
| `POST /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/archive`                 | Trusted   | No body                                | Soft-archives definition.                                       |
| `GET /api/rule-sets/{rule_set_id}/problem-instances`                                                    | Trusted   | Optional `problem_definition_id`       | Instances, optionally filtered.                                 |
| `POST /api/rule-sets/{rule_set_id}/problem-instances`                                                   | Trusted   | `ProblemInstanceCreate`                | Creates instance entity, state root, and bindings.              |
| `GET /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}`                              | Trusted   | None                                   | One instance.                                                   |
| `PUT /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/bindings`                     | Trusted   | `ProblemBindingsReplace`               | Complete binding replacement.                                   |
| `POST /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/preview` | Trusted   | Empty or `ConfiguredResolutionRequest` | Advisory `ChoiceResolutionResult`; never persists.              |
| `POST /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/resolve` | Trusted   | Empty or `ConfiguredResolutionRequest` | Persists state only when status is `applied`.                   |

Configured execution does not create a durable configured-resolution receipt or
game event. Its durable output is the changed state.

### Users and games

| Method and path                     | Authority      | Request               | Response/notes                                          |
| ----------------------------------- | -------------- | --------------------- | ------------------------------------------------------- |
| `GET /api/users`                    | Public/trusted | None                  | Up to 1000 local users.                                 |
| `POST /api/users`                   | Public/trusted | `{id?,display_name}`  | Creates local user.                                     |
| `GET /api/games`                    | Known user     | None                  | Games where actor has active membership.                |
| `POST /api/games`                   | Known user     | `GameCreate`          | Creates active game and actor's facilitator membership. |
| `GET /api/games/{game_id}`          | Active member  | None                  | Complete game/membership/entity-ID summary.             |
| `POST /api/games/{game_id}/archive` | Facilitator    | `{expected_revision}` | Archives only when every interaction is final.          |

### Game membership and entity scope

| Method and path                                            | Authority     | Request                          | Response/notes                                                                                                                  |
| ---------------------------------------------------------- | ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/games/{game_id}/entities`                        | Active member | None                             | Entities assigned to this game.                                                                                                 |
| `GET /api/games/{game_id}/available-entities`              | Facilitator   | None                             | Current/available candidates used by game management.                                                                           |
| `GET /api/play/rule-sets/{rule_set_id}/available-entities` | Known user    | None                             | Active entities in ruleset not assigned to any game.                                                                            |
| `GET /api/games/{game_id}/state-variable-definitions`      | Active member | None                             | Definitions eligible for at least one mapped entity, including archived definitions needed to interpret retained state/history. |
| `PUT /api/games/{game_id}/entities`                        | Facilitator   | `{entity_ids,expected_revision}` | Replaces mapping; referenced historical entities cannot be released.                                                            |
| `POST /api/games/{game_id}/memberships`                    | Facilitator   | `MembershipCreate`               | Adds invited or active membership; returns updated game.                                                                        |
| `PUT /api/games/{game_id}/memberships/{membership_id}`     | Facilitator   | `MembershipUpdate`               | Updates role/status; returns updated game.                                                                                      |
| `PATCH /api/games/{game_id}/memberships/{membership_id}`   | Facilitator   | `MembershipUpdate`               | Alias of PUT used by the current UI.                                                                                            |

### Interactions and actions

| Method and path                                                                        | Authority       | Request                                       | Response/notes                                                                            |
| -------------------------------------------------------------------------------------- | --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /api/games/{game_id}/interactions`                                                | Active member   | None                                          | Visibility-filtered feed. Facilitator sees all; others see addressed open/resolved items. |
| `POST /api/games/{game_id}/interactions`                                               | Facilitator     | `InteractionSave`                             | Creates draft or creates/presents with `present:true`.                                    |
| `GET /api/games/{game_id}/interactions/{interaction_id}`                               | Visible member  | None                                          | One filtered interaction; private data omitted for non-facilitators.                      |
| `PUT /api/games/{game_id}/interactions/{interaction_id}`                               | Facilitator     | `InteractionSave`                             | Replaces editable draft using expected revision.                                          |
| `POST /api/games/{game_id}/interactions/{interaction_id}/present`                      | Facilitator     | `{expected_revision}`                         | `draft → open`.                                                                           |
| `POST /api/games/{game_id}/interactions/{interaction_id}/adjudicate`                   | Facilitator     | `{expected_revision}`                         | `open → adjudicating`.                                                                    |
| `POST /api/games/{game_id}/interactions/{interaction_id}/cancel`                       | Facilitator     | `{expected_revision}`                         | Any non-final state → cancelled.                                                          |
| `POST /api/games/{game_id}/interactions/{interaction_id}/actions`                      | Eligible player | `{text,expected_revision}`                    | Creates submitted action; guard is interaction revision.                                  |
| `POST /api/games/{game_id}/interactions/{interaction_id}/actions/{action_id}/withdraw` | Owning player   | `{expected_revision}`                         | Withdraws submitted action; guard is action revision.                                     |
| `POST /api/games/{game_id}/interactions/{interaction_id}/preview`                      | Facilitator     | `LiveRuling` without required idempotency key | Advisory state; interaction must be adjudicating.                                         |
| `POST /api/games/{game_id}/interactions/{interaction_id}/resolve`                      | Facilitator     | `LiveRuling` with idempotency key             | Atomic state + receipt + lifecycle + event.                                               |

### Game events (SSE)

| Method and path                   | Authority     | Request                                                      | Response/notes                  |
| --------------------------------- | ------------- | ------------------------------------------------------------ | ------------------------------- |
| `GET /api/games/{game_id}/events` | Active member | Optional `?after=<non-negative event ID>` or `Last-Event-ID` | Long-lived `text/event-stream`. |

The server sends an initial `retry: 1500`, then events such as:

```text
id: 42
event: game-event
data: {"id":42,"type":"resolution-applied","interaction_id":"...","resolution_id":"...","actor_membership_id":"...","created_at":"..."}

```

Empty batches produce keep-alive comments. The handler polls and reauthorizes
the membership every 1.5 seconds, emits at most 100 visible events per batch,
and closes silently if membership is revoked or the client disconnects.
Facilitators receive all events; other roles receive only events safe for their
visible interactions. Consumers should use the event as an invalidation signal
and reload authoritative game resources.

## Payload reference

Timestamps shown on responses are omitted from most examples for brevity.

### Ruleset, schema, and entity

`RuleSetCreate`:

```json
{
  "id": "optional UUID",
  "key": "my-rules",
  "name": "My Rules",
  "description": "optional"
}
```

`OwnerSchemaSave`:

```json
{
  "id": "optional UUID",
  "key": "actor",
  "label": "Actor",
  "description": "optional",
  "archived": false
}
```

`EntitySave`:

```json
{
  "id": "optional UUID",
  "key": "hero",
  "display_name": "Hero",
  "owner_schema_ids": ["schema UUID"],
  "archived": false
}
```

Entity responses add `state_revision`, timestamps, and always return an array
for `owner_schema_ids`. `key` may be absent.

### State values

A singular value is one tagged scalar; a many-valued value is an array of
tagged scalars, including `[]` for the empty set.

```json
{ "kind": "text", "value": "ready" }
{ "kind": "choice", "value": "wounded" }
{ "kind": "measurement", "amount": 1.75, "unit": "m" }
{ "kind": "number", "value": 12.5 }
{ "kind": "boolean", "value": true }
{ "kind": "reference", "entity_id": "UUID", "fallback_name": "Old name" }
[
  { "kind": "text", "value": "poisoned" },
  { "kind": "text", "value": "prone" }
]
```

Choice `value` is the authored choice-option key, not its UUID. Measurement
`unit` is authored unit text, not its UUID. References use entity UUIDs.

### State-variable definition

```json
{
  "id": "optional UUID",
  "key": "core-health",
  "label": "Health",
  "description": "Current vitality",
  "owner_schema_ids": ["actor schema UUID"],
  "cardinality": "one",
  "value_schema": {
    "kind": "number",
    "minimum": 0,
    "maximum": 100,
    "step": 1,
    "unit": "hp"
  },
  "missing_value": {
    "kind": "default",
    "value": { "kind": "number", "value": 100 },
    "omit_when_stored": true
  },
  "presentation": {
    "group": "Vitals",
    "control": "number",
    "help_text": "Hit points remaining"
  },
  "condition_addressable": true,
  "allowed_effect_operations": ["set", "clear", "adjust-number"],
  "display_order": 0,
  "archived": false
}
```

`value_schema` variants are:

```json
{ "kind": "text" }
{ "kind": "boolean" }
{
  "kind": "choice",
  "options": [
    { "id": "optional UUID", "key": "ready", "label": "Ready" }
  ]
}
{
  "kind": "measurement",
  "units": [{ "id": "optional UUID", "unit": "m" }],
  "minimum": 0,
  "maximum": 10,
  "step": 0.25
}
{
  "kind": "reference",
  "target_owner_schema_ids": ["schema UUID"]
}
```

`missing_value` is exactly one of:

```json
{ "kind": "unknown" }
{ "kind": "default", "value": [], "omit_when_stored": true }
```

### State replacement and response

`StateReplace`:

```json
{
  "expected_revision": 3,
  "values": {
    "state-variable UUID": { "kind": "number", "value": 72 },
    "many-variable UUID": []
  }
}
```

`values` is the complete set of stored overrides, not a patch. Omit a
definition to clear its override.

`StateRecord`:

```json
{
  "owner_entity_id": "entity UUID",
  "revision": 4,
  "values": {
    "state-variable UUID": { "kind": "number", "value": 72 }
  },
  "defaulted_definition_ids": ["another definition UUID"],
  "unknown_definition_ids": ["unknown definition UUID"],
  "updated_at": "2026-01-01T00:00:00Z"
}
```

### Conditions

`ConditionSetSave`:

```json
{
  "id": "optional UUID",
  "key": "is-ready",
  "name": "Is ready",
  "description": "optional",
  "parameters": [
    {
      "id": "optional UUID",
      "key": "subject",
      "label": "Subject",
      "cardinality": "one",
      "required_owner_schema_ids": ["schema UUID"]
    }
  ],
  "root": {
    "id": "optional UUID",
    "type": "criterion",
    "parameter_id": "parameter UUID",
    "quantifier": "single",
    "state_variable_id": "variable UUID",
    "predicate": { "kind": "number", "operator": "gt", "value": 0 }
  },
  "archived": false
}
```

Expression variants:

```json
{ "id": "UUID", "type": "all", "children": [] }
{ "id": "UUID", "type": "any", "children": [] }
{ "id": "UUID", "type": "at-least", "count": 2, "children": [] }
```

Groups must actually contain children; empty arrays above only illustrate the
tagged shapes. Criterion quantifiers are `single` for singular parameters and
`any`, `all`, or `at-least` (with `count`) for plural parameters.

Predicate variants:

```json
{ "kind": "number", "operator": "eq", "value": 10 }
{ "kind": "number", "operator": "gt", "value": 10 }
{ "kind": "number-range", "operator": "between", "minimum": 1, "maximum": 5 }
{ "kind": "boolean", "operator": "is", "value": true }
{ "kind": "choice", "operator": "is", "value": "ready" }
{ "kind": "choice-set", "operator": "one-of", "values": ["ready", "waiting"] }
```

Choice operands are option keys at the HTTP boundary.

Evaluation request:

```json
{
  "arguments": [
    { "parameter_id": "parameter UUID", "entity_ids": ["entity UUID"] }
  ]
}
```

Evaluation returns `condition_set_id`, overall `status`, a recursive `root`
containing expression IDs/messages/entity results/actual values, and
`missing_values` state addresses.

### Problems

The complete problem payload is an aggregate. The following example shows an
automatic choice; conditional resolution replaces `outcome` with
`invocation`, `met`, and `unmet`.

```json
{
  "id": "optional UUID",
  "key": "take-damage",
  "name": "Take damage",
  "description": "optional",
  "instance_owner_schema_ids": ["actor schema UUID"],
  "targets": [
    {
      "id": "optional UUID",
      "key": "self",
      "label": "Self",
      "cardinality": "one",
      "minimum_bindings": 1,
      "maximum_bindings": 1,
      "binding_source": "problem-instance",
      "required_owner_schema_ids": ["actor schema UUID"]
    }
  ],
  "choices": [
    {
      "id": "optional UUID",
      "key": "take-ten",
      "name": "Take ten",
      "resolution": {
        "type": "automatic",
        "outcome": {
          "id": "optional UUID",
          "label": "Damage applied",
          "consequences": {
            "id": "optional UUID",
            "effects": [
              {
                "id": "optional UUID",
                "type": "adjust-number",
                "target_definition_id": "target UUID",
                "state_variable_id": "health UUID",
                "amount": -10
              }
            ]
          }
        }
      }
    }
  ],
  "archived": false
}
```

Problem and choice `available_when` fields use:

```json
{
  "id": "optional UUID",
  "condition_set_id": "condition UUID",
  "arguments": [
    {
      "parameter_id": "condition parameter UUID",
      "target_definition_id": "problem target UUID"
    }
  ]
}
```

Effect variants:

```json
{ "id": "UUID", "type": "set", "target_definition_id": "UUID", "state_variable_id": "UUID", "value": { "kind": "boolean", "value": true } }
{ "id": "UUID", "type": "clear", "target_definition_id": "UUID", "state_variable_id": "UUID" }
{ "id": "UUID", "type": "adjust-number", "target_definition_id": "UUID", "state_variable_id": "UUID", "amount": -2 }
{ "id": "UUID", "type": "add-value", "target_definition_id": "UUID", "state_variable_id": "UUID", "value": { "kind": "text", "value": "tag" } }
{ "id": "UUID", "type": "remove-value", "target_definition_id": "UUID", "state_variable_id": "UUID", "value": { "kind": "text", "value": "tag" } }
```

Array order determines target/choice/effect positions on transport; responses
return ordered arrays.

### Problem instances and configured resolution

`ProblemInstanceCreate`:

```json
{
  "id": "optional UUID",
  "problem_definition_id": "problem UUID",
  "key": "optional-key",
  "display_name": "Training dummy",
  "bindings": [
    { "target_definition_id": "target UUID", "entity_ids": ["entity UUID"] }
  ]
}
```

`ProblemBindingsReplace`:

```json
{
  "expected_binding_revision": 2,
  "bindings": [
    { "target_definition_id": "target UUID", "entity_ids": ["entity UUID"] }
  ]
}
```

`ConfiguredResolutionRequest`:

```json
{
  "expected_binding_revision": 2,
  "expected_state_revisions": {
    "bound entity UUID": 7
  }
}
```

The result status is `applied`, `unavailable`, or `incomplete`. It identifies
the problem/instance/choice, includes availability and resolution evaluations,
and for an applied result includes outcome ID, binding revision, ordered applied
effects, and a state-record map. Preview adds `"preview": true`.

On an applied-effect row, `changed` describes a change to persisted override
state. `before` and `after` are logical values, so they may be equal when a
redundant stored override is cleared back to the same authored default.

### Games and memberships

`GameCreate`:

```json
{
  "id": "optional UUID",
  "rule_set_id": "ruleset UUID",
  "name": "Friday game",
  "entity_ids": ["entity UUID"]
}
```

`MembershipCreate`:

```json
{
  "id": "optional UUID",
  "user_id": "user UUID",
  "role": "player",
  "status": "active"
}
```

`MembershipUpdate`:

```json
{
  "role": "spectator",
  "status": "active",
  "expected_revision": 3
}
```

At least one of `role` or `status` is required on update. Roles are
`facilitator`, `player`, `spectator`; statuses are `invited`, `active`, `left`.
Game responses include the membership array, assigned `entity_ids`, game
revision/status, creator user ID, and timestamps.

### Interaction

`InteractionSave`:

```json
{
  "id": "optional UUID",
  "present": false,
  "expected_revision": 0,
  "title": "The bridge",
  "prompt": "The bridge gives way. What do you do?",
  "private_notes": "Hidden hinge was sabotaged.",
  "audience_membership_ids": ["membership UUID"],
  "eligible_responder_membership_ids": ["player membership UUID"],
  "entity_ids": ["game entity UUID"]
}
```

`expected_revision` is used for PUT; create does not need it. An omitted/empty
audience on create is expanded to active game members. Eligible responders must
be active player memberships in the audience. The current API writes context
entities as public and does not expose context labels/visibility fields even
though relational support exists.

Interaction responses include revision/status, related membership/entity IDs,
actions, optional applied resolution, and lifecycle timestamps. Non-facilitator
responses omit interaction and resolution private notes plus any non-public
context entities.

### Concrete live effects and ruling

Live effects replace the abstract problem target with concrete `entity_ids`:

```json
{ "id": "UUID", "type": "set", "entity_ids": ["UUID"], "state_variable_id": "UUID", "value": [] }
{ "id": "UUID", "type": "clear", "entity_ids": ["UUID"], "state_variable_id": "UUID" }
{ "id": "UUID", "type": "adjust-number", "entity_ids": ["UUID"], "state_variable_id": "UUID", "amount": -2 }
{ "id": "UUID", "type": "add-value", "entity_ids": ["UUID"], "state_variable_id": "UUID", "value": { "kind": "text", "value": "tag" } }
```

Every live effect requires at least one distinct `entity_id`; effect IDs are
generated when omitted. Every target/reference must stay inside the game entity
mapping. (The pure transition engine can represent an empty resolved target,
which is relevant to an optional configured-problem target, but the live ruling
transport intentionally rejects an empty concrete target list.)

`LiveRuling`:

```json
{
  "expected_revision": 5,
  "idempotency_key": "client-generated unique value",
  "selected_action_id": "optional action UUID",
  "action_summary": "optional",
  "narrative": "You catch the beam but land hard.",
  "private_notes": "optional facilitator-only note",
  "effects": [
    {
      "id": "effect UUID",
      "type": "adjust-number",
      "entity_ids": ["hero UUID"],
      "state_variable_id": "health UUID",
      "amount": -2
    }
  ]
}
```

`narrative` is required; zero effects is valid. Resolve requires a non-empty
idempotency key up to 200 characters. The response includes the interaction ID
and revision, narrative, ordered applied before/after effects, and affected
state records. A safely replayed resolve adds `"replayed": true`.

## Limits and notable validation rules

| Item                                           | Limit/rule                           |
| ---------------------------------------------- | ------------------------------------ |
| API request body                               | 1 MiB                                |
| Common configuration key                       | 120 characters, lowercase key syntax |
| Common names/labels/display names              | Usually 200 characters               |
| Interaction title                              | 200 characters                       |
| Interaction prompt/action text                 | 10,000 characters                    |
| Interaction/ruling private notes and narrative | 20,000 characters                    |
| Live ruling effects                            | 100                                  |
| Condition tree                                 | 10 levels, 250 nodes                 |
| Ruleset list                                   | 500                                  |
| Entity/user lists                              | 1000                                 |
| SSE batch                                      | 100 events per poll                  |

Database constraints and domain validation add relationship-specific rules not
fully enumerable at the transport layer. For the mechanical invariants behind
validation, see [Domain model](domain-model.md).

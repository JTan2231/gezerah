# Stateful Rule Composer Implementation Design

## Purpose

This document specifies how to implement the domain and relational model in
`DATA.md`. It covers the Go backend, PostgreSQL access, REST API, React
frontend, transaction boundaries, validation flow, migrations, tests, and
implementation sequence.

`DATA.md` is authoritative for domain semantics and relational invariants. This
document translates that model into code and HTTP behavior. It does not add a
built-in world ontology, state-variable catalog, target vocabulary, or special
transition actor.

The system is one deployable Go/PostgreSQL web application. The browser uses
Bun, TypeScript, and React. The Go binary serves both `/api/*` JSON endpoints
and the compiled frontend.

## Implementation invariants

The implementation must preserve these model boundaries throughout the stack:

- every state owner and reference target is a generic ruleset-scoped entity;
- owner schemas are authored capabilities, not Go subtypes or privileged keys;
- variables declare which owner schemas may own them;
- a state record belongs to one entity, and world state is the logical
  collection of those records;
- conditions address declared parameters rather than concrete entities or
  problem targets;
- problem definitions declare target slots and map condition parameters to
  those slots through explicit invocations;
- problem instances bind supplied targets to concrete entities and are
  themselves entities;
- effects address problem targets and may therefore affect any number of state
  records;
- preview and resolution derive all concrete entities from current instance
  bindings; neither request supplies a distinguished participant;
- current definitions, bindings, and state are mutable and unversioned except
  for optimistic state and binding revisions; and
- no engine behavior branches on an authored key.

API maps, slices, and nested objects are transport conveniences. They do not
weaken the normalized PostgreSQL model or introduce retained snapshots.

## Technical decisions

### Backend

- Go 1.25 or the current repository-pinned Go 1.25 patch release.
- Standard-library `net/http` server and method-aware `http.ServeMux` routes.
- Standard-library `encoding/json` for request and response bodies.
- `github.com/jackc/pgx/v5` and `pgxpool` for PostgreSQL.
- Handwritten SQL rather than an ORM.
- Embedded forward-only SQL migrations applied during startup.
- `log/slog` for structured request and application logging.
- `go:embed` for production frontend assets.

### Frontend

- Bun as package manager and script runner.
- TypeScript and React.
- Vite for development and production bundling.
- Native `fetch` for same-origin `/api/*` requests.
- Local React state for contained editors; introduce a state-machine or global
  state library only when a workflow demonstrates the need.

### Persistence

- PostgreSQL is the source of truth.
- The schema is the normalized model in `DATA.md`.
- No `json`, `jsonb`, PostgreSQL array, or enum columns store domain data.
- Nested JSON exists only in HTTP DTOs and in-memory Go structures.
- Aggregate loaders hydrate normalized rows into domain structs.
- Aggregate writers validate and update owned rows transactionally.
- Current state and target bindings are updated in place. The initial system
  writes no event, history, definition revision, or snapshot records.

## Repository layout

```text
cmd/dnd/
  main.go                    process startup and graceful shutdown

internal/app/
  config.go                  environment configuration
  server.go                  route registration and middleware
  json.go                    strict JSON helpers and errors
  handlers_rule_sets.go
  handlers_owner_schemas.go
  handlers_entities.go
  handlers_state_variables.go
  handlers_state.go
  handlers_condition_sets.go
  handlers_problems.go
  handlers_problem_instances.go
  handlers_resolution.go
  api_types.go               request and response DTOs

internal/rules/
  types.go                   storage-neutral IDs and domain types
  values.go                  normalization and typed-value comparison
  ownership.go               schema membership and eligibility
  definitions.go             variable-definition validation
  state.go                   logical defaults and state validation
  conditions.go              parameterized tree validation and evaluation
  bindings.go                target-binding validation
  effects.go                 effect validation and application
  problems.go                problem aggregate and invocation validation
  resolution.go              pure transition orchestration
  explanations.go            derived human-readable messages

internal/store/
  store.go                   store and transaction interfaces
  owner_schemas.go
  entities.go
  state_variables.go
  state.go
  condition_sets.go
  problems.go
  problem_instances.go
  resolution.go              locking and state persistence helpers

internal/migrations/
  migrations.go              embedded migration runner
  001_foundations.sql
  002_state_variables.sql
  ...

web/
  static.go                  embedded production filesystem
  static/                    generated Vite output
  frontend/
    package.json
    bun.lock
    vite.config.ts
    tsconfig.json
    src/
      api/
      components/
      features/owner-schemas/
      features/entities/
      features/state-variables/
      features/condition-sets/
      features/problems/
      features/problem-instances/
      features/state-inspector/
      features/resolution/
      App.tsx
      main.tsx

ci.sh
run.sh
```

HTTP handlers coordinate requests, authorization, domain validation, and
stores. They do not implement condition or effect semantics. Store code does
not decide domain validity beyond detecting malformed stored rows and surfacing
constraint violations.

## Process lifecycle

Startup follows this order:

1. Create a signal-aware root context.
2. Load environment configuration.
3. Create a `pgxpool.Pool` and verify it with `Ping`.
4. Run unapplied embedded migrations in filename order.
5. Build the embedded static handler.
6. Construct stores and the HTTP server.
7. Listen until `SIGINT` or `SIGTERM`.
8. Stop accepting requests and perform a bounded graceful shutdown.

The request path is:

```text
Browser
  -> /api/*
  -> request logging and recovery middleware
  -> authentication/authorization seam
  -> net/http handler
  -> strict DTO decoding
  -> domain validation/evaluation
  -> pgx store or transaction
  -> JSON response

Browser
  -> any non-API path
  -> embedded static asset or index.html SPA fallback
```

Suggested initial configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DND_ADDR` | `:8080` | HTTP listen address. |
| `PORT` | unset | Hosting-provider fallback port. |
| `DND_DATABASE_URL` | `postgres://localhost:5432/dnd?sslmode=disable` | PostgreSQL URL. |
| `DATABASE_URL` | unset | Hosting-provider fallback database URL. |
| `DND_LOG_LEVEL` | `info` | Structured log level. |

Authentication and user roles are not yet defined by the product model. Every
handler nevertheless operates through a ruleset-scoped authorization function
so authentication can be added without rewriting queries. A local build may
expose an explicitly selected development ruleset; it must not depend on a
particular seeded ruleset or configured key.

## Domain package design

`internal/rules` is a pure package: it accepts structs and returns values or
typed errors. It does not know about HTTP, SQL, `pgx`, or React.

Important closed vocabularies include:

```go
type ValueKind string
type Cardinality string
type ConditionStatus string
type ConditionQuantifier string
type EffectOperation string
type BindingSource string

const (
    ConditionMet     ConditionStatus = "met"
    ConditionUnmet   ConditionStatus = "unmet"
    ConditionUnknown ConditionStatus = "unknown"
)
```

Owner schemas, entities, condition parameters, problem targets, and bindings
are structs identified by UUIDs. They are not closed Go enums. There is no
`OwnerType`, `StateTarget`, participant subtype, or hard-coded problem target.

Do not model typed values as `map[string]any`. Use a tagged Go union with
private or carefully validated construction. One acceptable shape is:

```go
type ScalarValue struct {
    Kind               ValueKind
    Text               *string
    Number             *DecimalValue
    Boolean            *bool
    ChoiceOptionID     *uuid.UUID
    MeasurementAmount  *DecimalValue
    MeasurementUnitID  *uuid.UUID
    ReferencedEntityID *uuid.UUID
    FallbackName       *string
}

type StateValue struct {
    Cardinality Cardinality
    Values      []ScalarValue
}
```

Constructors and validation guarantee the union shape. `DecimalValue` may
initially wrap a canonical decimal string or a selected decimal package.
Converting PostgreSQL `numeric` through `float64` is prohibited when bounds or
step alignment could lose precision.

World state and binding context use UUID-keyed collections:

```go
type StateSnapshot struct {
    Records map[uuid.UUID]StateRecord // entity ID -> current record
}

type TargetBindings map[uuid.UUID][]uuid.UUID // target ID -> entity IDs
```

Binding slices retain binding position. Many-valued state uses set semantics,
but deterministic slice order is retained for editing, serialization, and
effect traversal.

Domain APIs operate on stable UUIDs. Human-readable keys are lookup and editing
identities, never foreign keys inside rules. Domain functions receive all
referenced owner-schema, variable, entity, condition, target, and binding
metadata explicitly; they never infer semantics from keys.

## JSON API conventions

- All endpoints live below `/api`.
- Resource fields use `snake_case` JSON names.
- UUIDs are strings.
- Timestamps use RFC 3339 UTC strings.
- Request decoders reject unknown fields and trailing JSON tokens.
- Collections return `[]`, never `null`.
- Optional fields are omitted or `null` consistently according to their DTO.
- Successful creation returns `201 Created` and a `Location` header.
- Successful replacement returns the authoritative saved resource.
- Deletion is generally replaced by archive operations for referenced
  definitions and schemas.

Errors use one stable envelope:

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "state changed since it was loaded",
    "fields": {
      "expected_revision": "4",
      "actual_revision": "5"
    }
  }
}
```

`fields` is optional and contains strings only. Initial error mappings include:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, malformed ID, or structurally invalid request. |
| `401` | Authentication required once authentication exists. |
| `403` | Caller cannot access the ruleset. |
| `404` | Resource absent or intentionally hidden. |
| `409` | Duplicate key, revision conflict, or prohibited semantic mutation. |
| `422` | Well-formed resource violates domain validation. |
| `500` | Unexpected application or database failure. |

PostgreSQL constraint names are explicit. The error adapter may map known
constraint names to specific domain responses; it must not expose raw SQL,
database names, or internal stack traces.

## HTTP representation of ownership and typed data

Owner schemas and entities expose only configured capabilities and generic
identity metadata:

```ts
type OwnerSchema = {
  id: string;
  key: string;
  label: string;
  description?: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

type Entity = {
  id: string;
  key?: string;
  display_name: string;
  owner_schema_ids: string[];
  archived: boolean;
  state_revision: number;
  created_at: string;
  updated_at: string;
};
```

The API retains ergonomic nested tagged values even though storage is
relational:

```ts
type StateScalarValue =
  | { kind: "text"; value: string }
  | { kind: "choice"; value: string }
  | { kind: "measurement"; amount: number; unit: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | {
      kind: "reference";
      entity_id: string;
      fallback_name?: string;
    };

type StateValue = StateScalarValue | StateScalarValue[];
```

Choice option keys and measurement unit names are exposed in authored API
values, while store records use UUID foreign keys. Loaders resolve IDs to
current keys and unit names. Saves resolve requested keys and units back to
rows in the same variable and reject invalid selections. References use generic
entity IDs; there is no separate relationship scalar or referenced entity type.

State-variable DTOs use nested metadata for transport while mapping exactly to
the relational fields in `DATA.md`:

```ts
type ValueSchema =
  | { kind: "text" }
  | {
      kind: "choice";
      options: Array<{ id: string; key: string; label: string }>;
    }
  | {
      kind: "measurement";
      units: Array<{ id: string; unit: string }>;
      minimum?: number;
      maximum?: number;
      step?: number;
    }
  | {
      kind: "number";
      minimum?: number;
      maximum?: number;
      step?: number;
      unit?: string;
    }
  | { kind: "boolean" }
  | { kind: "reference"; target_owner_schema_ids: string[] };

type MissingValueSemantics =
  | { kind: "unknown" }
  | {
      kind: "default";
      value: StateValue;
      omit_when_stored: boolean;
    };

type StateVariableDefinition = {
  id: string;
  key: string;
  label: string;
  description?: string;
  owner_schema_ids: string[];
  cardinality: "one" | "many";
  value_schema: ValueSchema;
  missing_value: MissingValueSemantics;
  presentation?: {
    group?: string;
    control?: string;
    help_text?: string;
  };
  condition_addressable: boolean;
  allowed_effect_operations: EffectOperation[];
  display_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

A default for a many-valued variable may be an empty array. A reference schema
with an empty `target_owner_schema_ids` array accepts any entity in the same
ruleset. DTO nesting is never passed directly to a database encoder. Handlers
map DTOs to validated domain aggregates; stores map those aggregates to rows.

### Condition configuration DTOs

Condition sets declare parameters. Criteria address those parameters and
combine per-entity results with an explicit quantifier:

```ts
type ConditionParameter = {
  id: string;
  key: string;
  label: string;
  cardinality: "one" | "many";
  required_owner_schema_ids: string[];
};

type ConditionExpression =
  | {
      id: string;
      type: "all" | "any";
      children: ConditionExpression[];
    }
  | {
      id: string;
      type: "at-least";
      count: number;
      children: ConditionExpression[];
    }
  | {
      id: string;
      type: "criterion";
      parameter_id: string;
      quantifier: "single" | "any" | "all" | "at-least";
      count?: number;
      state_variable_id: string;
      predicate: Predicate;
    };

type Predicate =
  | {
      kind: "number";
      operator: "eq" | "gt" | "gte" | "lt" | "lte";
      value: number;
    }
  | {
      kind: "number-range";
      operator: "between";
      minimum: number;
      maximum: number;
    }
  | {
      kind: "boolean";
      operator: "is";
      value: boolean;
    }
  | {
      kind: "choice";
      operator: "is";
      value: string;
    }
  | {
      kind: "choice-set";
      operator: "one-of";
      values: string[];
    };

type ConditionSet = {
  id: string;
  key: string;
  name: string;
  description?: string;
  parameters: ConditionParameter[];
  root: ConditionExpression;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

The API arrays express authored order. Their members become rows and positions
in PostgreSQL. Stable parameter IDs allow problem invocations to keep mapping
the same semantic inputs when a parameter is renamed or reordered.

### Problem configuration DTOs

Problem definitions declare targets and own each use of a reusable condition
set:

```ts
type ProblemTargetDefinition = {
  id: string;
  key: string;
  label: string;
  description?: string;
  cardinality: "one" | "many";
  minimum_bindings: number;
  maximum_bindings?: number;
  binding_source: "supplied" | "problem-instance";
  required_owner_schema_ids: string[];
};

type ConditionInvocation = {
  id: string;
  condition_set_id: string;
  arguments: Array<{
    parameter_id: string;
    target_definition_id: string;
  }>;
};

type StateEffect =
  | {
      id: string;
      type: "set";
      target_definition_id: string;
      state_variable_id: string;
      value: StateValue;
    }
  | {
      id: string;
      type: "clear";
      target_definition_id: string;
      state_variable_id: string;
    }
  | {
      id: string;
      type: "adjust-number";
      target_definition_id: string;
      state_variable_id: string;
      amount: number;
    }
  | {
      id: string;
      type: "add-value" | "remove-value";
      target_definition_id: string;
      state_variable_id: string;
      value: StateScalarValue;
    };

type ConsequenceSet = {
  id: string;
  effects: StateEffect[];
};

type ChoiceOutcome = {
  id: string;
  label: string;
  consequences: ConsequenceSet;
};

type ChoiceResolution =
  | {
      type: "automatic";
      outcome: ChoiceOutcome;
    }
  | {
      type: "condition";
      invocation: ConditionInvocation;
      met: ChoiceOutcome;
      unmet: ChoiceOutcome;
    };

type ChoiceDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  available_when?: ConditionInvocation;
  resolution: ChoiceResolution;
};

type ProblemDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  instance_owner_schema_ids: string[];
  targets: ProblemTargetDefinition[];
  available_when?: ConditionInvocation;
  choices: ChoiceDefinition[];
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

The definition's instance owner schemas are a creation template. They do not
retroactively alter existing instance entities. Every invocation maps every
parameter exactly once to a compatible target in the same definition.

Problem instances expose current supplied bindings and the automatically
created instance binding:

```ts
type ProblemTargetBinding = {
  target_definition_id: string;
  entity_ids: string[];
};

type ProblemInstance = {
  id: string; // also the generic entity ID
  problem_definition_id: string;
  display_name: string;
  binding_revision: number;
  bindings: ProblemTargetBinding[];
  state_revision: number;
  created_at: string;
  updated_at: string;
};
```

Create requests omit server-managed timestamps and may omit IDs for newly added
aggregate children. The server generates missing UUIDs and returns them. Update
requests preserve existing child IDs. Removing or structurally changing a
referenced parameter or target is rejected when it would invalidate an
invocation, state value, or existing problem instance.

## REST resources

Ruleset-scoped routes make ownership explicit:

```text
GET    /api/rule-sets
POST   /api/rule-sets
GET    /api/rule-sets/{rule_set_id}
PATCH  /api/rule-sets/{rule_set_id}

GET    /api/rule-sets/{rule_set_id}/owner-schemas
POST   /api/rule-sets/{rule_set_id}/owner-schemas
GET    /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}
PUT    /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}
POST   /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}/archive

GET    /api/rule-sets/{rule_set_id}/entities
POST   /api/rule-sets/{rule_set_id}/entities
GET    /api/rule-sets/{rule_set_id}/entities/{entity_id}
PUT    /api/rule-sets/{rule_set_id}/entities/{entity_id}
POST   /api/rule-sets/{rule_set_id}/entities/{entity_id}/archive

GET    /api/rule-sets/{rule_set_id}/state-variable-definitions
POST   /api/rule-sets/{rule_set_id}/state-variable-definitions
GET    /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}
PUT    /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}
POST   /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}/archive

GET    /api/rule-sets/{rule_set_id}/entities/{entity_id}/state
PUT    /api/rule-sets/{rule_set_id}/entities/{entity_id}/state

GET    /api/rule-sets/{rule_set_id}/condition-sets
POST   /api/rule-sets/{rule_set_id}/condition-sets
GET    /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}
PUT    /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}
POST   /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/duplicate
POST   /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/archive
POST   /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/evaluate

GET    /api/rule-sets/{rule_set_id}/problem-definitions
POST   /api/rule-sets/{rule_set_id}/problem-definitions
GET    /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}
PUT    /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}
POST   /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/duplicate
POST   /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/archive

GET    /api/rule-sets/{rule_set_id}/problem-instances
POST   /api/rule-sets/{rule_set_id}/problem-instances
GET    /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}
PUT    /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/bindings

POST   /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/preview
POST   /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/resolve
```

Entity list filters may include owner-schema ID, archive state, and a bounded
display-name search. These filters are picker aids, not built-in entity types or
automatic target selectors. Problem target bindings remain explicit request
rows.

List endpoints should accept bounded `limit` and opaque `cursor` parameters
once data volume justifies pagination. Initial configuration lists may return
complete ruleset-scoped collections with a hard server limit.

## Whole-resource editing

Condition sets and problem definitions are loaded and saved as complete nested
resources. The client does not patch individual parameters, expression nodes,
targets, invocations, choices, outcomes, or effects.

For a condition-set `PUT`, the handler:

1. Strictly decodes the complete condition set.
2. Confirms path and body IDs agree.
3. Loads referenced schemas, variables, and option metadata.
4. Converts the DTO to a domain aggregate and validates its parameterized tree.
5. Starts a database transaction and locks the condition-set root `FOR UPDATE`.
6. Loads current problem invocations that reference the set and locks their
   problem-definition roots in deterministic UUID order.
7. Revalidates every invocation against the proposed parameters.
8. Updates root metadata and merges parameters by stable ID, refusing to remove
   a parameter that remains referenced.
9. Replaces expression, criterion, and operand rows while preserving supplied
   stable IDs and positions.
10. Commits and returns the freshly loaded aggregate.

For a problem-definition `PUT`, the handler also loads existing instances and
bindings. It locks referenced condition-set roots in UUID order before the
problem root so every configuration transaction follows the same lock order.
Target rows are merged by stable ID because instance bindings refer to them.
The save is rejected if target removal, cardinality changes, binding source
changes, required-schema changes, or instance-schema changes would make an
existing instance invalid. Choices, outcomes, consequence sets, effects, and
invocation rows may be replaced as owned children when no external foreign key
requires an incremental merge.

Delete-and-reinsert is acceptable only for children with no external
references, such as expression nodes and effects. Stable IDs are reused inside
the transaction. Parameters and target definitions require reference-aware
updates. Aggregate root IDs and all external foreign keys remain untouched.

If concurrent configuration editing is later supported, add an aggregate
revision token and conditional root update. This is lost-update protection, not
configuration history.

## Aggregate loading

Avoid one enormous query with a Cartesian product of every child collection.
Each store loader uses one transaction or consistent connection and a small,
predictable set of ordered queries:

```text
LoadConditionSet
  1. root metadata
  2. parameters ordered by position
  3. parameter required-owner-schema rows
  4. expression nodes ordered by parent and position
  5. criteria
  6. number and Boolean predicate rows
  7. choice operands ordered by position
  8. referenced variable and option display metadata
  9. assemble and validate the aggregate in memory

LoadProblemDefinition
  1. root metadata and instance-owner-schema rows
  2. targets ordered by position and their required schemas
  3. choices ordered by position
  4. condition invocations and arguments
  5. resolutions and outcomes
  6. consequence sets
  7. effects ordered by consequence and position
  8. effect operands ordered by effect and position
  9. referenced condition, variable, and schema summaries
 10. assemble and validate the aggregate in memory

LoadProblemInstance
  1. instance and generic entity metadata
  2. entity owner-schema memberships
  3. target bindings ordered by target and position
  4. target metadata and required schemas
  5. validate the current binding aggregate
```

Rows missing a required typed child row or carrying an impossible tagged union
shape indicate corrupt stored data and produce an internal validation error.
Loaders do not silently drop malformed rows or invalid memberships.

## Entity and state endpoints

Creating an entity creates its empty `state_records` row in the same
transaction with revision zero. Updating owner-schema memberships locks the
entity and state record, validates that removals do not invalidate state or
active bindings, replaces membership rows, and increments the state revision
when membership changes.

`GET .../entities/{id}/state` returns stored and logical information for every
active or already-stored definition the entity is eligible to own:

```ts
type StateRecordResponse = {
  owner_entity_id: string;
  revision: number;
  values: Record<string, StateValue>;
  defaulted_definition_ids: string[];
  unknown_definition_ids: string[];
  updated_at: string;
};
```

`values` contains the complete logical view for known values. The two ID lists
identify values materialized from defaults and eligible variables whose
missing state remains unknown. A diagnostic/editor view may additionally
expose raw stored values, but clients must not infer missing semantics
themselves.

`PUT .../state` supplies a complete logical value map and
`expected_revision`. It is intended for explicit state maintenance. The server:

1. Loads the entity, memberships, and all relevant variable definitions.
2. Validates owner eligibility and normalizes the complete value map.
3. Removes values equal to omitted defaults.
4. Begins a transaction and locks the state record.
5. Compares its revision to `expected_revision` and rechecks membership.
6. Replaces the entity's `state_values` rows.
7. Increments the state-record revision only when persisted state changes.
8. Commits and returns the authoritative logical state.

This endpoint is never used to commit a client-calculated choice result.

## Condition evaluation API

Standalone condition evaluation binds every parameter directly to concrete
entities:

```ts
type EvaluateConditionRequest = {
  arguments: Array<{
    parameter_id: string;
    entity_ids: string[];
  }>;
};
```

The server requires each parameter exactly once, preserves entity order,
rejects duplicate entities, validates cardinality and required schemas, and
loads one bounded state snapshot. Evaluation returns:

```ts
type ConditionStatus = "met" | "unmet" | "unknown";

type StateAddress = {
  entity_id: string;
  state_variable_id: string;
};

type ConditionEvaluationNode = {
  expression_id: string;
  status: ConditionStatus;
  message: string;
  parameter_id?: string;
  entity_results?: Array<{
    entity_id: string;
    status: ConditionStatus;
    address: StateAddress;
    actual?: StateValue;
  }>;
  children?: ConditionEvaluationNode[];
};

type ConditionEvaluation = {
  condition_set_id: string;
  status: ConditionStatus;
  root: ConditionEvaluationNode;
  missing_values: StateAddress[];
};
```

Evaluation is read-only. The explanation tree follows authored child order;
per-entity results follow binding order. `missing_values` is deduplicated by
entity and variable ID and sorted deterministically. When evaluation occurs
through a problem invocation, the server first maps invocation parameters to
the instance's target bindings and returns the same concrete explanation shape.

## Problem-instance binding API

Creating a problem instance accepts a definition ID, entity display metadata,
and bindings for every `supplied` target:

```ts
type CreateProblemInstanceRequest = {
  problem_definition_id: string;
  key?: string;
  display_name: string;
  bindings: ProblemTargetBinding[];
};

type ReplaceProblemBindingsRequest = {
  expected_binding_revision: number;
  bindings: ProblemTargetBinding[];
};
```

Creation runs in one transaction. It creates the generic entity and empty state
record, attaches the definition's current instance-owner-schema memberships,
creates the `problem_instances` row, adds the automatic `problem-instance`
binding when configured, validates every supplied binding, and inserts binding
rows. The instance entity ID is the problem-instance ID.

Binding replacement accepts only supplied targets. The server recreates the
automatic instance binding, checks the expected revision, validates all target
bounds and entity eligibility, and increments `binding_revision` only when the
persisted binding set changes. A binding update that would invalidate an active
operation conflicts through row locking; it never partially rewrites targets.

## Preview and resolution API

The problem-instance route identifies the complete binding context. A preview
or resolution request never supplies an actor, target entity, selected outcome,
or calculated effect:

```ts
type ResolveChoiceRequest = {
  expected_binding_revision?: number;
  expected_state_revisions?: Record<string, number>;
};
```

Expected revisions are optional guards for a UI that is resolving a previously
displayed view. Whether supplied or not, the server loads and locks current
bindings and state and performs authoritative evaluation.

An applied effect reports its concrete entity address. One authored effect can
produce zero, one, or many entries:

```ts
type AppliedEffect = {
  effect_id: string;
  target_definition_id: string;
  entity_id: string;
  state_variable_id: string;
  before?: StateValue;
  after?: StateValue;
  changed: boolean;
};
```

The result union is:

```ts
type ChoiceResolutionResult =
  | {
      status: "applied";
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      outcome_id: string;
      binding_revision: number;
      availability_evaluations: ConditionEvaluation[];
      resolution_evaluation?: ConditionEvaluation;
      applied_effects: AppliedEffect[];
      state: { records: Record<string, StateRecordResponse> };
    }
  | {
      status: "unavailable";
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      availability_evaluations: ConditionEvaluation[];
    }
  | {
      status: "incomplete";
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      evaluations: ConditionEvaluation[];
    };
```

Preview returns the same shape, including simulated applied effects and updated
logical records, but performs no writes and includes `preview: true`. A later
resolution can differ because current configuration, bindings, or state may
have changed.

## Resolution transaction

Choice resolution is the most important transaction boundary:

1. Begin a transaction.
2. Read the instance's definition and referenced condition-set IDs, without yet
   using their contents to make a domain decision.
3. Lock referenced condition-set roots in sorted UUID order and then the
   problem-definition root for shared use. Configuration writers use the same
   lock-class order and take exclusive locks on roots they mutate.
4. Lock the problem instance, its binding revision, and binding rows, then
   reload the identifiers and fail on any inconsistency.
5. Confirm the requested choice belongs to the instance's current definition.
6. Load and validate the complete problem, condition invocations, condition
   sets, variables, owner schemas, entities, and current target bindings.
7. Derive the bounded set of entity state records reachable through every
   availability, resolution, or effect target that may be needed.
8. Lock those state records `FOR UPDATE` in sorted entity-ID order, then load
   their values through the same transaction.
9. Check any request-supplied binding and state revisions.
10. Validate persisted state and materialize defaults into an immutable
   in-memory snapshot.
11. Evaluate problem and choice availability through their invocation maps.
12. Return unavailable or incomplete without writes if required.
13. Select the automatic outcome or evaluate the resolution invocation.
14. Return incomplete without writes if that invocation is unknown.
15. Apply the selected outcome's effects in consequence order to working
    record copies. For one effect, traverse bound entities in binding order.
16. Abort if any effect is invalid against the state reached at that point.
17. Normalize values equal to omitted defaults out of persistence.
18. Replace only affected variables' `state_values` rows.
19. Increment each changed record's revision; idempotently unchanged records
    keep their revision.
20. Recheck locked configuration, binding, and state assumptions, commit, and
    return explanations, applied effects, and the affected logical records.

Any SQL error, validation error, revision conflict, or effect failure rolls
back the complete transition across every entity. An effect over an empty valid
many-target binding is a no-op. No entity can retain only part of an outcome.

The shared configuration locks ensure a resolution observes one coherent
definition relative to a whole-resource save. Binding and state locks ensure
that the snapshot used to select and apply an outcome remains current through
commit. Locks are always acquired in documented UUID order to avoid deadlocks.

## Pure resolver flow

The transaction supplies fully hydrated values to `rules.ResolveChoice`:

```go
type ResolutionInput struct {
    Problem        ProblemDefinition
    Instance       ProblemInstance
    ChoiceID       uuid.UUID
    OwnerSchemas   map[uuid.UUID]OwnerSchema
    Entities       map[uuid.UUID]Entity
    Definitions    map[uuid.UUID]StateVariableDefinition
    Conditions     map[uuid.UUID]ConditionSet
    Bindings       TargetBindings
    Snapshot       StateSnapshot
}
```

The pure resolver:

1. Verifies all cross-references, invocation mappings, bindings, and state.
2. Evaluates availability using mapped parameter bindings.
3. Selects an outcome.
4. Copies the bounded map of state records.
5. Applies effects sequentially to every entity selected by each target.
6. Records before/after values and whether each concrete application changed
   state.
7. Returns a resolution result plus the changed working records.

It does not increment revisions or decide SQL mutations. The application layer
does so only after successful domain resolution.

## Validation layers

Validation occurs in four layers:

1. Request validation checks JSON shape, required fields, IDs, and basic string
   limits.
2. Domain validation checks every applicable invariant enumerated in
   `DATA.md`, including cross-row owner eligibility and binding compatibility.
3. PostgreSQL constraints protect ruleset ownership, row shape, uniqueness,
   and foreign keys against programming mistakes or concurrent changes.
4. Runtime resolution validation checks current definitions, bindings, state,
   invocation reachability, and effect application inside the transaction.

The frontend may prevent obvious invalid edits but never replaces server
validation.

Use typed errors rather than matching message text:

```go
type ValidationError struct {
    Code    string
    Path    string
    Message string
}

type ValidationErrors []ValidationError
```

Paths use stable resource IDs where possible, for example:

```text
parameters[param-uuid].required_owner_schema_ids
root.children[expr-uuid].predicate.value
targets[target-uuid].minimum_bindings
choices[choice-uuid].outcomes.met.effects[effect-uuid].amount
bindings[target-uuid].entities[entity-uuid]
```

This lets React editors attach server errors to the correct stable node after
local reordering.

## Configuration interface

### Owner schemas and entities

The owner-schema library lets authors create, describe, archive, and inspect
schema usage. The entity browser creates generic entities, assigns compatible
active schemas, and shows state and binding usage. Labels may explain an
author's vocabulary, but the UI does not render fixed participant, item,
location, or problem-instance entity classes.

Membership removal previews the state values and active bindings it would
invalidate. A rejected mutation keeps the editor draft intact.

### State-variable catalog

The catalog groups definitions by authored presentation group and display
order. An author can:

- add a definition;
- select one or more eligible owner schemas;
- configure kind, cardinality, missing semantics, choices, units, bounds, and
  reference target restrictions before first use;
- edit label, description, presentation hints, and display order;
- enable supported condition and effect operations;
- archive an unused or superseded variable; and
- inspect state, condition, and effect usages.

The UI explains why a used semantic schema cannot change or be deleted. It does
not assume an initial catalog or group definitions by a built-in owner type.

### Condition-set library and composer

The library shows name, description, archive state, declared parameters, and
every problem invocation. Authors can create, duplicate, edit, and archive
sets. Before a shared set is edited, the UI shows affected problem definitions.

The composer is a stable-ID parameter and tree editor:

1. Declare and order singular or plural parameters with required schemas.
2. Add an `all`, `any`, or `at-least` expression group.
3. Add a criterion under a group.
4. Select a declared parameter.
5. Select a variable compatible with that parameter's required schemas.
6. For plural parameters, select `any`, `all`, or `at-least` quantification.
7. Derive the operator menu and operand control from the variable schema.
8. Move and reorder parameters and nodes without changing their IDs.
9. Continuously render a readable summary and save the complete set.

Boolean variables use their authored labels while the canonical predicate
remains `is true` or `is false`.

### Problem and choice composer

The editor supports:

- problem metadata and instance owner-schema templates;
- ordered singular and plural target definitions with binding bounds, source,
  and required schemas;
- problem- and choice-level availability invocations;
- explicit mapping from every selected condition parameter to a compatible
  problem target;
- ordered choice creation, duplication, movement, and removal;
- automatic or conditional resolution;
- explicit automatic, met, and unmet outcome labels;
- ordered effects on every outcome, each addressing a target definition;
- only variables and operations compatible with the selected target; and
- readable transition previews and reference-usage inspection.

The interface visually separates **Available when** from **When chosen, test**
so a fallible attempt is not accidentally modeled as unavailable.

### Problem-instance binding editor

The instance editor creates a named generic instance entity and binds each
supplied target through owner-schema-filtered entity pickers. It shows minimum,
maximum, singular, and plural constraints; preserves binding order; displays
the current binding revision; and identifies the automatic instance target.

Picker filtering assists explicit selection. It never discovers or
continuously recomputes bindings from location, ownership, or other world
queries.

### State inspector and runtime resolution

The state inspector is a testing and operational-correction tool, not a
complete world builder. It can:

- select any entity and show its owner schemas;
- distinguish stored, defaulted, and unknown values;
- validate and edit state through definition-driven controls;
- display the current state revision; and
- evaluate a condition with explicit parameter bindings.

The runtime surface opens one problem instance, displays its current target
bindings, and shows available, unavailable, and incomplete choices with derived
explanations. Selecting a choice sends only its stable ID plus optional revision
guards. The server reevaluates and returns the authoritative multi-record
result.

## Frontend implementation

Feature code is organized around API resources rather than database tables. The
browser never needs to know that conditions, typed values, invocations, and
bindings are stored across several relations.

Recommended modules:

```text
src/api/client.ts
src/api/types.ts
src/api/errors.ts

src/features/owner-schemas/
  OwnerSchemaList.tsx
  OwnerSchemaEditor.tsx

src/features/entities/
  EntityList.tsx
  EntityEditor.tsx
  OwnerSchemaPicker.tsx

src/features/state-variables/
  StateVariableList.tsx
  StateVariableEditor.tsx
  schemaControls.tsx

src/features/condition-sets/
  ConditionSetList.tsx
  ConditionComposer.tsx
  ConditionParameterEditor.tsx
  ConditionNodeEditor.tsx
  conditionTree.ts

src/features/problems/
  ProblemList.tsx
  ProblemEditor.tsx
  TargetEditor.tsx
  ConditionInvocationEditor.tsx
  ChoiceEditor.tsx
  OutcomeEditor.tsx
  EffectEditor.tsx

src/features/problem-instances/
  ProblemInstanceList.tsx
  ProblemInstanceEditor.tsx
  TargetBindingEditor.tsx

src/features/state-inspector/
  StateInspector.tsx
  StateValueEditor.tsx

src/features/resolution/
  ProblemRuntime.tsx
  EvaluationExplanation.tsx
  ResolutionResult.tsx
```

Editor drafts are mutable client-side trees keyed by server-issued or
client-generated UUIDs. Reordering changes `position` during request
serialization, not node identity.

Keep server data and unsaved drafts separate. A failed save must not overwrite
the draft with stale cached data. After a successful save, replace the local
resource with the authoritative response and invalidate relevant lists, picker
metadata, and usage summaries.

Accessibility requirements include keyboard-operable tree and binding
movement, explicit labels for condition/effect controls, focus placement on
validation errors, and textual status that does not rely on color alone.

## Database migrations

Migrations are plain SQL embedded from `internal/migrations` and applied in
lexicographic filename order. The runner creates:

```sql
create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);
```

Each unapplied file executes in its own transaction. Its filename is inserted
only after the migration succeeds. Startup stops on migration failure.

Migration conventions:

- use zero-padded names such as `001_foundations.sql`;
- never edit a migration that may have reached a persistent database;
- make forward-only corrective migrations;
- name constraints explicitly;
- add `updated_at` triggers to mutable aggregate roots;
- use composite foreign keys wherever two ruleset-scoped aggregates interact;
- include value kind and cardinality in typed-value foreign keys as specified
  in `DATA.md`;
- use `ON DELETE CASCADE` only for owned aggregate children;
- use `ON DELETE RESTRICT` for referenced schemas, definitions, targets,
  entities, and parameters; and
- test both empty-database creation and upgrade from the previous migration.

Suggested initial split:

```text
001_foundations.sql
  pgcrypto, migration helper, timestamp trigger, rule_sets,
  state_owner_schemas, entities, entity_owner_schemas, empty state_records

002_state_variables.sql
  definitions, owner applicability, options, units, reference restrictions,
  allowed operations, and defaults

003_state_values.sql
  relational current typed values and kind-specific uniqueness constraints

004_conditions.sql
  condition sets, parameters, required schemas, nodes, criteria, and operands

005_problem_definitions.sql
  definitions, instance schema templates, targets, invocations, choices,
  outcomes, consequence sets, effects, and operands

006_problem_instances.sql
  instance entity links, binding revisions, and target binding rows
```

There is no required seed migration for owner schemas, variables, entities, or
problem vocabulary. Optional examples and starter rulesets belong in separate
development fixtures or explicitly selected deployment migrations. They use
the same validation and creation semantics as authored configuration, and
tests must not make their keys engine behavior.

Only one process should apply new migrations at deployment time unless the
runner takes a PostgreSQL advisory lock. Adding an advisory lock is preferable
before horizontal deployment.

## Query and transaction practices

- Every query is ruleset-scoped, including lookups by globally unique UUID.
- Request contexts flow into every `pgx` call.
- Long-running requests receive explicit timeouts.
- Transactions use `defer tx.Rollback(ctx)` followed by an explicit commit.
- Locks are acquired in deterministic UUID order.
- Runtime state loaders fetch only the bounded records reachable through the
  current operation's parameter or target bindings.
- List queries order by stable explicit columns and IDs as tie breakers.
- Stores return domain-level not-found and conflict errors rather than leaking
  `pgx.ErrNoRows` to handlers.
- Writes reload their aggregate before returning unless the writer can prove
  its in-memory representation exactly matches database defaults and triggers.

No transition event is written during resolution. Logs may record ruleset,
problem, instance, choice, outcome, affected entity IDs, duration, and failure
category, but must not be treated as durable history.

## Testing strategy

### Pure domain tests

These are the largest and fastest test group:

- validation of every value kind and cardinality;
- default and unknown materialization;
- normalized equality and duplicate detection for many-valued sets;
- numeric and measurement bounds and steps;
- entity owner eligibility and reference target-schema restrictions;
- condition parameter, criterion, and tree validation;
- full three-valued truth tables for expression groups and plural `any`, `all`,
  and `at-least` quantifiers, including empty bindings;
- all supported number, Boolean, and choice predicates;
- explanation-node IDs, per-entity results, and missing-address deduplication;
- invocation mapping and parameter/target compatibility;
- target cardinality, binding bounds, and required-schema validation;
- each effect operation over singular, plural, and empty valid targets;
- ordered effects observing earlier changes across several entity records;
- idempotent add/remove behavior;
- atomic failure when a later effect or later target entity is invalid;
- availability versus resolution behavior; and
- automatic, met, unmet, unknown, and unavailable outcomes.

### Store and migration tests

Run against a disposable PostgreSQL database:

- apply the complete migration chain to an empty database;
- upgrade a database at the preceding migration;
- verify every important foreign key, partial index, and check constraint;
- round-trip owner schemas, entities, memberships, and every typed value kind;
- create an empty state record atomically with every entity;
- round-trip condition parameters and trees with stable ordering and IDs;
- round-trip problem targets, invocations, and empty/non-empty consequences;
- replace whole aggregates without orphaning externally referenced parameters
  or target definitions;
- verify archive, semantic mutation, and deletion restrictions;
- verify owner-schema membership and state revision conflicts;
- verify target binding revision conflicts and automatic instance bindings; and
- verify multi-entity consequence writes commit or roll back together.

### Handler tests

- unknown JSON fields and trailing input are rejected;
- route/body ID mismatches are rejected;
- errors use the stable envelope and status mapping;
- ruleset boundaries cannot be crossed through schemas, entities, values,
  invocations, targets, references, or bindings;
- save responses return authoritative aggregates;
- standalone evaluation requires complete, compatible parameter bindings;
- preview never writes;
- resolution never accepts client-selected outcomes, effects, or state;
- no configured key receives privileged behavior; and
- concurrent resolution, binding edits, membership edits, and direct state
  edits produce one valid serial order.

### Frontend tests

- schema metadata selects the right controls and operators;
- owner-schema filters never replace server eligibility validation;
- stable parameter, target, and node IDs survive movement and reordering;
- parameter and target cardinalities constrain invocation mapping;
- `at-least` validation tracks child or binding counts as appropriate;
- availability and resolution conditions remain visually distinct;
- server validation paths focus the correct editor node;
- defaults and unknown values are visibly different;
- singular, plural, and automatic bindings render distinctly;
- incomplete resolution never appears as a failed outcome; and
- preview is clearly advisory.

End-to-end tests should create all schemas, variables, entities, conditions,
targets, invocations, instances, and bindings through ordinary configuration
paths, then exercise met, unmet, unknown, multi-entity, and rollback cases. A
fixture may use the non-normative example from `DATA.md`, but assertions should
depend on stored IDs and declared semantics rather than its keys.

## Local development and CI

`run.sh` should provide a small process controller:

```text
./run.sh
./run.sh status
./run.sh restart backend|frontend|all
./run.sh stop backend|frontend|all
./run.sh logs
./run.sh tail
```

The backend development process runs the Go server against local PostgreSQL.
The frontend process runs Vite with `/api` proxied to Go. Production builds run
the frontend first and embed the generated `web/static` directory.

`ci.sh` should run, in order:

1. Go formatting checks.
2. `go vet ./...`.
3. `go test ./...`.
4. Frontend dependency lock verification.
5. TypeScript type checking.
6. ESLint and formatting checks.
7. Frontend unit tests.
8. Production frontend build.
9. Migration and integration tests when a test PostgreSQL URL is available.

Generated production assets should either be built in CI/deployment or checked
in according to the eventual deployment environment; choose one policy and
enforce it consistently.

## Implementation sequence

### Phase 1: application skeleton

- Initialize the Go module and Bun/Vite/React frontend.
- Add configuration, logging, health route, graceful shutdown, static serving,
  migration runner, `run.sh`, and `ci.sh`.
- Create a local PostgreSQL database and verify empty startup.

### Phase 2: ownership and variable definitions

- Add rulesets, owner schemas, generic entities, memberships, and empty state
  records.
- Add state-variable definitions and every relational metadata child table.
- Implement owner eligibility, definition validation, and aggregate CRUD.
- Build owner-schema, entity, and state-variable configuration interfaces.

### Phase 3: current state

- Add relational typed current values.
- Implement normalization, defaults, unknowns, reference restrictions, state
  revision checks, and state APIs.
- Build the generic entity state inspector.

### Phase 4: parameterized conditions

- Add condition parameters, required schemas, normalized expression nodes, and
  predicate tables.
- Implement pure validation, plural quantification, evaluation, and
  explanations.
- Add condition-set CRUD, duplication, usage reads, and explicit-argument
  evaluation.
- Build the parameter editor, condition library, and composer.

### Phase 5: problem definitions and effects

- Add instance schema templates, target definitions, condition invocations,
  choices, outcomes, consequence sets, effects, and operands.
- Implement mapping, target, problem, and effect validation.
- Implement reference-aware aggregate persistence and pure effect application.
- Build the target, invocation, problem, choice, and effect composers.

### Phase 6: instances, bindings, and transactional resolution

- Implement problem-instance entity creation and automatic/supplied bindings.
- Add binding replacement with optimistic revision checks.
- Implement preview over a bounded multi-record snapshot.
- Implement locked atomic resolution and changed-record revision updates.
- Build the binding editor, runtime choice surface, and explanations.

### Phase 7: hardening

- Add comprehensive PostgreSQL integration, mutation, and concurrency tests.
- Add request limits, timeouts, pagination where needed, and performance
  indexes.
- Complete accessibility and end-to-end coverage.
- Define authentication, ruleset membership, and deployment policy before the
  application is exposed beyond a trusted local environment.

## Explicitly deferred implementation

Do not add generic infrastructure for the deferred features listed in
`DATA.md`. In particular, do not introduce:

- built-in entity subclasses or privileged owner-schema keys;
- a required state-variable or world-entity seed catalog;
- automatic target discovery or arbitrary world-query expressions;
- a generic executable expression language;
- JSON patches or JSON documents for canonical configuration;
- event sourcing, retained snapshots, or transition history;
- background job systems, plugin execution, or generic webhooks;
- configuration revision history or publishing workflows;
- owner-schema membership effects;
- entity-creation effects; or
- reusable consequence abstractions before demonstrated reuse and explicit
  parameter semantics exist.

The first implementation remains a comprehensible relational state-transition
system whose behavior is visible in Go types, SQL relations, and tests.

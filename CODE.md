# Stateful Rule Composer Implementation Design

## Purpose

This document specifies how to implement the domain and relational model in
`DATA.md`. It covers the Go backend, PostgreSQL access, REST API, React
frontend, transaction boundaries, validation flow, migrations, tests, and
implementation sequence.

The system is one deployable Go/PostgreSQL web application. The browser uses
Bun, TypeScript, and React. The Go binary serves both `/api/*` JSON endpoints
and the compiled frontend.

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
- No `json`, `jsonb`, or PostgreSQL array columns store domain data.
- Nested JSON exists only in HTTP DTOs and in-memory Go structures.
- Aggregate loaders hydrate normalized rows into domain structs.
- Aggregate writers validate and replace owned rows transactionally.

## Repository layout

```text
cmd/dnd/
  main.go                    process startup and graceful shutdown

internal/app/
  config.go                  environment configuration
  server.go                  route registration and middleware
  json.go                    strict JSON helpers and errors
  handlers_rule_sets.go
  handlers_state_variables.go
  handlers_state.go
  handlers_condition_sets.go
  handlers_problems.go
  handlers_resolution.go
  api_types.go               request and response DTOs

internal/rules/
  types.go                   storage-neutral domain types
  values.go                  normalization and typed-value comparison
  definitions.go             definition validation
  state.go                   logical defaults and state validation
  conditions.go              tree validation and evaluation
  effects.go                 effect validation and application
  problems.go                problem aggregate validation
  resolution.go              pure transition orchestration
  explanations.go            derived human-readable messages

internal/store/
  store.go                   Store and transaction interfaces
  entities.go
  state_variables.go
  state.go
  condition_sets.go
  problems.go
  resolution.go              locking and state persistence helpers

internal/migrations/
  migrations.go              embedded migration runner
  001_init.sql
  002_seed_state_catalog.sql
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
      features/state-variables/
      features/condition-sets/
      features/problems/
      features/state-inspector/
      features/resolution/
      App.tsx
      main.tsx

ci.sh
run.sh
```

HTTP handlers should coordinate requests, authorization, domain validation,
and stores. They should not implement condition or effect semantics. Store code
should not decide domain validity beyond surfacing constraint violations.

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
handler must nevertheless operate through a ruleset-scoped authorization
function so authentication can be added without rewriting queries. Until a
policy is selected, a local build may expose the seeded default ruleset.

## Domain package design

`internal/rules` is a pure package: it accepts structs and returns values or
typed errors. It does not know about HTTP, SQL, `pgx`, or React.

Important domain types include:

```go
type OwnerType string
type StateTarget string
type ValueKind string
type Cardinality string
type ConditionStatus string
type EffectOperation string

const (
    ConditionMet     ConditionStatus = "met"
    ConditionUnmet   ConditionStatus = "unmet"
    ConditionUnknown ConditionStatus = "unknown"
)
```

Do not model typed values as `map[string]any`. Use a tagged Go union with
private or carefully validated construction. One acceptable shape is:

```go
type ScalarValue struct {
    Kind               ValueKind
    Text               *string
    Number             *decimalValue
    Boolean            *bool
    ChoiceOptionID     *uuid.UUID
    MeasurementAmount  *decimalValue
    MeasurementUnitID  *uuid.UUID
    ReferencedEntityID *uuid.UUID
    ReferencedType     *string
    Relationship       *string
    FallbackName       *string
}

type StateValue struct {
    Cardinality Cardinality
    Values      []ScalarValue
}
```

Constructors and validation guarantee the union shape. `decimalValue` may
initially be a small wrapper around a canonical decimal string or a selected
decimal package. Converting database `numeric` through `float64` should be
avoided if exact step alignment matters.

Domain APIs operate on stable UUIDs. Human-readable keys are lookup and editing
identities, never foreign keys inside rules.

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
  definitions.

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

PostgreSQL constraint names should be explicit. The error adapter may map known
constraint names to specific domain responses; it must not expose raw SQL,
database names, or internal stack traces.

## HTTP representation of typed data

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
    }
  | {
      kind: "relationship";
      entity_id: string;
      relationship?: string;
      fallback_name?: string;
    };

type StateValue = StateScalarValue | StateScalarValue[];
```

Choice option keys and measurement unit names are exposed in the authored API,
while store records use their UUID foreign keys. The aggregate loader resolves
IDs to current keys and labels. Saves resolve requested keys back to rows in the
same ruleset and reject unknown or archived options.

State-variable definition DTOs expose the storage-neutral schema described in
`DATA.md`:

```ts
type StateVariableDefinition = {
  id: string;
  key: string;
  label: string;
  description?: string;
  owner_type: "participant" | "problem-instance";
  category: string;
  section: string;
  cardinality: "one" | "many";
  value_schema: ValueSchema;
  missing_value: MissingValueSemantics;
  presentation?: StateVariablePresentation;
  condition_addressable: boolean;
  allowed_effect_operations: EffectOperation[];
  display_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

DTO nesting must never be passed directly to a database encoder. Handlers map
DTOs to validated domain aggregates; stores map those aggregates to rows.

### Condition configuration DTOs

Condition sets retain the recursive authoring shape at the API boundary:

```ts
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
      target: "participant" | "problem";
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
  root: ConditionExpression;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

The API arrays express authored order. Their members become rows and positions
in PostgreSQL.

### Problem configuration DTOs

```ts
type StateEffect =
  | {
      id: string;
      type: "set";
      target: "participant" | "problem";
      state_variable_id: string;
      value: StateValue;
    }
  | {
      id: string;
      type: "clear";
      target: "participant" | "problem";
      state_variable_id: string;
    }
  | {
      id: string;
      type: "adjust-number";
      target: "participant" | "problem";
      state_variable_id: string;
      amount: number;
    }
  | {
      id: string;
      type: "add-value" | "remove-value";
      target: "participant" | "problem";
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
      condition_set_id: string;
      met: ChoiceOutcome;
      unmet: ChoiceOutcome;
    };

type ChoiceDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  available_when_condition_set_id?: string;
  resolution: ChoiceResolution;
};

type ProblemDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  available_when_condition_set_id?: string;
  choices: ChoiceDefinition[];
  archived: boolean;
  created_at: string;
  updated_at: string;
};

type ProblemInstance = {
  id: string;
  problem_definition_id: string;
  created_at: string;
  updated_at: string;
};
```

Create requests omit server-managed timestamps and may omit IDs for newly added
aggregate children. The server generates missing UUIDs and returns them. Update
requests preserve the IDs of existing children; a missing former child means it
was intentionally removed.

## REST resources

Ruleset-scoped routes make ownership explicit:

```text
GET    /api/rule-sets
POST   /api/rule-sets
GET    /api/rule-sets/{rule_set_id}
PATCH  /api/rule-sets/{rule_set_id}

GET    /api/rule-sets/{rule_set_id}/participants
POST   /api/rule-sets/{rule_set_id}/participants
GET    /api/rule-sets/{rule_set_id}/participants/{participant_id}
PATCH  /api/rule-sets/{rule_set_id}/participants/{participant_id}

GET    /api/rule-sets/{rule_set_id}/items
POST   /api/rule-sets/{rule_set_id}/items
GET    /api/rule-sets/{rule_set_id}/items/{item_id}
PATCH  /api/rule-sets/{rule_set_id}/items/{item_id}

GET    /api/rule-sets/{rule_set_id}/organizations
POST   /api/rule-sets/{rule_set_id}/organizations
GET    /api/rule-sets/{rule_set_id}/organizations/{organization_id}
PATCH  /api/rule-sets/{rule_set_id}/organizations/{organization_id}

GET    /api/rule-sets/{rule_set_id}/named-entities
POST   /api/rule-sets/{rule_set_id}/named-entities
GET    /api/rule-sets/{rule_set_id}/named-entities/{entity_id}
PATCH  /api/rule-sets/{rule_set_id}/named-entities/{entity_id}

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

POST   /api/rule-sets/{rule_set_id}/problem-instances
GET    /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}

POST   /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/preview
POST   /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/resolve
```

These entity routes provide the minimum records required by references and the
state inspector. They are not a complete character or item management product.

List endpoints should accept bounded `limit` and opaque `cursor` parameters
once data volume justifies pagination. Initial configuration lists may return
complete ruleset-scoped collections with a hard server limit.

## Whole-resource editing

Conditions and problems are loaded and saved as complete nested resources. The
client does not patch individual nodes, choices, outcomes, or effects.

For a condition-set `PUT`, the handler:

1. Strictly decodes the complete condition set.
2. Confirms path and body IDs agree.
3. Loads referenced variable and option metadata.
4. Converts the DTO to a domain tree.
5. Runs complete domain validation.
6. Starts a database transaction.
7. Locks the `condition_sets` root row `FOR UPDATE`.
8. Rechecks any mutation restrictions that depend on current usage.
9. Updates root metadata.
10. Deletes owned operand, criterion, and expression rows through cascades.
11. Reinserts the supplied tree with its stable IDs and positions.
12. Commits and returns the freshly loaded aggregate.

Problem definition replacement follows the same pattern for choices,
resolutions, outcomes, consequence sets, effects, and operands.

Delete-and-reinsert is acceptable because no external resource references an
expression node or effect. Their IDs are stable at the domain/API level and are
reused inside the same transaction. Aggregate root IDs and all external foreign
keys remain untouched.

If concurrent configuration editing is later supported, add an aggregate
revision token and conditional root update. This is not configuration history;
it is lost-update protection.

## Aggregate loading

Avoid one enormous query with a Cartesian product of every child collection.
Each store loader should use one transaction or consistent connection and a
small, predictable set of ordered queries:

```text
LoadConditionSet
  1. root metadata
  2. expression nodes ordered by parent and position
  3. criteria
  4. number predicates
  5. Boolean predicates
  6. choice operands ordered by position
  7. referenced definition/option display metadata
  8. assemble and validate tree in memory

LoadProblemDefinition
  1. root metadata
  2. choices ordered by position
  3. resolutions
  4. outcomes
  5. consequence sets
  6. effects ordered by consequence and position
  7. effect operands ordered by effect and position
  8. referenced definitions, entities, and condition summaries
  9. assemble and validate aggregate in memory
```

Rows missing a required subtype or carrying an impossible union shape indicate
corrupt stored data and must produce an internal validation error. Loaders must
not silently drop malformed rows.

## State endpoints

`GET .../entities/{id}/state` returns both stored and logical information:

```ts
type StateRecordResponse = {
  owner_type: "participant" | "problem-instance";
  owner_id: string;
  revision: number;
  values: Record<string, StateValue>;
  defaults: string[];
  unknown: string[];
  updated_at: string;
};
```

`values` contains the complete logical view. `defaults` identifies definition
IDs whose values were materialized from defaults. `unknown` identifies omitted
unknown variables. A diagnostic/editor view may additionally expose raw stored
values, but clients must not infer missing semantics themselves.

`PUT .../state` supplies a complete logical value map and
`expected_revision`. It is intended for explicit state maintenance. The server:

1. Loads all relevant variable definitions.
2. Validates and normalizes the complete value map.
3. Removes values equal to omitted defaults.
4. Begins a transaction and locks the state record.
5. Compares its revision to `expected_revision`.
6. Replaces the owner's `state_values` rows.
7. Increments the state-record revision.
8. Commits and returns the authoritative logical state.

This endpoint is never used to commit a client-calculated choice result.

## Condition evaluation API

The evaluate request binds a participant and, when problem state is referenced,
a problem instance:

```ts
type EvaluateConditionRequest = {
  participant_id: string;
  problem_instance_id?: string;
};
```

The server loads and validates one consistent snapshot. Evaluation returns:

```ts
type ConditionStatus = "met" | "unmet" | "unknown";

type ConditionEvaluationNode = {
  expression_id: string;
  status: ConditionStatus;
  message: string;
  address?: {
    target: "participant" | "problem";
    state_variable_id: string;
  };
  actual?: StateValue;
  children?: ConditionEvaluationNode[];
};

type ConditionEvaluation = {
  condition_set_id: string;
  status: ConditionStatus;
  root: ConditionEvaluationNode;
  missing_values: Array<{
    target: "participant" | "problem";
    state_variable_id: string;
  }>;
};
```

Evaluation is read-only. The explanation tree follows authored child order.
`missing_values` is deduplicated and deterministically ordered.

## Preview and resolution API

Preview and resolution requests identify the participant. The problem target is
implied by the problem-instance route:

```ts
type ResolveChoiceRequest = {
  participant_id: string;
};
```

The client submits neither an outcome nor calculated effects. The server is
authoritative and reevaluates availability and resolution conditions.

An applied effect is returned as:

```ts
type AppliedEffect = {
  effect_id: string;
  address: {
    target: "participant" | "problem";
    state_variable_id: string;
  };
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
      availability_evaluations: ConditionEvaluation[];
      resolution_evaluation?: ConditionEvaluation;
      applied_effects: AppliedEffect[];
      state: {
        participant: StateRecordResponse;
        problem: StateRecordResponse;
      };
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

Preview returns the same shape, including simulated `applied_effects` and
updated logical state, but performs no writes. Its response must clearly include
`preview: true`. A later resolution can differ because current state or mutable
configuration changed.

## Resolution transaction

Choice resolution is the most important transaction boundary.

1. Begin a transaction.
2. Load the problem instance and confirm its problem definition.
3. Lock the problem-definition root and every referenced condition-set root for
   shared use. Configuration writers lock those roots exclusively.
4. Lock participant and problem state-record rows with `FOR UPDATE` in sorted
   entity-ID order to prevent deadlocks.
5. Load the complete problem, referenced conditions, state-variable
   definitions, and both persisted state records through the same transaction.
6. Validate definitions and state.
7. Materialize defaults into an immutable in-memory snapshot.
8. Evaluate problem and choice availability.
9. Return unavailable or incomplete without writes if required.
10. Select the automatic outcome or evaluate the resolution condition.
11. Return incomplete without writes if the resolution condition is unknown.
12. Apply the selected outcome's effects in order to working copies.
13. Abort if any effect is invalid against the state reached at that point.
14. Normalize values equal to omitted defaults out of persistence.
15. Replace only the affected variables' `state_values` rows.
16. Increment each changed state record's revision. A record unchanged by
    idempotent effects keeps its revision.
17. Commit.
18. Return explanations, applied-effect details, and freshly constructed logical
    state.

Any SQL error, validation error, state conflict, or effect failure rolls back
the entire transaction. Participant and problem state can never reflect only
part of an outcome.

Configuration is mutable and unversioned, but the shared root locks ensure a
resolution observes one serializable configuration choice relative to a save.
Configuration saves must acquire the corresponding root locks before replacing
children.

## Pure resolver flow

The transaction supplies fully hydrated values to `rules.ResolveChoice`:

```go
type ResolutionInput struct {
    Problem     ProblemDefinition
    InstanceID  uuid.UUID
    ChoiceID    uuid.UUID
    Definitions map[uuid.UUID]StateVariableDefinition
    Conditions  map[uuid.UUID]ConditionSet
    Participant StateRecord
    ProblemState StateRecord
}
```

The pure resolver:

1. Verifies all cross-references.
2. Evaluates availability.
3. Selects an outcome.
4. Copies the two state records.
5. Applies effects sequentially.
6. Records before/after values and whether each effect changed state.
7. Returns a resolution result plus the changed working records.

It does not increment revisions or decide SQL mutations. The application layer
does so only after successful domain resolution.

## Validation layers

Validation occurs in four layers:

1. Request validation checks JSON shape, required fields, IDs, and basic string
   limits.
2. Domain validation checks every invariant enumerated in `DATA.md`.
3. PostgreSQL constraints protect ownership, shape, uniqueness, and foreign
   keys against programming mistakes or concurrent changes.
4. Runtime resolution validation checks current state and effect reachability
   inside the resolution transaction.

The frontend may prevent obvious invalid edits but never replaces server
validation.

Use typed errors rather than matching message text:

```go
type ValidationError struct {
    Code   string
    Path   string
    Message string
}

type ValidationErrors []ValidationError
```

Paths use stable resource IDs where possible, for example:

```text
root.children[expr-uuid].predicate.value
choices[choice-uuid].outcomes.met.effects[effect-uuid].amount
```

This lets the React editors attach server errors to the correct stable node even
after local reordering.

## Configuration interface

### State-variable catalog

The catalog groups definitions by owner type, section, and category. An author
can:

- add a definition;
- edit label, description, presentation, and display order;
- choose owner type, category, cardinality, schema, and missing semantics before
  first use;
- configure choice options, measurement units, and allowed reference types;
- enable supported condition and effect operations;
- archive an unused or superseded variable; and
- inspect state, condition, and effect usages.

The UI explains why a used semantic schema cannot change or be deleted.

### Condition-set library

The library shows name, description, archive state, and every problem or choice
usage. Authors can create, duplicate, edit, and archive sets. Before a shared set
is edited or archived, the UI shows the definitions that will be affected.

### Condition composer

The composer is a stable-ID tree editor:

1. Add an `all`, `any`, or `at-least` group.
2. Add a criterion under a group.
3. Select participant or problem state.
4. Select an active condition-addressable variable for that target.
5. Derive the operator menu from the variable schema.
6. Derive the operand control from the operator.
7. Move and reorder nodes without changing their IDs.
8. Continuously render a readable summary.
9. Save the complete condition set.

Boolean capabilities use natural labels such as `Has Athletics` and `Does not
have Athletics`, while the canonical predicate remains `is true` or `is false`.

### Problem and choice composer

The editor supports:

- problem metadata and problem-level availability;
- ordered choice creation, duplication, movement, and removal;
- optional choice-level availability;
- automatic or conditional resolution;
- resolution condition selection;
- explicit automatic, met, and unmet outcome labels;
- ordered effects on every outcome;
- only operations enabled for the selected variable;
- readable transition previews; and
- reference-usage inspection.

The interface visually separates **Available when** from **When chosen, test**
so a fallible attempt is not accidentally modeled as unavailable.

### State inspector

The state inspector is a testing and operational-correction tool, not a complete
participant builder. It can:

- distinguish stored, defaulted, and unknown values;
- validate a state record;
- edit values through definition-driven controls;
- display the current revision; and
- preview conditions and choices against selected participant/problem state.

### Runtime resolution

The runtime surface shows available, unavailable, and incomplete choices with
derived explanations. Selecting a choice sends only its stable ID and the bound
participant. The server reevaluates and returns the authoritative result.

## Frontend implementation

Feature code should be organized around API resources rather than database
tables. The browser should never need to know that a condition is stored across
several relations.

Recommended modules:

```text
src/api/client.ts
src/api/types.ts
src/api/errors.ts

src/features/state-variables/
  StateVariableList.tsx
  StateVariableEditor.tsx
  schemaControls.tsx

src/features/condition-sets/
  ConditionSetList.tsx
  ConditionComposer.tsx
  ConditionNodeEditor.tsx
  conditionTree.ts

src/features/problems/
  ProblemList.tsx
  ProblemEditor.tsx
  ChoiceEditor.tsx
  OutcomeEditor.tsx
  EffectEditor.tsx

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
resource with the authoritative response and invalidate relevant lists and
usage summaries.

Accessibility requirements include keyboard-operable tree movement, explicit
labels for condition/effect controls, focus placement on validation errors, and
textual status that does not rely on color alone.

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

- use zero-padded names such as `001_init.sql`;
- never edit a migration that may have reached a persistent database;
- make forward-only corrective migrations;
- name constraints explicitly;
- add `updated_at` triggers to mutable roots;
- use composite foreign keys where ruleset, owner type, or value kind must agree;
- use `ON DELETE CASCADE` only for owned aggregate children;
- use `ON DELETE RESTRICT` for referenced definitions and entities;
- seed stable IDs and keys idempotently with `ON CONFLICT`; and
- test both empty-database creation and upgrade from the previous migration.

Suggested initial split:

```text
001_init.sql
  pgcrypto, schema_migrations helper, timestamp trigger, rule_sets, entities

002_state_variables.sql
  definitions, options, units, allowed types, operations, defaults

003_state.sql
  state records and values

004_conditions.sql
  condition sets, nodes, criteria, and operands

005_problems.sql
  problem definitions, instances, choices, outcomes, effects, operands

006_seed_initial_catalog.sql
  complete initial state-variable catalog
```

The seed migration must use stable UUID constants so conditions and fixtures can
refer to catalog definitions consistently across databases.

Only one process should apply new migrations at deployment time unless the
runner takes a PostgreSQL advisory lock. Adding an advisory lock to the runner
is preferable before horizontal deployment.

## Query and transaction practices

- Every query is ruleset-scoped, including lookups by globally unique UUID.
- Request contexts flow into every `pgx` call.
- Long-running requests receive explicit timeouts.
- Transactions use `defer tx.Rollback(ctx)` followed by an explicit commit.
- Locks are acquired in deterministic order.
- List queries order by stable explicit columns and IDs as tie breakers.
- Stores return domain-level not-found and conflict errors rather than leaking
  `pgx.ErrNoRows` to handlers.
- Writes reload their aggregate before returning unless the writer can prove its
  in-memory representation exactly matches database defaults and triggers.

No transition event is written during resolution. Logs may record resource IDs,
outcome ID, duration, and failure category, but must not be treated as durable
history.

## Testing strategy

### Pure domain tests

These should be the largest and fastest test group:

- validation of every value kind and cardinality;
- default and unknown materialization;
- normalized equality and duplicate detection;
- numeric bounds and steps;
- condition tree validation, cycles, depth, and size limits;
- full three-valued truth tables for `all`, `any`, and `at-least`;
- all number, Boolean, and choice predicates;
- explanation-node IDs and missing-address deduplication;
- each effect operation;
- ordered effects observing earlier changes;
- idempotent add/remove behavior;
- atomic failure when a later effect is invalid;
- availability versus resolution behavior; and
- automatic, met, unmet, unknown, and unavailable outcomes.

### Store and migration tests

Run against a disposable PostgreSQL database:

- apply the complete migration chain to an empty database;
- upgrade a database at the preceding migration;
- verify every important foreign key and check constraint;
- round-trip every definition and typed value kind;
- round-trip condition trees with stable ordering and IDs;
- round-trip problems with empty and non-empty consequences;
- replace whole aggregates without leaving orphan rows;
- verify archive and deletion restrictions;
- verify state revision conflicts; and
- verify participant/problem writes commit or roll back together.

### Handler tests

- unknown JSON fields and trailing input are rejected;
- route/body ID mismatches are rejected;
- errors use the stable envelope and status mapping;
- ruleset boundaries cannot be crossed;
- save responses return authoritative aggregates;
- preview never writes;
- resolution never accepts client-selected outcomes or state; and
- concurrent resolution and direct state edits produce one valid serial order.

### Frontend tests

- schema metadata selects the right controls and operators;
- stable node IDs survive movement and reordering;
- `at-least` validation tracks child count;
- available and resolution conditions remain visually distinct;
- server validation paths focus the correct editor node;
- defaults and unknown values are visibly different;
- incomplete resolution never appears as failure; and
- preview is clearly advisory.

End-to-end tests should cover the Trapped Reliquary example from initial state
through both successful and failed outcomes.

## Local development and CI

`run.sh` should provide a small process controller similar to the reference
application:

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
9. Migration/integration tests when a test PostgreSQL URL is available.

Generated production assets should either be built in CI/deployment or checked
in according to the eventual deployment environment; choose one policy and
enforce it consistently.

## Implementation sequence

### Phase 1: application skeleton

- Initialize Go module and Bun/Vite/React frontend.
- Add configuration, logging, health route, graceful shutdown, static serving,
  migration runner, `run.sh`, and `ci.sh`.
- Create a local PostgreSQL database and verify empty startup.

### Phase 2: relational foundations

- Add rulesets, entities, subtypes, and state-variable definition tables.
- Seed the complete initial catalog.
- Implement definition aggregate loading, validation, and CRUD.
- Build the state-variable catalog UI.

### Phase 3: current state

- Add state records and relational typed values.
- Implement normalization, defaults, unknowns, revision checks, and state APIs.
- Build the minimal state inspector.

### Phase 4: conditions

- Add normalized expression and predicate tables.
- Implement pure validation, evaluation, and explanations.
- Add condition-set CRUD, duplication, usage reads, and evaluation.
- Build the condition library and composer.

### Phase 5: problems and effects

- Add problem, choice, resolution, outcome, consequence, and effect tables.
- Implement problem validation and aggregate persistence.
- Implement pure effect application.
- Build the problem and effect composer.

### Phase 6: transactional resolution

- Implement problem instances.
- Implement preview.
- Implement locked atomic resolution and state revision updates.
- Build the runtime choice and explanation surface.

### Phase 7: hardening

- Add comprehensive PostgreSQL integration and concurrency tests.
- Add request limits, timeouts, pagination where needed, and performance indexes.
- Complete accessibility and end-to-end coverage.
- Define authentication, ruleset membership, and deployment policy before the
  application is exposed beyond a trusted local environment.

## Explicitly deferred implementation

Do not add generic infrastructure for the deferred features listed in
`DATA.md`. In particular, do not introduce:

- a generic expression language;
- JSON patches for configuration;
- event-sourcing infrastructure;
- background job systems;
- plugin execution;
- generic webhooks;
- configuration revision history;
- arbitrary polymorphic state owners; or
- a reusable consequence abstraction before actual reuse appears.

The first implementation should remain a comprehensible relational state
machine whose behavior is visible in Go types, SQL relations, and tests.

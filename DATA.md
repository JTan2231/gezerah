# Stateful Rule Composer Data Model

## Purpose

This document defines the domain semantics and PostgreSQL data model for the
stateful rule composer. Implementation architecture, HTTP behavior, frontend
structure, transactions, and testing are specified in `CODE.md`.

The system lets a rules author configure kinds of state owner, typed state
variables, conditions over current world state, problems with selectable
choices, and ordered consequences that change world state. A problem definition
declares named target slots. A problem instance binds those slots to concrete
entities. Conditions and effects address state through those bindings rather
than through built-in notions such as a participant, item, environment, or
problem target.

```text
Configured owner schemas ----> State-variable definitions
            |                              |
            v                              v
World entities --------------------> Current world state
            ^                              |
            |                              |
Problem target definitions                |
            |                              |
            v                              v
Problem-instance bindings -> Conditions -> Outcome -> Ordered effects
                                                      |
                                                      v
                                             Updated world state
```

This is a small typed state-transition system. World state is the collection of
current values owned by entities. A problem does not own or contain that world
state; it supplies a bounded context through which a transition reads and
changes it. A problem instance is itself an entity and may own local state when
its configured owner schemas permit it, but it receives no special state
variables automatically.

A snapshot is a consistent read of the entity state records needed by one
evaluation or resolution. It is not a retained historical artifact or a
dependency graph. Definitions, bindings, and current state are directly
mutable. The initial system has no publication lifecycle, configuration
versions, event log, state history, or stored snapshots. Editing shared
configuration changes future evaluation immediately; applying an outcome
updates current world state in place.

The model contains no required world ontology or state-variable catalog. Terms
such as person, creature, object, location, weather, health, inventory, or
resolved are ruleset configuration if a rules author chooses to introduce
them. The engine does not recognize their keys or assign them behavior.

## Requirements

The model must support:

- generic durable entities that may own or be referenced by state;
- a configurable vocabulary of owner schemas describing which entities may own
  which state variables;
- a configurable vocabulary of typed state variables;
- metadata-driven configuration and state-editing interfaces;
- current state distributed across any number of world entities;
- problem-defined singular and plural target slots bound to entities at
  runtime;
- reusable condition sets with declared target parameters;
- explicit mapping from reusable condition parameters to problem targets;
- deterministic three-valued condition evaluation over singular and plural
  targets;
- explanations of why a condition is met, unmet, or unknown;
- separate availability and resolution conditions;
- typed effects applied to explicitly selected targets in an explicit order;
- consequences on both met and unmet outcomes;
- atomic outcome application across every affected entity state record;
- validation before schemas, entities, definitions, bindings, conditions,
  problems, or state are saved;
- stable identities for expression nodes, parameters, target slots, choices,
  outcomes, consequence sets, and effects;
- future extension to derived values and transition history without requiring
  either initially; and
- fully relational PostgreSQL persistence without JSON or JSONB columns.

The database also avoids PostgreSQL array columns for modeled collections.
Schema memberships, options, units, operands, target bindings, effects, and
many-valued state are child rows.

## Non-goals

The initial model does not include:

- a complete entity-creation or world-authoring workflow;
- a built-in taxonomy of entity types;
- automatic discovery of entities by location, proximity, ownership, or other
  world queries;
- target selectors or arbitrary query expressions;
- dice, random outcomes, checks, modifiers, or difficulty classes;
- derived state, formulas, or dependency graphs;
- state history, provenance, event sourcing, replay, or historical snapshots;
- drafts, publishing, or versioned rule definitions;
- arbitrary executable expressions or user-provided scripts;
- comparisons between state variables;
- effects that change owner-schema membership;
- structured inventory, equipment, encumbrance, currency, or economy semantics;
- consequences that send messages or invoke external systems; or
- concurrent configuration editing as a user-facing workflow.

Target bindings are explicit rows. A caller or a future higher-level subsystem
may decide that a collection represents entities in an immediate vicinity, but
the initial resolver neither discovers nor continuously recomputes that
collection.

## Core concepts

| Concept | Meaning |
| --- | --- |
| Ruleset | Ownership and namespace boundary for configuration and runtime entities. |
| Entity | A durable identity that may own state, be referenced by state, or be bound into a problem. |
| Owner schema | Configured capability that makes an entity eligible to own particular state variables. |
| State variable | A declared, typed location that may hold a value on eligible entities. |
| State record | The maintained current values for one entity. |
| World state | The logical collection of all current entity state records in a ruleset. |
| State snapshot | A consistent read of the records and values needed for one operation. |
| Target definition | A named, typed slot in a problem definition. |
| Target binding | The association of a target slot with a concrete entity in one problem instance. |
| Condition parameter | A target expected by a reusable condition set. |
| Condition invocation | A use of a condition set that maps each parameter to a problem target. |
| Condition | A read-only expression returning `met`, `unmet`, or `unknown`. |
| Requirement | A condition used as a prerequisite; not a separate expression type. |
| Effect | One typed operation applied to state on one or more bound entities. |
| Consequence set | An ordered list of effects applied atomically. |
| Problem definition | Authored configuration describing target slots, choices, and consequences. |
| Problem instance | One occurrence of a problem definition with concrete target bindings. |
| Choice | An action selected in the context of a problem instance. |
| Outcome | The branch selected when a choice resolves. |
| Transition | The atomic selection and application of one outcome. |

Conceptually:

```text
WorldState:   (entity ID, state-variable ID) -> typed value
Eligibility:  entity owner schemas intersect variable owner schemas
Bindings:     problem target ID -> ordered set of entity IDs
Invocation:   condition parameter ID -> problem target ID
Condition:    bindings + WorldState -> met | unmet | unknown
Effect:       bindings + WorldState -> WorldState | application error
Resolution:   current bindings + current state + chosen choice
              -> outcome + updated world state
```

`Current` and `updated` describe the before and after values of one transaction;
they do not imply retained copies.

## Relational conventions

- Primary keys are UUIDs generated by PostgreSQL with `gen_random_uuid()`.
- IDs are durable references. Human-readable keys are never derived from labels.
- Mutable aggregate roots carry `created_at` and `updated_at` timestamps.
- Enum-like values use `text` plus named `CHECK` constraints rather than
  PostgreSQL enum types.
- Owned child records use `ON DELETE CASCADE`; referenced configuration normally
  uses `ON DELETE RESTRICT`.
- Referenced definitions are archived rather than deleted.
- Ordered children use a zero-based non-negative `position` and a unique
  constraint within their parent.
- A child row that references a second ruleset-scoped aggregate repeats
  `rule_set_id` and uses composite foreign keys to both parents. This deliberate
  redundancy lets PostgreSQL reject cross-ruleset references without triggers.
- Numbers use PostgreSQL `numeric`. The application rejects NaN, infinities,
  out-of-bound values, and values that do not align to a declared step.
- JSON is an API representation only. No canonical application data is stored
  in `json`, `jsonb`, or array columns.

Some invariants depend on data in another row or on an entire tree. PostgreSQL
enforces row shape, uniqueness, ownership, and referential integrity; the domain
validator authoritatively enforces cross-row bounds, steps, cardinality, owner
eligibility, binding compatibility, tree acyclicity, maximum depth, and operator
compatibility.

## Ownership and world entities

### `rule_sets`

A ruleset scopes all authored definitions and runtime entities. A deployment
may create an initial empty ruleset, but no owner schemas, entity classifications,
state variables, or world entities are required seed data.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `key` | `text` | Non-empty, stable, unique. |
| `name` | `text` | Non-empty. |
| `description` | `text` | Nullable. |
| `created_at` | `timestamptz` | Required. |
| `updated_at` | `timestamptz` | Required. |

### `state_owner_schemas`

Owner schemas are ruleset-configured capabilities for state ownership. They
describe applicability, not current state and not engine behavior. An entity may
implement any number of schemas.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `rule_set_id` | `uuid` | FK to the owning ruleset. |
| `key` | `text` | Non-empty and unique within the ruleset. |
| `label` | `text` | Non-empty. |
| `description` | `text` | Nullable. |
| `archived` | `boolean` | Defaults to false. |
| `created_at` | `timestamptz` | Required. |
| `updated_at` | `timestamptz` | Required. |

An owner schema may represent any author-defined capability, such as being able
to hold a particular family of state. The engine assigns no semantics to its
key. Schemas are compositional rather than a single inheritance hierarchy: one
entity may implement several independent schemas.

Archived schemas remain valid for existing memberships and definitions but
cannot be selected for new configuration. A referenced schema cannot be
deleted. Changing the semantic meaning of a used schema requires a new schema
ID and key.

### `entities`

`entities` contains generic durable identities. There are no built-in entity
types or domain subtype tables.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `rule_set_id` | `uuid` | FK to `rule_sets`; required. |
| `key` | `text` | Nullable; when present, non-empty and unique within the ruleset. |
| `display_name` | `text` | Non-empty current display label. |
| `archived` | `boolean` | Defaults to false. |
| `created_at` | `timestamptz` | Required. |
| `updated_at` | `timestamptz` | Required. |

`display_name` is entity identity and picker metadata, not a distinguished state
variable. A ruleset may separately define a name-like state variable, but the
engine does not synchronize it with `display_name`.

Entity schema membership is relational:

```text
entity_owner_schemas
  entity_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (entity_id, owner_schema_id)
```

The entity and schema must belong to the same ruleset. An entity may have no
owner schemas, in which case it may still be referenced or bound to an
unconstrained target but cannot own configured state.

Removing a schema membership is a semantic mutation. It is rejected if existing
state values or active problem bindings would become ineligible. Owner-schema
membership is not ordinary mutable world state and cannot initially be changed
by effects.

## Value schemas

Every state-variable definition declares one scalar value kind and a cardinality
of `one` or `many`.

| Kind | Schema metadata | Scalar logical value |
| --- | --- | --- |
| `text` | None initially. | String. |
| `choice` | Ordered configured options. | One option key. |
| `measurement` | Ordered units; optional minimum, maximum, and step. | Numeric amount and unit. |
| `number` | Optional minimum, maximum, step, and display unit. | Number. |
| `boolean` | None. | Boolean. |
| `reference` | Optional target owner-schema restrictions. | Entity ID and optional fallback name. |

Many-valued variables have set semantics. Positions are persisted only to make
editing and API serialization deterministic; reordering does not change logical
meaning. Normalized duplicates are invalid. Ordered lists and multisets require
new explicit schemas later.

The model does not include a separate relationship scalar kind initially. A
rules author can give a reference variable relationship meaning through its
definition. A future relationship kind must introduce behavior that is not
already expressed by a named reference variable.

## State-variable definitions

### `state_variable_definitions`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `rule_set_id` | `uuid` | FK to the owning ruleset. |
| `key` | `text` | Namespaced and unique within the ruleset. |
| `label` | `text` | Non-empty. |
| `description` | `text` | Nullable. |
| `presentation_group` | `text` | Nullable user-authored UI grouping label; no fixed vocabulary. |
| `value_kind` | `text` | One supported scalar kind. |
| `cardinality` | `text` | `one` or `many`. |
| `missing_kind` | `text` | `unknown` or `default`. |
| `omit_default_when_stored` | `boolean` | Allowed only for a default. |
| `condition_addressable` | `boolean` | Whether new criteria may reference it. |
| `display_order` | `integer` | Non-negative. |
| `presentation_control` | `text` | Nullable supported control name. |
| `presentation_help_text` | `text` | Nullable. |
| `number_minimum` | `numeric` | Nullable; number schemas only. |
| `number_maximum` | `numeric` | Nullable; number schemas only. |
| `number_step` | `numeric` | Nullable and positive; number schemas only. |
| `number_unit` | `text` | Nullable display unit; number schemas only. |
| `measurement_minimum` | `numeric` | Nullable; measurement schemas only. |
| `measurement_maximum` | `numeric` | Nullable; measurement schemas only. |
| `measurement_step` | `numeric` | Nullable and positive; measurement schemas only. |
| `archived` | `boolean` | Defaults to false. |
| `created_at` | `timestamptz` | Required. |
| `updated_at` | `timestamptz` | Required. |

The definition table exposes
`UNIQUE (id, rule_set_id, value_kind, cardinality)` for typed current-value and
operand foreign keys.

Supported presentation controls are:

```text
short-text, long-text, select, measurement, number, checkbox,
reference-picker
```

Presentation controls are implementation vocabulary. They do not assign domain
semantics to a state variable.

### Definition child tables

```text
state_variable_owner_schemas
  state_variable_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (state_variable_id, owner_schema_id)

state_variable_choice_options
  id
  state_variable_id
  key
  label
  position
  UNIQUE (state_variable_id, key)
  UNIQUE (state_variable_id, position)

state_variable_measurement_units
  id
  state_variable_id
  unit
  position
  UNIQUE (state_variable_id, unit)
  UNIQUE (state_variable_id, position)

state_variable_reference_target_schemas
  state_variable_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (state_variable_id, owner_schema_id)

state_variable_effect_operations
  state_variable_id
  operation
  PRIMARY KEY (state_variable_id, operation)
```

Every state-variable definition requires at least one owner schema. An entity is
eligible to own that variable when it implements at least one of the variable's
owner schemas.

A reference variable with no target-schema rows may reference any entity in the
same ruleset. When target-schema rows exist, the referenced entity must
implement at least one listed schema.

Effect operations are `set`, `clear`, `adjust-number`, `add-value`, and
`remove-value`.

### Relational typed-value shape

Defaults, current state, and effect literals use the same conceptual checked
union of ordinary columns:

```text
value_kind
text_value
number_value
boolean_value
choice_option_id
measurement_amount
measurement_unit_id
referenced_entity_id
fallback_name
```

The discriminator determines the populated columns:

- `text`: `text_value` only;
- `number`: `number_value` only;
- `boolean`: `boolean_value` only;
- `choice`: `choice_option_id` only;
- `measurement`: `measurement_amount` and `measurement_unit_id`; and
- `reference`: referenced entity ID and optional fallback name.

Choice-option and measurement-unit composite foreign keys ensure the selected
option or unit belongs to the referenced variable. Entity composite foreign
keys ensure references stay inside the ruleset. Owner-schema compatibility for
reference targets is authoritative application validation because eligibility
depends on membership rows.

### `state_variable_default_values`

This table owns zero or more typed-value rows for a definition:

```text
state_variable_default_values
  id
  rule_set_id
  state_variable_id
  value_kind
  cardinality
  position
  <typed-value columns>
  UNIQUE (state_variable_id, position)
```

`missing_kind = unknown` requires no default rows. A single-valued default
requires exactly one row. A many-valued default may have zero or more unique
rows. Zero rows plus `missing_kind = default` represents an empty set.
`rule_set_id` is constrained against the owning definition and any referenced
entity, preventing a reference default from crossing rulesets.

Once a definition is referenced by state, a condition, or an effect, its owner
schemas, value schema, cardinality, missing semantics, and semantic meaning
cannot change in place. Labels, descriptions, presentation hints, display
order, and archive state remain mutable. A semantic replacement receives a new
ID and key.

Archived definitions remain readable by existing state and rules but cannot be
selected for newly authored criteria or effects.

### Configuration boundary

The data model defines no initial state-variable catalog. Owner schemas,
variables, choices, units, reference restrictions, defaults, and permitted
operations are authored configuration. Deployment-specific examples or starter
rulesets belong in separate fixtures or seed migrations and must use the same
public creation and validation semantics as user-authored configuration.

No engine behavior may branch on a configured schema, variable, option, entity,
target, condition, problem, or choice key.

## Current world-state records

### `state_records`

```text
state_records
  owner_entity_id PK
  rule_set_id
  revision
  updated_at
```

`owner_entity_id` and `rule_set_id` have a composite foreign key to `entities`.
A record is created atomically with every entity and retained for the entity's
lifetime, even when it has no persisted values. This gives absence, revisions,
and locking one uniform representation.

`revision` is an optimistic-concurrency token, not history. It starts at zero
and increments whenever that record's persisted values or owner-schema
memberships change.

### `state_values`

```text
state_values
  id
  owner_entity_id
  rule_set_id
  state_variable_id
  value_kind
  cardinality
  position
  <typed-value columns>
```

Required constraints include:

- a composite FK from the owner columns to `state_records`;
- a composite FK from variable ID, ruleset, value kind, and cardinality to
  `state_variable_definitions`;
- unique `(owner_entity_id, state_variable_id, position)`;
- `position = 0` for single-valued rows;
- a partial unique constraint on `(owner_entity_id, state_variable_id)` for
  `cardinality = one`;
- typed-row shape checks; and
- normalized duplicate checks for many-valued variables, implemented with
  kind-specific partial unique indexes where practical and authoritative
  application validation in all cases.

The owner entity must implement at least one owner schema allowed by the state
variable. This cross-row eligibility rule is enforced by the domain validator
on every state read and write.

Stored values equal to an omitted default are normalized out. A missing entry
with a default is materialized logically during reads, evaluation, and effect
application. A missing entry with unknown semantics remains unknown.

The API representation of one record and a bounded snapshot is:

```ts
type StateRecord = {
  ownerEntityId: string;
  revision: number;
  values: Record<string, StateValue>;
  updatedAt: string;
};

type StateSnapshot = {
  records: Record<string, StateRecord>;
};
```

The snapshot contains the records needed for the current operation, not every
entity in the ruleset. The maps and arrays exist only at the API/domain
boundary; PostgreSQL stores their members as rows.

## Conditions

A condition is the underlying read model. A requirement, availability guard,
and resolution test all use the same expression representation.

### `condition_sets`

```text
condition_sets
  id
  rule_set_id
  key
  name
  description
  archived
  created_at
  updated_at
  UNIQUE (rule_set_id, key)
  UNIQUE (id, rule_set_id)
```

Condition sets are mutable and reusable. Editing one affects every invocation
that references it. Existing invocations of archived sets remain valid;
archived sets cannot be selected for new invocations.

### Condition parameters

A reusable condition set addresses declared parameters rather than problem
targets or concrete entities.

```text
condition_parameters
  id
  rule_set_id
  condition_set_id
  key
  label
  cardinality         one | many
  position
  UNIQUE (condition_set_id, key)
  UNIQUE (condition_set_id, position)

condition_parameter_required_owner_schemas
  condition_parameter_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (condition_parameter_id, owner_schema_id)
```

Each parameter requires at least one owner schema. A bound entity must implement
every schema required by the parameter. Requiring all listed schemas lets one
parameter safely support criteria over several independently configured
capabilities.

Every criterion's variable must allow at least one schema required by its
parameter. This guarantees that any valid binding is eligible to own the
variable.

### `condition_expression_nodes`

```text
condition_expression_nodes
  id
  rule_set_id
  condition_set_id
  parent_node_id nullable
  position
  node_type       all | any | at-least | criterion
  required_count nullable
```

Constraints include:

- at most one root through a partial unique index on `condition_set_id` where
  `parent_node_id IS NULL`, with validation requiring that root to exist;
- a composite self-FK that requires parent and child to belong to the same set;
- a composite FK that requires the node and set to share a ruleset;
- unique node IDs;
- unique `(condition_set_id, parent_node_id, position)` for siblings;
- non-negative positions; and
- `required_count` present only for `at-least` nodes.

Expression IDs remain stable when nodes are moved or edited. They are frontend
keys and identifiers in evaluation explanations.

### Criteria and operands

```text
condition_criteria
  expression_node_id PK
  condition_set_id
  rule_set_id
  condition_parameter_id
  state_variable_id
  quantifier          single | any | all | at-least
  required_count nullable
  operator            eq | gt | gte | lt | lte | between | is | one-of

condition_number_predicates
  criterion_node_id PK
  value nullable
  minimum nullable
  maximum nullable

condition_boolean_predicates
  criterion_node_id PK
  value

condition_choice_operands
  criterion_node_id
  choice_option_id
  position
  PRIMARY KEY (criterion_node_id, position)
  UNIQUE (criterion_node_id, choice_option_id)
```

A criterion on a `one` parameter requires `quantifier = single`. A criterion on
a `many` parameter requires `any`, `all`, or `at-least`; `required_count` is
present only for `at-least` and must be positive.

The scalar predicate is evaluated separately for every entity bound to the
parameter, then the quantifier combines those results:

- `any` is met if any entity result is met, unmet if every entity result is
  unmet, and unknown otherwise. An empty binding is unmet.
- `all` is unmet if any entity result is unmet, met if every entity result is
  met, and unknown otherwise. An empty binding is met.
- `at-least N` is met when at least N entity results are met, unmet when the
  count of met plus unknown results is below N, and unknown otherwise.

Target minimum-binding constraints normally avoid empty collections where
vacuous `all` semantics would be surprising.

Number operators `eq`, `gt`, `gte`, `lt`, and `lte` use `value`. `between` uses
inclusive `minimum` and `maximum`. Boolean `is` uses one Boolean row. Choice
`is` uses one option row; `one-of` uses one or more unique option rows.

Initial predicate support is:

| Variable schema | Predicates |
| --- | --- |
| number | `eq`, `gt`, `gte`, `lt`, `lte`, `between` |
| boolean | `is true`, `is false` |
| choice | `is`, `one-of` |

Text, measurement, reference, and many-valued state predicates are not initially
exposed. Number operands must be finite and within variable bounds. A range
requires `minimum <= maximum`. Choice operands must name currently declared
options.

### Expression-group semantics

Expression groups must contain at least one child.

- `all` is unmet if any child is unmet, met if every child is met, and unknown
  otherwise.
- `any` is met if any child is met, unmet if every child is unmet, and unknown
  otherwise.
- `at-least N` is met when at least N children are met, unmet when the count of
  met plus unknown children is below N, and unknown otherwise.

An expression-group `at-least` count is an integer from one through the number
of children. Arbitrary group negation is intentionally absent because it
obscures missing-value semantics. A Boolean criterion can still explicitly
require false.

### Criterion semantics

For each bound entity:

- A known valid value satisfying its predicate is met.
- A known valid value not satisfying its predicate is unmet.
- A missing value with unknown semantics is unknown.
- A missing value with a default is evaluated using the default.
- A stored value with the wrong type, cardinality, or owner eligibility is
  invalid state and causes an input error rather than an unknown result.

The criterion's quantifier then combines the per-entity results. An evaluation
contains the condition-set ID, aggregate status, a tree of node results, and
unique missing state addresses. Every node result contains its expression ID,
status, and a derived human-readable message. Criterion results may also include
the parameter, concrete entity IDs, state-variable ID, and actual values.

Messages are derived from current entity names, variable labels, and canonical
values; they are not stored as authored rule text.

## Problems, targets, choices, and outcomes

### `problem_definitions`

```text
problem_definitions
  id
  rule_set_id
  key
  name
  description
  available_condition_invocation_id nullable
  archived
  created_at
  updated_at
  UNIQUE (rule_set_id, key)
  UNIQUE (id, rule_set_id)
```

Problem definitions are reusable mutable configuration. Editing one changes
future availability and resolution for all existing instances. Existing world
state is neither recalculated nor reversed. Structural edits must leave every
existing instance and binding valid; an incompatible edit is rejected rather
than implicitly rewriting instances.

### Instance owner schemas

A problem instance is represented by a generic entity so it may own explicitly
configured local state.

```text
problem_definition_instance_owner_schemas
  problem_definition_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (problem_definition_id, owner_schema_id)
```

When an instance is created, these configured memberships are attached to its
entity. They are a creation template, not a live projection: later edits do not
silently change existing entity memberships. The table may be empty, in which
case the problem instance cannot own state unless memberships are otherwise
supplied through an authorized entity workflow. No local state variables or
defaults are created merely because an entity represents a problem instance.

### Problem target definitions

```text
problem_target_definitions
  id
  rule_set_id
  problem_definition_id
  key
  label
  description nullable
  cardinality          one | many
  minimum_bindings
  maximum_bindings nullable
  binding_source       supplied | problem-instance
  position
  UNIQUE (problem_definition_id, key)
  UNIQUE (problem_definition_id, position)

problem_target_required_owner_schemas
  target_definition_id
  rule_set_id
  owner_schema_id
  PRIMARY KEY (target_definition_id, owner_schema_id)
```

`minimum_bindings` is non-negative. `maximum_bindings`, when present, is at
least the minimum. A `one` target has a maximum of one. A `many` target may have
any configured maximum or no maximum.

Every target mapped to a condition parameter or used by an effect requires at
least one owner schema. Every entity bound to a target must implement all
schemas required by that target. A `one` target used in either place must have
minimum and maximum bindings equal to one.

A `supplied` target receives its bindings when the instance is created or
edited. A `problem-instance` target is automatically bound to the instance's
own entity, must have cardinality one with minimum and maximum one, and may
appear at most once in a definition. Its required schemas must be included in
the definition's instance-owner schemas.

This is the only special binding source initially. It exposes the current
problem occurrence when authored rules need local state; it does not create a
fixed target name or fixed variable vocabulary.

### Condition invocations

A condition invocation applies a reusable condition set within one problem
definition by mapping every condition parameter to one problem target.

```text
condition_invocations
  id
  rule_set_id
  problem_definition_id
  condition_set_id

condition_invocation_arguments
  condition_invocation_id
  rule_set_id
  condition_parameter_id
  target_definition_id
  PRIMARY KEY (condition_invocation_id, condition_parameter_id)
```

Every condition parameter is mapped exactly once. Parameter and target
cardinalities must match. The target must require every owner schema required by
the parameter. All referenced rows must share a ruleset, and the target must
belong to the invocation's problem definition.

An invocation is owned by exactly one usage site: problem availability, choice
availability, or conditional choice resolution. The invocation is not a named
reusable resource; the condition set is the reusable resource.

### `problem_choices`

```text
problem_choices
  id
  rule_set_id
  problem_definition_id
  key
  name
  description
  position
  available_condition_invocation_id nullable
  UNIQUE (problem_definition_id, key)
  UNIQUE (problem_definition_id, position)
```

### `choice_resolutions`

```text
choice_resolutions
  choice_id PK
  rule_set_id
  resolution_type       automatic | condition
  condition_invocation_id nullable
```

An automatic resolution has no condition invocation. A condition resolution
requires one invocation belonging to the same problem definition.

### `choice_outcomes`

```text
choice_outcomes
  id
  rule_set_id
  choice_id
  branch                automatic | met | unmet
  label
  UNIQUE (choice_id, branch)
```

An automatic choice has exactly one `automatic` outcome. A conditional choice
has exactly one `met` and one `unmet` outcome. Both may have consequences,
including an explicitly empty consequence set.

### `consequence_sets`

```text
consequence_sets
  id
  rule_set_id
  outcome_id UNIQUE
```

Consequence sets are owned by outcomes rather than named reusable resources.
Their IDs remain stable for editing. Named reusable consequence sets are
deferred until demonstrated reuse justifies parameterization and shared-mutation
semantics.

## Effects

### `effects`

```text
effects
  id
  rule_set_id
  consequence_set_id
  position
  operation             set | clear | adjust-number | add-value | remove-value
  target_definition_id
  state_variable_id
  adjustment_amount nullable
  UNIQUE (consequence_set_id, position)
```

An effect applies the same operation independently to every entity bound to its
target, in binding position order, as part of the same atomic consequence set.
A `one` target therefore selects exactly one entity. Applying an effect to an
empty valid `many` binding is an explicit no-op.

The target must require at least one owner schema allowed by the state variable,
ensuring every valid binding is eligible to own the variable.

### `effect_value_operands`

```text
effect_value_operands
  id
  rule_set_id
  effect_id
  state_variable_id
  value_kind
  cardinality
  position
  <typed-value columns>
  UNIQUE (effect_id, position)
```

Operand counts depend on the operation:

- scalar `set`: exactly one operand;
- many-valued `set`: zero or more unique operands, with zero meaning the empty
  set;
- `clear`: no operands;
- `adjust-number`: no operand rows and one finite `adjustment_amount`;
- `add-value` and `remove-value`: exactly one scalar operand.

Effects have these semantics for each selected entity:

- `set` replaces the complete logical value.
- `clear` removes persisted rows; the resulting logical value is the variable's
  default or unknown.
- `adjust-number` adds its amount to a known single-valued number. Unknown input
  or an invalid result is an application error.
- `add-value` adds one normalized member to a many-valued set. Adding an
  existing member is an idempotent no-op.
- `remove-value` removes one normalized member from a many-valued set. Removing
  an absent member is an idempotent no-op.

Effects execute in consequence-set position order against a working copy of all
affected records. Within an effect over several bindings, entities are processed
in binding position order. Later effects observe every earlier result.

Every effect must be listed in the target variable's allowed operations and
must also have the correct structural shape:

| Operation | Required variable shape |
| --- | --- |
| `set` | Any supported schema with matching cardinality. |
| `clear` | Any supported schema. |
| `adjust-number` | Number with cardinality one. |
| `add-value` | Any supported scalar schema with cardinality many. |
| `remove-value` | Any supported scalar schema with cardinality many. |

An effect may be valid configuration but fail against runtime state, such as an
adjustment to an unknown number or a result outside declared bounds. One failure
on one entity aborts the complete consequence set across every entity. It is not
reinterpreted as an unmet resolution condition.

## Problem instances and target bindings

### `problem_instances`

```text
problem_instances
  entity_id PK/FK -> entities
  rule_set_id
  problem_definition_id
  binding_revision
  created_at
  updated_at
```

The instance entity provides durable identity and optional local state. Runtime
state never lives on a reusable problem definition. Existing instances prevent
their definition from being deleted. Archived definitions cannot create new
instances.

`binding_revision` is an optimistic-concurrency token for the current binding
set, not history. It increments whenever supplied target bindings change.

### `problem_instance_target_bindings`

```text
problem_instance_target_bindings
  id
  rule_set_id
  problem_instance_id
  target_definition_id
  entity_id
  position
  UNIQUE (problem_instance_id, target_definition_id, entity_id)
  UNIQUE (problem_instance_id, target_definition_id, position)
```

The target definition must belong to the instance's problem definition. The
bound entity must belong to the same ruleset and implement every owner schema
required by the target. Each target's row count must satisfy its minimum and
maximum.

The automatically created `problem-instance` binding points back to the
instance's own `entity_id`. All other bindings are supplied explicitly. One
entity may occupy several targets, and a many-valued target may bind any number
of distinct eligible entities within its configured bounds.

Bindings identify a transition context; they do not imply ownership,
containment, proximity, or any other world relationship. Those meanings come
from authored target definitions or future explicit world models.

## Availability and resolution semantics

Availability answers whether an action may be selected. Resolution determines
which outcome occurs after an available action is selected. They are not
interchangeable.

A problem is available only when its optional problem-level condition
invocation is met. A choice is available only when both problem and choice
availability invocations are met. Unmet means unavailable. Unknown means
required state is incomplete. Neither result applies effects.

An automatic choice selects its sole outcome. A conditional choice evaluates
its resolution invocation. Met selects the met outcome; unmet selects the unmet
outcome; unknown stops as incomplete and applies neither.

Resolution uses the instance's current target bindings to map condition
parameters and effects to concrete entities. It reads a consistent bounded
snapshot containing every state record needed by availability, resolution, and
the selected consequence set. Applying the consequence locks and updates every
affected record atomically. The transition has no distinguished actor or state
owner.

Invalid definitions, invalid bindings, invalid persisted state, binding or state
revision conflicts, and effect application failures are errors rather than
resolution statuses.

## Non-normative example

This example illustrates configuration only. None of its keys or concepts are
part of the data model.

A ruleset could define three owner schemas:

```text
control
barrier
area
```

It could define Boolean state variables `powered`, `open`, and `alarm`, each
attached to the appropriate owner schema. A problem definition could declare
three singular supplied targets named `control`, `barrier`, and `area`.

A reusable condition set could declare one parameter requiring the `control`
schema and test whether `powered` is true. Its invocation within the problem
would map that parameter to the problem's `control` target.

One problem instance could then bind its targets to three concrete world
entities. A conditional choice could set `open` on the bound barrier and set
`alarm` on the bound area when the powered condition is met. Those two state
records would update in one transaction. Another instance of the same problem
could bind entirely different entities without changing the authored condition
or effects.

## Validation requirements

### Owner schemas and entities

- IDs and owner-schema keys are non-empty and unique in their scopes.
- Entity keys, when present, are non-empty and unique within the ruleset.
- Labels and entity display names are non-empty.
- Memberships reference entities and schemas in the same ruleset.
- Archived schemas cannot receive new memberships or definition references.
- Used schemas cannot be deleted or repurposed in place.
- Removing a membership cannot invalidate existing state or active bindings.

### State-variable definitions

- IDs and ruleset-scoped keys are non-empty and unique.
- Keys use a stable namespaced format.
- Labels are non-empty.
- Kinds, cardinalities, missing semantics, and controls are supported.
- Every definition has at least one owner schema in the same ruleset.
- Numeric and measurement bounds are finite and ordered.
- Steps are finite and greater than zero.
- Measurement schemas declare at least one unique unit.
- Choice keys are non-empty and unique within the variable.
- Reference target schemas, when present, belong to the same ruleset.
- Default rows match kind and cardinality.
- `omit_default_when_stored` is allowed only with a default.
- Many-valued defaults have no normalized duplicates.
- Allowed effect operations are compatible with schema and cardinality.
- Referenced definitions cannot be deleted.
- Used semantic schemas cannot change in place.

### State records

- The owner entity exists in the same ruleset.
- Every value references a definition for that ruleset.
- The entity implements at least one owner schema allowed by the definition.
- Every value kind and cardinality agrees with its definition.
- Numbers and measurements are finite and satisfy bounds and steps.
- Choice values reference current options belonging to their variable.
- Reference targets exist in the same ruleset and satisfy configured target
  schema restrictions.
- Many-valued collections have no normalized duplicates.
- Values equal to omitted defaults are normalized out.
- Writes supply the expected current revision.

### Condition sets

- IDs and ruleset-scoped keys are unique and non-empty.
- Names and parameter labels are non-empty.
- Parameter keys and positions are unique within the set.
- Every parameter has at least one required owner schema.
- Expression IDs are unique within the tree.
- The tree has exactly one root and no cycles or disconnected nodes.
- Every group has at least one child.
- Every group `at-least` count is valid for its child count.
- Criteria reference condition-addressable variables in the same ruleset.
- Criterion parameters belong to the same condition set.
- Each criterion variable allows at least one schema required by its parameter.
- Criterion quantifiers agree with parameter cardinality.
- Criterion `at-least` counts are positive.
- Predicate kind and operator match the variable schema.
- Operands are normalized and valid for the variable.
- Archived variables and schemas cannot receive new references.
- The tree has a maximum depth of 10 and maximum total node count of 250.

### Problem targets and condition invocations

- Target IDs, keys, and positions are unique within the problem.
- Binding bounds are valid for target cardinality.
- Every target referenced by a condition or effect has at least one required
  owner schema.
- Every singular target referenced by a condition or effect requires exactly
  one binding.
- Instance-sourced targets have exactly one binding and compatible configured
  instance schemas.
- Every invocation references a condition set and problem in the same ruleset.
- Every condition parameter is mapped exactly once.
- Invocation arguments map parameters to targets of matching cardinality.
- Each target supplies every schema required by its mapped parameter.
- A target's known maximum is not below an `at-least` count used on its mapped
  parameter.
- Each invocation is owned by exactly one condition usage site in the same
  problem.

### Effects and consequence sets

- Consequence-set and effect IDs are non-empty and unique within a problem.
- Effect positions are complete and unique within their consequence set.
- Every effect references a target and variable in the same problem and ruleset.
- The target's required schemas guarantee eligibility for the variable.
- Operations are enabled by their variables and structurally compatible.
- Literal values and amounts are normalized, finite, and schema-valid.
- Newly authored effects cannot reference archived variables or schemas.
- Consequence sets may be empty.

### Problem definitions and instances

- IDs and ruleset-scoped keys are unique and non-empty.
- Names are non-empty.
- Every problem has at least one choice.
- Choice IDs and keys are unique within the problem.
- Outcome, consequence-set, and effect IDs are unique within the problem.
- Positions are unique and non-negative.
- Referenced condition invocations are valid and belong to the same problem.
- Every choice has exactly one valid resolution shape.
- Conditional choices explicitly define met and unmet outcomes, even when an
  outcome has no effects.
- Existing instances prevent definition deletion.
- Archived definitions cannot create instances.
- Instance bindings use targets from the instance's definition.
- Bound entities are in the same ruleset and satisfy target schemas.
- Binding counts satisfy target bounds.
- Binding writes supply the expected current binding revision.

### Runtime resolution

- The instance references the requested problem definition.
- The choice belongs to that definition.
- Target bindings are complete, current, and valid.
- Every entity state record reached through a condition or effect is
  schema-valid.
- Evaluation uses one consistent binding and world-state snapshot.
- Availability is reevaluated by the server.
- Every effect remains valid for every selected entity when reached in ordered
  application.
- Resulting values satisfy their definitions and owner eligibility.
- Expected binding and state revisions still match at commit.
- Any failure aborts every state update.

## Deletion, mutation, and usage rules

Normalized foreign keys provide direct usage information:

- variable owner-schema rows identify schema applicability;
- condition criteria directly identify state-variable and parameter usage;
- invocation arguments directly identify condition-to-target mappings;
- effects directly identify target and state-variable usage;
- problem and choice condition FKs directly identify invocation usage; and
- problem-instance bindings directly identify target and entity usage.

Usage screens query these relations. They are never separately editable.

Saving a condition set or problem replaces its owned relational aggregate in a
transaction while preserving supplied stable IDs. Runtime bindings and state
rows are updated in place. No transition table is required initially.

If receipts or historical reconstruction are added later, a receipt would need
the problem, instance, binding set, choice, outcome, effects, concrete target
entities, and before/after values. Exact historical reconstruction would
additionally require immutable configuration revisions; that remains explicitly
outside the initial system.

## Deferred extensions

The model leaves room for:

- derived state and dependency graphs;
- transition receipts, audit history, provenance, and event sourcing;
- versioned or published configuration;
- automatic target discovery and world queries;
- spatial, containment, ownership, and other explicit world relationships;
- target selectors whose results are resolved at transition time;
- reusable parameterized consequence sets;
- ordered first-match outcome cases;
- multiple independent all-matching rules;
- dice and random outcomes;
- state-variable-to-state-variable comparisons;
- text, reference, measurement, and many-valued state predicates;
- structured objects and ordered-list schemas;
- owner-schema inheritance or implication rules;
- effects that add or remove owner-schema membership;
- effects that create or archive entities or problem instances;
- narrative or external consequences;
- per-problem overrides of shared condition sets; and
- concurrent configuration editing.

Each extension must introduce explicit domain semantics and relational storage.
It must not enter through privileged configured keys, arbitrary operator
strings, JSON patches, JSONB documents, or executable expressions.

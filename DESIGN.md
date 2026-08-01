# Stateful Rule Composer Design

## Summary

The system is a configuration and resolution surface for typed state,
conditions over that state, choices offered by problems, and consequences that
change state.

A rules author defines a vocabulary of typed state variables, such as Strength,
Athletics, Current Health, Inventory Items, and Problem Resolved. Current values
for those variables are maintained on participants and problem instances.
Conditions inspect a consistent snapshot of those values. Problems offer
choices whose availability and resolution may depend on conditions. Resolving a
choice applies an ordered set of state effects atomically.

The central relationship is:

```text
State Variable Definitions
       |                    \
       v                     v
Current State <- Effects   Conditions
       |                     |
       +----> Problem -> Choice
                         | availability condition
                         | resolution condition
                         | met consequences
                         | unmet consequences
                         v
                    Updated State
```

This is a small typed state-transition system. A state snapshot is simply a
current assignment of typed values. It is not a dependency graph. Derived
values, formulas, provenance, and retained history may be added later without
changing the basic relationship among state, conditions, and effects.

Definitions and current state are mutable. There is no versioning, publication
lifecycle, event log, or historical snapshot store in the initial design.
Editing a shared condition set or problem definition changes future evaluation
and resolution immediately. Applying consequences updates current state in
place.

## Problem Statement

A rules author needs to express both facts about the current world and what may
happen next. Examples include:

- A participant has Strength `16` and Athletics `true`.
- A participant currently has `10` health.
- A participant's inventory currently contains a particular item.
- A problem remains unresolved.
- A participant must have Strength of at least `14` to satisfy a condition.
- A choice is available only while the problem remains unresolved.
- Choosing to force open a reliquary succeeds when Strength is at least `14`.
- Success adds the idol to inventory and resolves the problem.
- Failure reduces current health.

These statements must be represented as typed data rather than prose or
application-specific conditional code. The representation must support:

- a configuration UI driven by state-variable metadata;
- maintained current state for participants and problem instances;
- validation before definitions, conditions, problems, or state are saved;
- deterministic, three-valued condition evaluation;
- an explanation of why a condition was met, unmet, or unknown;
- reusable condition sets shared by multiple problems and choices;
- explicit choice availability and resolution semantics;
- typed, deterministic state effects;
- atomic application of every consequence in a selected outcome;
- clear extension points for derived state and transition history without
  requiring either initially.

## Core Model

The underlying concepts are deliberately small:

```text
State variable   a declared location that may hold a typed value
State            the current values at declared locations
Condition        a read-only query over a state snapshot
Effect           a typed operation that changes state
Choice           an action selected in the context of a problem
Outcome          the branch selected by resolving a choice
Transition       the atomic application of an outcome's effects
```

Conceptually, current state is a partial mapping:

```text
State: (target, stateVariableId) -> typed value
```

A condition evaluates that mapping:

```text
Condition: State -> met | unmet | unknown
```

An effect transforms it:

```text
Effect: State -> State | application error
```

Resolving a choice selects an outcome and applies all of its effects:

```text
resolve(current state, chosen choice) -> outcome + updated state
```

The persisted state record is updated in place. `current state` and `updated
state` describe the before and after values of one transaction; they do not
imply that historical copies are retained.

## Goals

- Define a stable, configurable vocabulary of state variables.
- Keep state values meaningfully typed.
- Distinguish variable classification from value type. A capacity is not
  inherently numeric, and a capability is not inherently Boolean, even though
  the initial catalog uses those pairings.
- Represent current participant and problem-instance state explicitly.
- Treat a snapshot as a consistent read of current state rather than as a
  historical artifact.
- Compose conditions with explicit `all`, `any`, and `at-least` groups.
- Ensure that a variable's value schema determines which predicates and effects
  are valid.
- Distinguish a condition that gates availability from one that selects a
  resolution outcome.
- Allow both met and unmet resolution outcomes to have consequences.
- Apply an outcome's effects in a deterministic order and commit them
  atomically.
- Represent definitions, conditions, choices, and effects as storage-neutral,
  JSON-compatible data.
- Give expression nodes, choices, outcomes, and effects stable identities for
  editing and explanations.
- Treat state-variable definitions, condition sets, and problem definitions as
  directly mutable configuration.
- Preserve the participant field inventory and typed-value direction described
  in this document.

## Non-goals

- A complete character or participant creation workflow.
- Dice rolls, random outcomes, checks, modifiers, or difficulty classes.
- Derived state, formulas, or dependency graphs.
- State history, provenance, event sourcing, replay, or historical snapshots.
- Drafts, publishing, or versioned rule definitions.
- Arbitrary executable expressions or user-provided scripts.
- Comparing one state variable to another.
- Party-wide or team-composition conditions.
- Assigning participants to roles.
- Multiple participants or arbitrary target bindings in one resolution.
- A complete item, equipment, encumbrance, currency, or economy model.
- Structured inventory stacks with quantities and per-entry metadata.
- External consequences such as sending messages or invoking third-party
  services.
- Concurrent configuration editing.

## Terminology

### State variable definition

Describes one addressable piece of state: its stable identity, owner type,
label, classification, value schema, cardinality, missing-value semantics, and
allowed rule operations.

Examples are Strength, Athletics, Current Health, Inventory Items, Character
Name, and Problem Resolved.

### State value

A typed value stored for one state variable on one state owner, such as
Strength `16`, Athletics `true`, or a reference to an inventory item.

### State record

The maintained current values for one state owner. Initially, state owners are
participants and problem instances.

### State snapshot

A consistent, read-only view of the state records used during one evaluation or
resolution. The initial system does not retain snapshots after the operation.

### Condition

A read-only expression over state that evaluates to `met`, `unmet`, or
`unknown`.

### Requirement

A condition used as a prerequisite or qualification. Requirement is a role a
condition plays, not a separate underlying expression model.

### Condition set

A named, reusable condition expression. Problem and choice definitions
reference condition sets for availability and resolution.

### Effect

One typed state operation, such as setting a value, adjusting a number, or
adding a member to a many-valued variable.

### Consequence set

An ordered list of effects associated with one outcome. The complete list is
applied atomically.

### Choice

An action made available by a problem. A choice may have an availability
condition and either an automatic or condition-based resolution.

### Outcome

The branch selected when a choice resolves. A condition-based choice has a
`met` outcome and an `unmet` outcome. Either may have consequences.

### Transition

The atomic operation that reads current state, resolves a chosen outcome,
applies its consequence set, and writes updated current state.

### Problem definition

Authored configuration describing a problem and the choices it offers.

### Problem instance

One occurrence of a problem definition. It provides the problem state used
during resolution and prevents runtime state from being stored on reusable
configuration.

## State Model

### State targets and addresses

The initial resolver operates with exactly two bound state targets:

```ts
type StateTarget = "participant" | "problem";
type StateOwnerType = "participant" | "problem-instance";

type StateAddress = {
  target: StateTarget;
  stateVariableId: string;
};
```

During resolution, `participant` refers to the selected participant and
`problem` refers to the current problem instance. A state variable definition
declares which owner type may store it. Validation ensures that a target and
variable agree: `participant` variables belong to participant state, while
`problem` variables belong to problem-instance state.

This explicit target keeps the initial model understandable while leaving room
for later bindings such as a second participant, an item, a location, or a
party.

### Value schemas and typed values

```ts
type ChoiceOption = {
  key: string;
  label: string;
};

type ValueSchema =
  | {
      kind: "text";
    }
  | {
      kind: "choice";
      options: ChoiceOption[];
    }
  | {
      kind: "measurement";
      units: string[];
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
  | {
      kind: "boolean";
    }
  | {
      kind: "reference";
      entityType: string;
    }
  | {
      kind: "relationship";
      entityType: string;
    };

type StateScalarValue =
  | { kind: "text"; value: string }
  | { kind: "choice"; value: string }
  | { kind: "measurement"; amount: number; unit: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; entityId: string; fallbackName?: string }
  | {
      kind: "relationship";
      entityId: string;
      relationship?: string;
      fallbackName?: string;
    };

type StateValue = StateScalarValue | StateScalarValue[];

type MissingValueSemantics =
  | {
      kind: "unknown";
    }
  | {
      kind: "default";
      value: StateValue;
      omitWhenStored: boolean;
    };
```

The value schema governs valid data. A default describes the logical value of
an omitted stored entry. It is not a derived value.

Examples include:

- an omitted capability defaults to Boolean `false` and may be omitted from
  storage;
- an omitted inventory defaults to an empty array and may be omitted from
  storage;
- an omitted Current Health value is `unknown` rather than implicitly zero.

For `cardinality: "many"`, values are serialized as arrays but initially have
set semantics. Normalized duplicate values are invalid. Ordered lists and
multisets require separate future schemas rather than implicit array behavior.

### State variable definitions

```ts
type StateVariableCategory =
  | "identity"
  | "personality"
  | "appearance"
  | "story"
  | "connection"
  | "capacity"
  | "capability"
  | "status"
  | "inventory"
  | "problem";

type StateEffectOperation =
  | "set"
  | "clear"
  | "adjust-number"
  | "add-value"
  | "remove-value";

type StateVariableDefinition = {
  id: string;
  key: string;
  label: string;
  description?: string;
  ownerType: StateOwnerType;
  category: StateVariableCategory;
  section: string;
  cardinality: "one" | "many";
  valueSchema: ValueSchema;
  missingValue: MissingValueSemantics;
  presentation?: StateVariablePresentation;
  conditionAddressable: boolean;
  allowedEffectOperations: StateEffectOperation[];
  displayOrder: number;
  archived: boolean;
};

type StateVariablePresentation = {
  control?:
    | "short-text"
    | "long-text"
    | "select"
    | "measurement"
    | "number"
    | "checkbox"
    | "reference-picker"
    | "relationship-editor";
  helpText?: string;
};
```

`id` is the durable reference used by state records, conditions, and effects.
`key` is a human-readable, globally unique identifier such as
`capacity.strength` or `status.health-current`. Neither is derived from the
label.

Labels, descriptions, presentation hints, and display order may change without
changing the meaning of existing state or rules. Once a definition is used by
stored state, a condition, or an effect, its owner type, value schema,
cardinality, missing-value semantics, and semantic meaning must not change in
place. A semantically different variable receives a new `id` and `key`.

`conditionAddressable` determines whether the condition composer may read a
variable. `allowedEffectOperations` determines which operations the consequence
editor may author against it. These controls are independent. Inventory may be
writable before reference predicates are supported, while descriptive identity
fields may be neither condition-addressable nor writable by problem
consequences.

An archived definition remains readable by existing state and definitions but
is unavailable for new condition criteria or effects.

### Current state records

```ts
type StateRecord = {
  ownerType: StateOwnerType;
  ownerId: string;
  revision: number;
  values: Record<string, StateValue>;
  updatedAt: string;
};

type ResolutionSnapshot = {
  participant: StateRecord;
  problem: StateRecord;
};
```

Keys in `values` are state-variable definition IDs. Every stored value must
match the referenced definition's owner type, schema, and cardinality.

`revision` is an optimistic-concurrency token, not history or provenance. A
successful update increments the revision of every changed record. Resolution
uses consistent participant and problem revisions so that concurrent changes
cannot be silently overwritten.

Missing entries are interpreted through their definitions. An omitted default
is materialized logically when evaluating conditions and applying effects but
does not need to be written. An omitted unknown value remains unknown.

## Initial State Variable Catalog

The initial catalog contains the complete participant field inventory plus
explicit status, inventory, and problem state. Categories organize the authoring
surface; they do not determine value type.

Only capacities, capabilities, Current Health, and Problem Resolved are
initially available to the condition composer. Inventory supports the effects
needed by choice resolution before reference predicates are introduced. Other
fields remain in the same state vocabulary so descriptive participant data does
not become a separate, incompatible model.

### Identity

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `identity.character-name` | Character Name | text, short-text control | one | no | none |
| `identity.player-name` | Player Name | text, short-text control | one | no | none |
| `identity.race` | Race | choice | one | no | none |
| `identity.background` | Background | choice | one | no | none |
| `identity.alignment` | Alignment | choice | one | no | none |

The actual options for Race, Background, and Alignment belong to catalog
configuration rather than hard-coded application logic.

### Personality

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `personality.traits` | Personality Traits | text, long-text control | many | no | none |
| `personality.ideals` | Ideals | text, long-text control | many | no | none |
| `personality.bonds` | Bonds | text, long-text control | many | no | none |
| `personality.flaws` | Flaws | text, long-text control | many | no | none |

### Appearance

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `appearance.age` | Age | number, years | one | no | none |
| `appearance.height` | Height | measurement | one | no | none |
| `appearance.weight` | Weight | measurement | one | no | none |
| `appearance.eyes` | Eyes | text, short-text control | one | no | none |
| `appearance.skin` | Skin | text, short-text control | one | no | none |
| `appearance.hair` | Hair | text, short-text control | one | no | none |

### Story

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `story.backstory` | Character Backstory | text, long-text control | one | no | none |

### Connections

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `connections.allies` | Allies | relationship to participant or named entity | many | no | none |
| `connections.organizations` | Organizations | relationship to organization | many | no | none |

`organization.name` ("Organization Name") belongs to the referenced
organization rather than being duplicated as participant state. When no durable
organization entity exists, the relationship's `fallbackName` preserves the
name.

### Capacities

Capacities are numeric, single-valued, condition-addressable participant state:

| Key | Label | Effects |
| --- | --- | --- |
| `capacity.strength` | Strength | `set`, `adjust-number` |
| `capacity.dexterity` | Dexterity | `set`, `adjust-number` |
| `capacity.constitution` | Constitution | `set`, `adjust-number` |
| `capacity.intelligence` | Intelligence | `set`, `adjust-number` |
| `capacity.wisdom` | Wisdom | `set`, `adjust-number` |
| `capacity.charisma` | Charisma | `set`, `adjust-number` |

The initial catalog must choose numeric bounds and step for capacities.
Condition operands and resulting effect values must respect those bounds.

### Capabilities

Capabilities are Boolean, single-valued, condition-addressable participant
state:

| Key | Label |
| --- | --- |
| `capability.acrobatics` | Acrobatics |
| `capability.animal-handling` | Animal Handling |
| `capability.arcana` | Arcana |
| `capability.athletics` | Athletics |
| `capability.deception` | Deception |
| `capability.history` | History |
| `capability.insight` | Insight |
| `capability.intimidation` | Intimidation |
| `capability.investigation` | Investigation |
| `capability.medicine` | Medicine |
| `capability.nature` | Nature |
| `capability.perception` | Perception |
| `capability.performance` | Performance |
| `capability.persuasion` | Persuasion |
| `capability.religion` | Religion |
| `capability.sleight-of-hand` | Sleight of Hand |
| `capability.stealth` | Stealth |
| `capability.survival` | Survival |

Capabilities default to Boolean `false`, use `omitWhenStored: true`, and allow
the `set` effect. Omission therefore means that a participant does not have the
capability; it does not mean that the value is unknown.

### Status

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `status.health-current` | Current Health | number | one | yes | `set`, `adjust-number` |

Current Health has `missingValue: { kind: "unknown" }`. Its catalog definition
must declare any universal minimum, maximum, and step. There is no implicit
clamping when an effect exceeds those bounds; the transition fails atomically.
Domain-specific health rules such as a participant-specific maximum or death
threshold are deferred because they require cross-variable invariants or
derived state.

### Inventory

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `inventory.items` | Inventory Items | reference to item | many | no | `set`, `add-value`, `remove-value` |

Inventory Items defaults to an empty array and may be omitted from storage. The
initial inventory is a set of references to durable item entities. Quantities,
stacking, equipped state, per-item condition, currency, and encumbrance require
a richer item or inventory-entry model and are deliberately deferred.

Reference predicates are not initially defined, so inventory may be changed by
effects before it can be inspected by authored conditions. Adding deliberate
reference-membership predicates later does not require changing the state
representation.

### Problem state

| Key | Label | Schema | Cardinality | Conditions | Effects |
| --- | --- | --- | --- | --- | --- |
| `problem.resolved` | Problem Resolved | boolean | one | yes | `set` |

Problem Resolved belongs to `problem-instance` state, defaults to Boolean
`false`, and may be omitted from storage. A problem definition can use the
condition `Problem Resolved is false` as an availability guard and set it to
`true` in a terminal outcome.

## Condition Model

A condition is the underlying read model. A requirement is a condition used in
a prerequisite role; availability checks and resolution tests use exactly the
same expression representation.

```ts
type ExpressionId = string;

type ConditionExpression =
  | {
      id: ExpressionId;
      type: "all";
      children: ConditionExpression[];
    }
  | {
      id: ExpressionId;
      type: "any";
      children: ConditionExpression[];
    }
  | {
      id: ExpressionId;
      type: "at-least";
      count: number;
      children: ConditionExpression[];
    }
  | {
      id: ExpressionId;
      type: "criterion";
      target: StateTarget;
      stateVariableId: string;
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
  createdAt: string;
  updatedAt: string;
};
```

Expression IDs are opaque UUIDs or equivalent stable identifiers. They are
preserved when a node is moved or edited. They give the composer stable keys
and allow evaluation results to identify the exact node that produced a
result.

Condition sets are mutable and reusable. Editing a set changes every problem
and choice that references it. The configuration surface must show those uses
before a set is edited or archived.

### Group semantics

`all` requires every child to be met.

`any` requires at least one child to be met.

`at-least` requires at least `count` children to be met. This expresses rules
such as "at least two of Arcana, History, and Religion."

Groups must have at least one child. An `at-least` count must be an integer from
`1` through the number of children.

Arbitrary negation is excluded. A Boolean criterion can express a false value,
but negating an entire group would make missing-data semantics difficult to
understand.

### Predicate semantics

| State-variable schema | Allowed predicates |
| --- | --- |
| number | `eq`, `gt`, `gte`, `lt`, `lte`, `between` |
| boolean | `is true`, `is false` |
| choice | `is`, `one-of` |

The initial design does not expose text, measurement, reference, relationship,
or many-valued predicates. Those state values remain typed and writable when
their definitions allow effects. They can become condition-addressable after
deliberate predicate semantics are introduced.

All number operands must be finite. A range is inclusive and must satisfy
`minimum <= maximum`. Number operands must respect the bounds declared by the
state-variable definition.

Choice operands must reference keys currently declared by the variable's
choice schema. A `one-of` predicate must contain at least one unique choice.

### Condition evaluation

Evaluation returns more than a Boolean so that incomplete state is not confused
with state that definitively does not satisfy a condition.

```ts
type ConditionStatus = "met" | "unmet" | "unknown";

type ConditionEvaluationNode = {
  expressionId: ExpressionId;
  status: ConditionStatus;
  message: string;
  address?: StateAddress;
  actual?: StateValue;
  children?: ConditionEvaluationNode[];
};

type MissingStateValue = StateAddress;

type ConditionEvaluation = {
  conditionSetId: string;
  status: ConditionStatus;
  root: ConditionEvaluationNode;
  missingValues: MissingStateValue[];
};
```

Criterion evaluation follows these rules:

- A valid logical value satisfying the predicate is `met`.
- A valid logical value not satisfying the predicate is `unmet`.
- A missing value with `missingValue.kind: "unknown"` is `unknown`.
- A missing value with a declared default is evaluated using that default.
- A stored value with the wrong kind or cardinality is invalid state.
  Evaluation reports an input error rather than turning it into `unknown`.

Group evaluation follows three-valued logic.

`all`:

- `unmet` if any child is unmet;
- `met` if every child is met;
- otherwise `unknown`.

`any`:

- `met` if any child is met;
- `unmet` if every child is unmet;
- otherwise `unknown`.

`at-least N`:

- `met` when at least `N` children are met;
- `unmet` when the number of met plus unknown children is less than `N`;
- otherwise `unknown`.

Evaluation messages are derived from current labels and expression data. They
are not stored as canonical rule text. Examples include:

```text
Strength 16 satisfies Strength >= 14.
Athletics is false and does not satisfy Has Athletics.
Current Health is required but has not been provided.
The problem is already resolved.
One of Athletics or Acrobatics is required.
```

## Consequence and Effect Model

A consequence set is an ordered list of typed state effects. The initial system
supports state changes as the only executable consequence kind.

```ts
type EffectId = string;

type StateEffect =
  | {
      id: EffectId;
      type: "set";
      target: StateTarget;
      stateVariableId: string;
      value: StateValue;
    }
  | {
      id: EffectId;
      type: "clear";
      target: StateTarget;
      stateVariableId: string;
    }
  | {
      id: EffectId;
      type: "adjust-number";
      target: StateTarget;
      stateVariableId: string;
      amount: number;
    }
  | {
      id: EffectId;
      type: "add-value";
      target: StateTarget;
      stateVariableId: string;
      value: StateScalarValue;
    }
  | {
      id: EffectId;
      type: "remove-value";
      target: StateTarget;
      stateVariableId: string;
      value: StateScalarValue;
    };

type ConsequenceSet = {
  id: string;
  effects: StateEffect[];
};
```

Effect IDs remain stable when effects are reordered or edited. They support
stable editor keys and applied-effect explanations.

The operations have explicit semantics:

- `set` replaces the complete logical value. For a many-valued variable, its
  operand is the complete normalized collection.
- `clear` removes the stored entry. The resulting logical value is the
  variable's declared default or `unknown`.
- `adjust-number` adds a finite amount to a single-valued number. The existing
  logical value must be known and the result must satisfy the numeric schema.
- `add-value` adds one normalized value to a many-valued collection. Adding a
  value already present is an idempotent no-op.
- `remove-value` removes one normalized value from a many-valued collection.
  Removing a value not present is an idempotent no-op.

Effects execute in declared order against a working copy of state. Later
effects observe the results of earlier effects. This makes multiple numeric
adjustments or an explicit set followed by an adjustment deterministic.

Every effect must be enabled by the target variable's
`allowedEffectOperations`. Operator compatibility is also structural:

| Operation | Required variable shape |
| --- | --- |
| `set` | any supported schema and matching cardinality |
| `clear` | any supported schema |
| `adjust-number` | number, cardinality `one` |
| `add-value` | any supported scalar schema, cardinality `many` |
| `remove-value` | any supported scalar schema, cardinality `many` |

An effect may be structurally valid when authored but invalid against runtime
state. For example, adjusting an unknown number or exceeding a numeric bound is
an application error. If any effect fails, no effect in the consequence set is
committed. An effect application error is not reinterpreted as an unmet choice
condition.

Consequence sets are embedded in outcomes initially. Named, reusable
consequence sets can be added if real reuse appears; introducing them now would
add shared-mutation behavior without demonstrated value.

## Problems, Choices, and Outcomes

### Definitions and instances

Problem configuration is separate from runtime problem state:

```ts
type ProblemDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  availableWhenConditionSetId?: string;
  choices: ChoiceDefinition[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProblemInstance = {
  id: string;
  problemDefinitionId: string;
  createdAt: string;
  updatedAt: string;
};
```

Each problem instance has a corresponding `problem-instance` state record. A
definition may therefore be reused without sharing runtime state among its
occurrences.

Problem definitions are mutable. Editing one changes future availability and
resolution for all of its instances. Existing current state is not recalculated
or reversed.

### Choice definitions

```ts
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
      conditionSetId: string;
      met: ChoiceOutcome;
      unmet: ChoiceOutcome;
    };

type ChoiceDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  availableWhenConditionSetId?: string;
  resolution: ChoiceResolution;
};
```

The initial model gives each condition-based choice one resolution condition
with explicit met and unmet outcomes. This is the smallest form of a guarded
transition and directly represents a requirement-consequence pair with an
optional failure consequence.

Multiple ordered outcome conditions, all-matching production rules, and random
outcomes are excluded initially because each requires additional conflict and
selection semantics. They can be introduced later without changing the state
or effect models.

### Availability is not resolution

Availability conditions answer whether a participant may select a problem or
choice. Resolution conditions answer which outcome occurs after an available
choice is selected.

This distinction is required for failure consequences:

- If `Strength >= 14` is an availability condition, a weaker participant
  cannot select the choice and cannot experience its failure consequence.
- If `Strength >= 14` is a resolution condition, any participant for whom the
  choice is otherwise available may select it. The condition determines whether
  the met or unmet outcome occurs.

A problem is available only when its `availableWhenConditionSetId`, if present,
is `met`. A choice is available only when both its problem-level and
choice-level availability conditions are `met`.

An `unmet` availability result means the action is unavailable. An `unknown`
availability result means required state is incomplete. Neither result applies
consequences.

An automatic resolution selects its only outcome. A condition resolution
selects the `met` or `unmet` outcome. If its condition is `unknown`, resolution
stops without applying either branch. Missing information is not treated as
failure.

### Resolution procedure

Resolving a choice performs these steps:

1. Load the problem definition, problem instance, choice, condition sets, and
   referenced state-variable definitions.
2. Read consistent participant and problem state records.
3. Validate both state records against their definitions.
4. Evaluate the problem and choice availability conditions.
5. Stop without effects if either condition is `unmet` or `unknown`.
6. Select the automatic outcome or evaluate the resolution condition.
7. Stop without effects if the resolution condition is `unknown`.
8. Apply the selected outcome's effects in order to working copies of the state
   records.
9. Abort without writes if any effect is invalid against runtime state.
10. Commit every changed state record atomically, conditional on the revisions
    read in step 2.
11. Return the selected outcome, condition explanations, applied-effect
    explanations, and updated current state.

The server is authoritative. A client may preview a resolution, but it cannot
submit its own selected outcome or calculated state changes to the commit
endpoint.

```ts
type AppliedEffect = {
  effectId: EffectId;
  address: StateAddress;
  before?: StateValue;
  after?: StateValue;
  changed: boolean;
};

type ChoiceResolutionResult =
  | {
      status: "applied";
      problemDefinitionId: string;
      problemInstanceId: string;
      choiceId: string;
      outcomeId: string;
      availabilityEvaluations: ConditionEvaluation[];
      resolutionEvaluation?: ConditionEvaluation;
      appliedEffects: AppliedEffect[];
      state: ResolutionSnapshot;
    }
  | {
      status: "unavailable";
      problemDefinitionId: string;
      problemInstanceId: string;
      choiceId: string;
      availabilityEvaluations: ConditionEvaluation[];
    }
  | {
      status: "incomplete";
      problemDefinitionId: string;
      problemInstanceId: string;
      choiceId: string;
      evaluations: ConditionEvaluation[];
    };
```

Invalid definitions, invalid stored state, revision conflicts, and effect
application failures are errors rather than choice-resolution statuses.

## Example

Consider a problem called **The Trapped Reliquary**. One of its choices lets a
participant try to lift the idol carefully.

The relevant current state is:

```text
Participant:
  Dexterity = 12
  Sleight of Hand = true
  Strength = 11
  Current Health = 10
  Inventory Items = []

Problem instance:
  Problem Resolved = false
```

The reusable condition set for taking the idol carefully is:

```json
{
  "id": "condition-careful-idol",
  "key": "careful-idol",
  "name": "Can take the idol carefully",
  "archived": false,
  "createdAt": "2026-08-01T00:00:00Z",
  "updatedAt": "2026-08-01T00:00:00Z",
  "root": {
    "id": "expr-careful-root",
    "type": "any",
    "children": [
      {
        "id": "expr-careful-dexterity",
        "type": "criterion",
        "target": "participant",
        "stateVariableId": "state-dexterity",
        "predicate": {
          "kind": "number",
          "operator": "gte",
          "value": 14
        }
      },
      {
        "id": "expr-careful-sleight",
        "type": "criterion",
        "target": "participant",
        "stateVariableId": "state-sleight-of-hand",
        "predicate": {
          "kind": "boolean",
          "operator": "is",
          "value": true
        }
      }
    ]
  }
}
```

A second condition set, `condition-problem-unresolved`, contains the criterion
`Problem Resolved is false`. The problem uses it as an availability condition.

Its important choice data is:

```json
{
  "id": "problem-trapped-reliquary",
  "key": "trapped-reliquary",
  "name": "The Trapped Reliquary",
  "availableWhenConditionSetId": "condition-problem-unresolved",
  "archived": false,
  "createdAt": "2026-08-01T00:00:00Z",
  "updatedAt": "2026-08-01T00:00:00Z",
  "choices": [
    {
      "id": "choice-take-carefully",
      "key": "take-carefully",
      "name": "Lift the idol carefully",
      "resolution": {
        "type": "condition",
        "conditionSetId": "condition-careful-idol",
        "met": {
          "id": "outcome-careful-met",
          "label": "The idol is lifted safely",
          "consequences": {
            "id": "consequences-careful-met",
            "effects": [
              {
                "id": "effect-add-idol",
                "type": "add-value",
                "target": "participant",
                "stateVariableId": "state-inventory-items",
                "value": {
                  "kind": "reference",
                  "entityId": "item-ancient-idol"
                }
              },
              {
                "id": "effect-resolve-careful",
                "type": "set",
                "target": "problem",
                "stateVariableId": "state-problem-resolved",
                "value": {
                  "kind": "boolean",
                  "value": true
                }
              }
            ]
          }
        },
        "unmet": {
          "id": "outcome-careful-unmet",
          "label": "The trap is triggered",
          "consequences": {
            "id": "consequences-careful-unmet",
            "effects": [
              {
                "id": "effect-careful-damage",
                "type": "adjust-number",
                "target": "participant",
                "stateVariableId": "state-health-current",
                "amount": -2
              }
            ]
          }
        }
      }
    }
  ]
}
```

The composer should render this approximately as:

```text
THE TRAPPED RELIQUARY
Available when:
  Problem Resolved is false

Choice: Lift the idol carefully
When chosen, test:
  ANY of:
    Dexterity is at least 14
    Has Sleight of Hand

If met:
  Add Ancient Idol to Inventory Items
  Set Problem Resolved to true

If unmet:
  Reduce Current Health by 2
```

For the example participant, the stored Sleight of Hand value is `true`, so the
condition is met. The resolver adds the idol and marks the problem instance
resolved in one transaction. If either write fails, neither change is
committed.

Human-readable text is derived from current labels and canonical data. It is
not stored as the rule itself.

## Validation

Validation occurs whenever a state-variable definition, state record,
condition set, problem definition, or problem instance is saved. Choice
resolution performs additional runtime validation. Server-side validation is
authoritative even if the client prevents most invalid states.

### State-variable validation

- IDs and keys are non-empty and globally unique.
- Keys use a stable namespaced format.
- Labels and sections are non-empty.
- The owner type is supported.
- Numeric and measurement bounds are finite and ordered.
- Steps are finite and greater than zero.
- Measurement schemas declare at least one unique unit.
- Choice keys are non-empty and unique within the variable.
- A default value matches the definition's schema and cardinality.
- `omitWhenStored` is present only for a declared default.
- A `many` default contains no normalized duplicates.
- Every allowed effect operation is compatible with the schema and cardinality.
- Archived definitions cannot be selected for new criteria or effects.
- A referenced definition cannot be deleted.
- The semantic schema of a definition used by state, a condition, or an effect
  cannot be changed in place.

### State-record validation

- The owner ID is non-empty and the owner exists.
- Every value references an existing definition for the record's owner type.
- Every value kind and cardinality agrees with its definition.
- Numeric and measurement values are finite and satisfy declared bounds and
  steps.
- Choice values use declared option keys.
- Reference and relationship targets have non-empty entity IDs.
- Many-valued collections contain no normalized duplicates.
- Values equal to an omitted default may be normalized out of storage.
- A write supplies the expected current revision.

### Condition-set validation

- The set ID and key are unique and non-empty.
- The name is non-empty.
- Every expression ID is non-empty and unique within the tree.
- Every group has at least one child.
- Every `at-least` count is valid for its child count.
- Every criterion references an existing condition-addressable variable.
- The criterion target agrees with the variable's owner type.
- The predicate kind matches the variable's value schema.
- The operator is allowed for that schema.
- Operands are normalized and valid for the referenced variable.
- The tree contains no unsupported node types.
- A reasonable maximum depth and node count protect the editor and evaluator
  from pathological configuration. Initial limits should be explicit
  constants, such as depth `10` and total nodes `250`.

An archived state variable or condition set remains usable by existing
references. It cannot be selected for a new reference. Saving an existing
definition without changing such a reference does not make the definition
invalid.

### Effect and consequence validation

- Every consequence-set ID and effect ID is non-empty and unique within its
  problem definition.
- Every effect references an existing state variable.
- The effect target agrees with the variable's owner type.
- The operation appears in the variable's `allowedEffectOperations`.
- The operation is structurally compatible with schema and cardinality.
- Literal values and numeric amounts are normalized, finite, and schema-valid.
- A newly authored effect cannot reference an archived variable.
- Consequence sets may be empty, allowing an explicit outcome with no state
  change.

### Problem-definition validation

- The problem ID and key are unique and non-empty.
- The name is non-empty.
- The problem declares at least one choice.
- Choice IDs and keys are non-empty and unique within the problem.
- Outcome, consequence-set, and effect IDs are unique within the problem.
- Every referenced condition set exists.
- Archived condition sets cannot be newly assigned.
- Every choice has a valid automatic or condition resolution.
- A condition resolution explicitly defines both met and unmet outcomes, even
  when one has no effects.
- Existing problem instances prevent deletion of their problem definition.
- Archived problem definitions cannot be used to create new instances.

### Runtime resolution validation

- The problem instance references the requested definition.
- The choice belongs to that definition.
- Participant and problem state records exist and are schema-valid.
- Availability and resolution evaluations use one consistent snapshot.
- Every effect remains valid against the current logical state when reached.
- Resulting values satisfy their definitions.
- All expected state revisions still match at commit time.
- A failure aborts the complete transition; partial state updates are never
  committed.

## Configuration and Resolution Surface

The surface has four related authoring areas and one runtime operation.

### State-variable catalog

The catalog lists definitions by owner type, section, and category. An author
can:

- add a state variable;
- edit its label, description, presentation, and display order;
- choose its owner type, category, cardinality, schema, and missing-value
  semantics before it is used;
- enable supported condition and effect operations;
- archive an unused or superseded variable;
- inspect which state records, condition sets, and problem effects reference
  it.

The UI must explain why a referenced definition's semantic schema cannot be
changed or deleted.

### Condition-set library

The library lists name, description, archive status, and every availability or
resolution use. An author can create, duplicate, edit, and archive sets.
Duplication is the initial mechanism when two sets should begin alike but then
diverge.

Before editing a shared set, the UI shows which problem definitions and choices
will be affected.

### Condition composer

The composer is a tree editor:

1. The author adds an `all`, `any`, or `at-least` group.
2. The author adds a criterion to a group.
3. The author chooses `participant` or `problem` state.
4. The author chooses an active condition-addressable variable for that target.
5. The value schema determines the operator menu.
6. The chosen operator determines the operand control.
7. Nodes can be reordered or moved while retaining their IDs.
8. The UI continuously renders a readable summary.
9. Save sends the complete condition set and replaces its prior expression
   atomically after validation.

For Boolean capability criteria, the UI uses natural labels such as "Has
Athletics" and "Does not have Athletics" even though the stored predicate is
the general `is true` or `is false` form.

### Problem and choice composer

An author can:

- configure problem metadata and a problem-level availability condition;
- add, reorder, duplicate, and remove choices;
- configure an optional choice-level availability condition;
- choose automatic or condition-based resolution;
- assign a condition set to a condition-based resolution;
- edit labels for met and unmet outcomes;
- add and order effects within either outcome;
- select only operations enabled by the chosen state variable;
- preview a readable transition summary;
- inspect every state variable and condition set referenced by the problem.

The editor visually separates **Available when** from **When chosen, test** so
an author cannot accidentally turn a fallible attempt into an unavailable
choice.

### State inspector

A minimal state inspector supports testing and operational correction without
becoming a participant-creation workflow. It can:

- display stored and defaulted logical values separately;
- validate a state record;
- edit current values using schema-driven controls;
- show the current revision;
- preview a condition or choice against selected participant and problem state.

### Choice resolution

The runtime surface shows available, unavailable, and incomplete choices with
derived explanations. Selecting an available choice sends its stable ID to the
server. The server reevaluates against current state, selects the outcome, and
commits its effects atomically.

A preview is advisory. State or configuration may change before commit, so the
commit response is the authoritative explanation and updated state.

## Persistence

The primary storage entities are conceptually:

```text
state_variable_definitions
state_records
condition_sets
problem_definitions
problem_instances
```

The exact database is not selected here. In a relational database:

- state-variable definitions may use ordinary columns plus JSON columns for
  `value_schema`, `missing_value`, and presentation;
- state records use a unique `(owner_type, owner_id)` key, a revision column,
  and one JSON `values` object;
- condition sets use ordinary metadata columns plus one JSON expression tree;
- problem definitions use ordinary metadata columns plus JSON choice and
  consequence data;
- problem instances reference problem definitions;
- optional derived reference relations may index state-variable and
  condition-set uses.

Useful derived relations include:

```text
condition_set_state_variable_refs
problem_condition_set_refs
problem_effect_state_variable_refs
```

These support dependency checks and usage screens. They must be rebuilt in the
same transaction that saves their canonical JSON document and must never become
independently editable sources of truth.

Normalizing every expression node, choice, outcome, or effect into its own row
is not justified initially. Each containing definition is loaded and saved as a
unit, ordering is intrinsic to JSON arrays, and evaluation occurs in application
code.

Choice resolution may update both participant and problem state. Those state
record writes must occur in one database transaction with revision checks.

No transition or event table is required. If provenance is later needed, the
resolution result already identifies the problem, choice, outcome, effects,
before values, and after values that a transition receipt would record. Exact
historical reconstruction would additionally require retaining the applicable
configuration revision; that is explicitly outside the initial design.

## API Shape

The eventual API should operate on whole configuration and state resources:

```text
GET    /state-variable-definitions
POST   /state-variable-definitions
PATCH  /state-variable-definitions/:id

GET    /state/:ownerType/:ownerId
PUT    /state/:ownerType/:ownerId

GET    /condition-sets
POST   /condition-sets
GET    /condition-sets/:id
PUT    /condition-sets/:id
POST   /condition-sets/:id/duplicate
POST   /condition-sets/:id/archive
POST   /condition-sets/:id/evaluate

GET    /problem-definitions
POST   /problem-definitions
GET    /problem-definitions/:id
PUT    /problem-definitions/:id
POST   /problem-definitions/:id/duplicate
POST   /problem-definitions/:id/archive

POST   /problem-instances
GET    /problem-instances/:id

POST   /problem-instances/:id/choices/:choiceId/preview
POST   /problem-instances/:id/choices/:choiceId/resolve
```

`PUT /state/:ownerType/:ownerId` supplies the complete current value object and
the expected revision. It is intended for explicit state maintenance, not for
committing a client-calculated choice outcome.

Condition evaluation identifies the participant and problem instance whose
state should be bound. It does not mutate either record.

Choice preview and resolution identify a participant. The problem target is
implied by the problem-instance route. Preview performs all evaluation and
effect simulation but no write. Resolution reevaluates server-side and commits
against the current revisions.

`PUT` operations replace complete configuration documents. Patch operations
against individual expression nodes, choices, or effects are unnecessary until
concurrent configuration editing becomes a demonstrated requirement.

## Deliberately Deferred Extensions

The model leaves room for these additions without requiring them now:

- derived state and dependency graphs;
- transition receipts, audit history, provenance, and event sourcing;
- versioned or published configuration for historical reconstruction;
- reusable consequence sets;
- ordered outcome cases with first-match semantics;
- multiple independent rules whose matching consequences all apply;
- dice, random outcomes, checks, modifiers, and difficulty classes;
- additional state targets and named bindings;
- role-specific conditions for multiple participants;
- collective conditions satisfied across a party;
- comparing one state variable to another;
- text, reference, relationship, measurement, and many-valued predicates;
- structured object and ordered-list value schemas;
- inventory entries with quantity, equipped state, or condition;
- participant-specific numeric bounds and cross-variable invariants;
- effects that create entities or problem instances;
- non-state consequences such as narrative output or external integrations;
- per-problem overrides of shared condition sets;
- concurrent configuration editing.

Each extension should be introduced with explicit semantics rather than through
generic operator strings, arbitrary JSON patches, or executable expressions.

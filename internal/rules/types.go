package rules

import "time"

// ID is a storage-neutral durable identifier. The application and store layers
// may use UUIDs, but the rules engine only requires a non-empty stable string.
type ID string

func (id ID) Valid() bool { return id != "" }

type ValueKind string

const (
	ValueNumber  ValueKind = "number"
	ValueBoolean ValueKind = "boolean"
)

// SourceKind identifies whether a mechanic owns writable input state or is
// calculated from other mechanics. Derived mechanics never own stored scalar
// state; their expression consumes the effective values of its references.
type SourceKind string

const (
	SourceInput   SourceKind = "input"
	SourceDerived SourceKind = "derived"
)

// ExpressionOperation is the normalized operation stored at one node in a
// recursive mechanic expression tree.
type ExpressionOperation string

const (
	ExpressionLiteral              ExpressionOperation = "literal"
	ExpressionMechanicReference    ExpressionOperation = "mechanic-reference"
	ExpressionAddNumber            ExpressionOperation = "add-number"
	ExpressionSubtractNumber       ExpressionOperation = "subtract-number"
	ExpressionMultiplyNumber       ExpressionOperation = "multiply-number"
	ExpressionMinNumber            ExpressionOperation = "min-number"
	ExpressionMaxNumber            ExpressionOperation = "max-number"
	ExpressionNegateNumber         ExpressionOperation = "negate-number"
	ExpressionAnd                  ExpressionOperation = "and"
	ExpressionOr                   ExpressionOperation = "or"
	ExpressionNot                  ExpressionOperation = "not"
	ExpressionEqual                ExpressionOperation = "equal"
	ExpressionLessNumber           ExpressionOperation = "less-than"
	ExpressionLessOrEqualNumber    ExpressionOperation = "less-than-or-equal"
	ExpressionGreaterNumber        ExpressionOperation = "greater-than"
	ExpressionGreaterOrEqualNumber ExpressionOperation = "greater-than-or-equal"
	ExpressionIf                   ExpressionOperation = "if"
)

// Expression is a recursive, tagged expression node. The operation determines
// which of Literal, MechanicID, and Operands is populated. Keeping one
// normalized shape makes dependency extraction and storage adapters mechanical.
type Expression struct {
	Operation  ExpressionOperation
	Literal    *StateValue
	MechanicID ID
	Operands   []Expression
}

type EffectOperation string

const (
	EffectSet          EffectOperation = "set"
	EffectAdjustNumber EffectOperation = "adjust-number"
	EffectApplyStatus  EffectOperation = "apply-status"
	EffectRemoveStatus EffectOperation = "remove-status"
)

type ModifierOperation string

const (
	ModifierSet            ModifierOperation = "set"
	ModifierAddNumber      ModifierOperation = "add-number"
	ModifierMultiplyNumber ModifierOperation = "multiply-number"
)

// Entity is the complete mechanical identity of a world subject. Product
// profile fields deliberately remain outside the rules engine.
type Entity struct {
	ID          ID
	WorldID     ID
	DisplayName string
	Archived    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// MechanicDefinition is a universal scalar mechanic in one world. Inputs have
// a valid default and sparse stored overrides; derived mechanics have one typed
// expression and no stored scalar value.
type MechanicDefinition struct {
	ID           ID
	WorldID      ID
	SourceKind   SourceKind
	ValueKind    ValueKind
	DefaultValue StateValue
	Expression   *Expression
	Minimum      *Decimal
	Maximum      *Decimal
	Step         *Decimal
	Mutable      bool
	Archived     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// StatusSnapshot is the mechanical portion of one inline apply-status
// consequence effect. Its ID is the source effect ID. Active instances retain
// immutable snapshots so evaluation never depends on mutable configuration.
type StatusSnapshot struct {
	ID        ID
	WorldID   ID
	Modifiers []StatusModifier
}

// StatusModifier is one deterministic literal transformation. Positions are
// complete and zero-based within one status effect. Priority orders modifiers
// across active instances; lower values execute first.
type StatusModifier struct {
	ID         ID
	Position   int
	Priority   int
	MechanicID ID
	Operation  ModifierOperation
	Value      StateValue
}

// ActiveStatus is a durable consequence-owned status instance. The internal
// SourceEffectID is the immutable source apply-effect ID, never a global
// configuration resource. AppliedOrder provides deterministic layering.
type ActiveStatus struct {
	ID             ID
	WorldID        ID
	EntityID       ID
	SourceEffectID ID
	AppliedOrder   int64
}

// StateValue is a scalar tagged union. Exactly one value pointer must be set
// according to Kind.
type StateValue struct {
	Kind    ValueKind
	Number  *Decimal
	Boolean *bool
}

type StateRecord struct {
	EntityID  ID
	Revision  int64
	Values    map[ID]StateValue
	UpdatedAt time.Time
}

type StateSnapshot struct {
	Records map[ID]StateRecord
}

type AppliedEffect struct {
	EffectID   ID
	EntityID   ID
	MechanicID ID
	Before     StateValue
	After      StateValue
	Changed    bool
}

// ConcreteEffect is an ordered state mutation against durable entity IDs.
type ConcreteEffect struct {
	ID               ID
	Position         int
	Operation        EffectOperation
	EntityIDs        []ID
	MechanicID       ID
	Value            *StateValue
	AdjustmentAmount *Decimal
	// Status is populated only by apply-status and is owned by this effect.
	Status *StatusSnapshot
	// StatusInstanceIDs names the exact active instance paired to each target
	// entity for remove-status. It is empty for every other operation.
	StatusInstanceIDs map[ID]ID
	// StatusInstances contains caller-assigned durable instances keyed by
	// target entity for apply-status. It is empty for every other operation.
	StatusInstances map[ID]ActiveStatus
}

// TransitionPlan is the mechanical boundary for facilitator-authored live
// rulings.
type TransitionPlan struct {
	Effects []ConcreteEffect
}

type TransitionResult struct {
	AppliedEffects   []AppliedEffect
	State            StateSnapshot
	ChangedRecordIDs []ID
}

// AppliedStatusCommand is the lifecycle receipt emitted by the pure runtime
// transition. SourceEffectID is the source apply-effect ID retained for
// internal snapshot lookup; every accepted command changes the lifecycle.
type AppliedStatusCommand struct {
	EffectID         ID
	EntityID         ID
	SourceEffectID   ID
	StatusInstanceID ID
	Operation        EffectOperation
	Changed          bool
}

type RuntimeSnapshot struct {
	State          StateSnapshot
	ActiveStatuses []ActiveStatus
}

type RuntimeTransitionResult struct {
	AppliedEffects        []AppliedEffect
	AppliedStatusCommands []AppliedStatusCommand
	State                 StateSnapshot
	ActiveStatuses        []ActiveStatus
	ChangedRecordIDs      []ID
}

// ExpressionTrace records the recursively evaluated value of an expression.
// Reference nodes name the mechanic whose effective value they consumed.
type ExpressionTrace struct {
	Operation  ExpressionOperation
	MechanicID ID
	Literal    *StateValue
	Operands   []ExpressionTrace
	Value      StateValue
}

type AppliedModifier struct {
	StatusInstanceID ID
	SourceEffectID   ID
	ModifierID       ID
	Priority         int
	Position         int
	Operation        ModifierOperation
	Operand          StateValue
	Before           StateValue
	After            StateValue
}

type EvaluatedMechanic struct {
	MechanicID    ID
	SourceKind    SourceKind
	InputPresence ValuePresence
	Intrinsic     StateValue
	Effective     StateValue
	Expression    *ExpressionTrace
	Modifiers     []AppliedModifier
}

type EvaluatedState struct {
	EntityID ID
	Revision int64
	Order    []ID
	Values   map[ID]EvaluatedMechanic
}

// MechanicGraph is the validated, deterministic dependency plan used by the
// evaluator. Definitions are copied when the graph is compiled.
type MechanicGraph struct {
	Order        []ID
	Dependencies map[ID][]ID
	definitions  map[ID]MechanicDefinition
	order        []ID
}

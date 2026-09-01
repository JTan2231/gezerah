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

// SourceKind identifies whether a mechanic can own a stored override or is
// derived from other mechanics. Derived expressions consume the effective
// values of their references.
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
	Literal    *MechanicValue
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
// Entity profile values deliberately remain outside the rules engine.
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
// expression and no stored override.
type MechanicDefinition struct {
	ID           ID
	WorldID      ID
	SourceKind   SourceKind
	ValueKind    ValueKind
	DefaultValue MechanicValue
	Expression   *Expression
	Minimum      *Decimal
	Maximum      *Decimal
	Step         *Decimal
	Mutable      bool
	Archived     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// InlineStatus is the mechanical portion of one inline apply-status Effect.
// Its ID is the source Effect ID. Active Status instances retain immutable
// modifier snapshots so evaluation never depends on mutable configuration.
type InlineStatus struct {
	ID        ID
	WorldID   ID
	Modifiers []StatusModifier
}

// StatusModifier is one deterministic literal transformation. Positions are
// complete and zero-based within one apply-status Effect. Priority orders modifiers
// across active instances; lower values execute first.
type StatusModifier struct {
	ID         ID
	Position   int
	Priority   int
	MechanicID ID
	Operation  ModifierOperation
	Value      MechanicValue
}

// StatusInstance is a durable consequence-owned status instance. The internal
// SourceEffectID is the immutable source apply-effect ID, never a global
// configuration resource. AppliedOrder provides deterministic layering.
type StatusInstance struct {
	ID             ID
	WorldID        ID
	EntityID       ID
	SourceEffectID ID
	AppliedOrder   int64
}

// MechanicValue is a scalar tagged union. Exactly one value pointer must be set
// according to Kind.
type MechanicValue struct {
	Kind    ValueKind
	Number  *Decimal
	Boolean *bool
}

type InputOverrideRecord struct {
	EntityID  ID
	Revision  int64
	Overrides map[ID]MechanicValue
}

type InputOverrideSnapshot struct {
	ByEntity map[ID]InputOverrideRecord
}

type ScalarApplication struct {
	EffectID   ID
	EntityID   ID
	MechanicID ID
	Before     MechanicValue
	After      MechanicValue
	Changed    bool
}

// ConcreteEffect is an ordered mechanical mutation against durable entity IDs.
type ConcreteEffect struct {
	ID               ID
	Position         int
	Operation        EffectOperation
	EntityIDs        []ID
	MechanicID       ID
	Value            *MechanicValue
	AdjustmentAmount *Decimal
	// InlineStatus is populated only by apply-status and is owned by this Effect.
	InlineStatus *InlineStatus
	// StatusInstanceIDs names the exact active instance paired to each target
	// entity for remove-status. It is empty for every other operation.
	StatusInstanceIDs map[ID]ID
	// StatusInstances contains caller-assigned durable instances keyed by
	// target entity for apply-status. It is empty for every other operation.
	StatusInstances map[ID]StatusInstance
}

// TransitionPlan is the mechanical boundary for facilitator-authored live
// Consequences.
type TransitionPlan struct {
	Effects []ConcreteEffect
}

// StatusApplication is the concrete per-target result of executing an
// apply-status or remove-status Effect. SourceEffectID is retained for
// Inline-status lookup; every accepted Application changes the Status-instance
// lifecycle.
type StatusApplication struct {
	EffectID         ID
	EntityID         ID
	SourceEffectID   ID
	StatusInstanceID ID
	Operation        EffectOperation
	Changed          bool
}

type RuntimeSnapshot struct {
	InputOverrides  InputOverrideSnapshot
	StatusInstances []StatusInstance
}

type RuntimeTransitionResult struct {
	ScalarApplications []ScalarApplication
	StatusApplications []StatusApplication
	InputOverrides     InputOverrideSnapshot
	StatusInstances    []StatusInstance
	ChangedEntityIDs   []ID
}

// ExpressionTrace records the recursively evaluated value of an expression.
// Reference nodes name the mechanic whose effective value they consumed.
type ExpressionTrace struct {
	Operation  ExpressionOperation
	MechanicID ID
	Literal    *MechanicValue
	Operands   []ExpressionTrace
	Value      MechanicValue
}

type AppliedModifier struct {
	StatusInstanceID ID
	SourceEffectID   ID
	ModifierID       ID
	Priority         int
	Position         int
	Operation        ModifierOperation
	Operand          MechanicValue
	Before           MechanicValue
	After            MechanicValue
}

type EvaluatedMechanic struct {
	MechanicID ID
	SourceKind SourceKind
	Presence   EvaluationPresence
	Intrinsic  MechanicValue
	Effective  MechanicValue
	Expression *ExpressionTrace
	Modifiers  []AppliedModifier
}

type EntityEvaluation struct {
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

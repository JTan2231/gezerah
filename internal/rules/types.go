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

type EffectOperation string

const (
	EffectSet          EffectOperation = "set"
	EffectAdjustNumber EffectOperation = "adjust-number"
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

// MechanicDefinition is a universal scalar mechanic in one world. Every
// mechanic has a valid default; stored state contains only values that differ
// from it.
type MechanicDefinition struct {
	ID           ID
	WorldID      ID
	ValueKind    ValueKind
	DefaultValue StateValue
	Minimum      *Decimal
	Maximum      *Decimal
	Step         *Decimal
	Mutable      bool
	Archived     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
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

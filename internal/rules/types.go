package rules

import "time"

// ID is a storage-neutral durable identifier. The application and store layers
// may use UUIDs, but the rules engine only requires a non-empty stable string.
type ID string

func (id ID) Valid() bool { return id != "" }

type ValueKind string

const (
	ValueText        ValueKind = "text"
	ValueChoice      ValueKind = "choice"
	ValueMeasurement ValueKind = "measurement"
	ValueNumber      ValueKind = "number"
	ValueBoolean     ValueKind = "boolean"
	ValueReference   ValueKind = "reference"
)

type Cardinality string

const (
	CardinalityOne  Cardinality = "one"
	CardinalityMany Cardinality = "many"
)

type MissingKind string

const (
	MissingUnknown MissingKind = "unknown"
	MissingDefault MissingKind = "default"
)

type PresentationControl string

const (
	ControlShortText       PresentationControl = "short-text"
	ControlLongText        PresentationControl = "long-text"
	ControlSelect          PresentationControl = "select"
	ControlMeasurement     PresentationControl = "measurement"
	ControlNumber          PresentationControl = "number"
	ControlCheckbox        PresentationControl = "checkbox"
	ControlReferencePicker PresentationControl = "reference-picker"
)

type ConditionStatus string

const (
	ConditionMet     ConditionStatus = "met"
	ConditionUnmet   ConditionStatus = "unmet"
	ConditionUnknown ConditionStatus = "unknown"
)

type ConditionQuantifier string

const (
	QuantifierSingle  ConditionQuantifier = "single"
	QuantifierAny     ConditionQuantifier = "any"
	QuantifierAll     ConditionQuantifier = "all"
	QuantifierAtLeast ConditionQuantifier = "at-least"
)

type ExpressionType string

const (
	ExpressionAll       ExpressionType = "all"
	ExpressionAny       ExpressionType = "any"
	ExpressionAtLeast   ExpressionType = "at-least"
	ExpressionCriterion ExpressionType = "criterion"
)

type PredicateKind string

const (
	PredicateNumber      PredicateKind = "number"
	PredicateNumberRange PredicateKind = "number-range"
	PredicateBoolean     PredicateKind = "boolean"
	PredicateChoice      PredicateKind = "choice"
	PredicateChoiceSet   PredicateKind = "choice-set"
)

type PredicateOperator string

const (
	OperatorEqual              PredicateOperator = "eq"
	OperatorGreaterThan        PredicateOperator = "gt"
	OperatorGreaterThanOrEqual PredicateOperator = "gte"
	OperatorLessThan           PredicateOperator = "lt"
	OperatorLessThanOrEqual    PredicateOperator = "lte"
	OperatorBetween            PredicateOperator = "between"
	OperatorIs                 PredicateOperator = "is"
	OperatorOneOf              PredicateOperator = "one-of"
)

type EffectOperation string

const (
	EffectSet          EffectOperation = "set"
	EffectClear        EffectOperation = "clear"
	EffectAdjustNumber EffectOperation = "adjust-number"
	EffectAddValue     EffectOperation = "add-value"
	EffectRemoveValue  EffectOperation = "remove-value"
)

type BindingSource string

const (
	BindingSupplied        BindingSource = "supplied"
	BindingProblemInstance BindingSource = "problem-instance"
)

type ResolutionType string

const (
	ResolutionAutomatic ResolutionType = "automatic"
	ResolutionCondition ResolutionType = "condition"
)

type OutcomeBranch string

const (
	OutcomeAutomatic OutcomeBranch = "automatic"
	OutcomeMet       OutcomeBranch = "met"
	OutcomeUnmet     OutcomeBranch = "unmet"
)

type ResolutionStatus string

const (
	ResolutionApplied     ResolutionStatus = "applied"
	ResolutionUnavailable ResolutionStatus = "unavailable"
	ResolutionIncomplete  ResolutionStatus = "incomplete"
)

type RuleSet struct {
	ID          ID
	Key         string
	Name        string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type OwnerSchema struct {
	ID          ID
	RuleSetID   ID
	Key         string
	Label       string
	Description string
	Archived    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Entity struct {
	ID             ID
	RuleSetID      ID
	Key            string
	DisplayName    string
	OwnerSchemaIDs []ID
	Archived       bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type ChoiceOption struct {
	ID       ID
	Key      string
	Label    string
	Position int
}

type MeasurementUnit struct {
	ID       ID
	Unit     string
	Position int
}

type StateVariableDefinition struct {
	ID          ID
	RuleSetID   ID
	Key         string
	Label       string
	Description string

	OwnerSchemaIDs []ID
	ValueKind      ValueKind
	Cardinality    Cardinality

	MissingKind           MissingKind
	DefaultValue          *StateValue
	OmitDefaultWhenStored bool

	ChoiceOptions    []ChoiceOption
	MeasurementUnits []MeasurementUnit

	NumberMinimum *Decimal
	NumberMaximum *Decimal
	NumberStep    *Decimal
	NumberUnit    string

	MeasurementMinimum *Decimal
	MeasurementMaximum *Decimal
	MeasurementStep    *Decimal

	ReferenceTargetOwnerSchemaIDs []ID

	PresentationGroup    string
	PresentationControl  PresentationControl
	PresentationHelpText string

	ConditionAddressable    bool
	AllowedEffectOperations []EffectOperation
	DisplayOrder            int
	Archived                bool
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type ConditionParameter struct {
	ID                     ID
	Key                    string
	Label                  string
	Cardinality            Cardinality
	RequiredOwnerSchemaIDs []ID
	Position               int
}

type Predicate struct {
	Kind            PredicateKind
	Operator        PredicateOperator
	NumberValue     *Decimal
	Minimum         *Decimal
	Maximum         *Decimal
	BooleanValue    *bool
	ChoiceOptionIDs []ID
}

type ConditionCriterion struct {
	ParameterID     ID
	Quantifier      ConditionQuantifier
	RequiredCount   int
	StateVariableID ID
	Predicate       Predicate
}

type ConditionExpression struct {
	ID            ID
	Type          ExpressionType
	Position      int
	RequiredCount int
	Children      []ConditionExpression
	Criterion     *ConditionCriterion
}

type ConditionSet struct {
	ID          ID
	RuleSetID   ID
	Key         string
	Name        string
	Description string
	Parameters  []ConditionParameter
	Root        ConditionExpression
	Archived    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type ProblemTargetDefinition struct {
	ID                     ID
	Key                    string
	Label                  string
	Description            string
	Cardinality            Cardinality
	MinimumBindings        int
	MaximumBindings        *int
	BindingSource          BindingSource
	RequiredOwnerSchemaIDs []ID
	Position               int
}

type ConditionInvocationArgument struct {
	ParameterID        ID
	TargetDefinitionID ID
}

type ConditionInvocation struct {
	ID             ID
	ConditionSetID ID
	Arguments      []ConditionInvocationArgument
}

type Effect struct {
	ID                 ID
	Position           int
	Operation          EffectOperation
	TargetDefinitionID ID
	StateVariableID    ID
	Operand            *StateValue
	AdjustmentAmount   *Decimal
}

type ConsequenceSet struct {
	ID      ID
	Effects []Effect
}

type ChoiceOutcome struct {
	ID           ID
	Branch       OutcomeBranch
	Label        string
	Consequences ConsequenceSet
}

type ChoiceResolution struct {
	Type       ResolutionType
	Invocation *ConditionInvocation
	Automatic  *ChoiceOutcome
	Met        *ChoiceOutcome
	Unmet      *ChoiceOutcome
}

type ChoiceDefinition struct {
	ID            ID
	Key           string
	Name          string
	Description   string
	Position      int
	AvailableWhen *ConditionInvocation
	Resolution    ChoiceResolution
}

type ProblemDefinition struct {
	ID                     ID
	RuleSetID              ID
	Key                    string
	Name                   string
	Description            string
	InstanceOwnerSchemaIDs []ID
	Targets                []ProblemTargetDefinition
	AvailableWhen          *ConditionInvocation
	Choices                []ChoiceDefinition
	Archived               bool
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// TargetBindings retains authored binding position for each target.
type TargetBindings map[ID][]ID

// ParameterBindings retains concrete entity order for each condition parameter.
type ParameterBindings map[ID][]ID

type ProblemInstance struct {
	ID                  ID
	RuleSetID           ID
	ProblemDefinitionID ID
	DisplayName         string
	BindingRevision     int64
	Bindings            TargetBindings
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type StateRecord struct {
	OwnerEntityID ID
	Revision      int64
	Values        map[ID]StateValue
	UpdatedAt     time.Time
}

type StateSnapshot struct {
	Records map[ID]StateRecord
}

type StateAddress struct {
	EntityID        ID
	StateVariableID ID
}

type ConditionEntityResult struct {
	EntityID ID
	Status   ConditionStatus
	Address  StateAddress
	Actual   *StateValue
}

type ConditionEvaluationNode struct {
	ExpressionID  ID
	Status        ConditionStatus
	Message       string
	ParameterID   ID
	EntityResults []ConditionEntityResult
	Children      []ConditionEvaluationNode
}

type ConditionEvaluation struct {
	ConditionSetID ID
	Status         ConditionStatus
	Root           ConditionEvaluationNode
	MissingValues  []StateAddress
}

type AppliedEffect struct {
	EffectID           ID
	TargetDefinitionID ID
	EntityID           ID
	StateVariableID    ID
	Before             *StateValue
	After              *StateValue
	Changed            bool
}

// ConcreteEffect is an ordered state mutation whose targets have already been
// resolved to durable entity IDs. TargetDefinitionID is optional provenance:
// configured problem resolution supplies it, while live adjudication does not
// need an abstract target definition.
type ConcreteEffect struct {
	ID                 ID
	Position           int
	Operation          EffectOperation
	TargetDefinitionID ID
	EntityIDs          []ID
	StateVariableID    ID
	Operand            *StateValue
	AdjustmentAmount   *Decimal
}

// TransitionPlan is the common mechanical boundary shared by configured
// problem outcomes and facilitator-authored live rulings.
type TransitionPlan struct {
	Effects []ConcreteEffect
}

type TransitionResult struct {
	AppliedEffects   []AppliedEffect
	State            StateSnapshot
	ChangedRecordIDs []ID
}

type ResolutionInput struct {
	Problem      ProblemDefinition
	Instance     ProblemInstance
	ChoiceID     ID
	OwnerSchemas map[ID]OwnerSchema
	Entities     map[ID]Entity
	Definitions  map[ID]StateVariableDefinition
	Conditions   map[ID]ConditionSet
	Bindings     TargetBindings
	Snapshot     StateSnapshot
}

type ResolutionResult struct {
	Status                  ResolutionStatus
	ProblemDefinitionID     ID
	ProblemInstanceID       ID
	ChoiceID                ID
	OutcomeID               ID
	BindingRevision         int64
	AvailabilityEvaluations []ConditionEvaluation
	ResolutionEvaluation    *ConditionEvaluation
	IncompleteEvaluations   []ConditionEvaluation
	AppliedEffects          []AppliedEffect
	State                   StateSnapshot
	ChangedRecordIDs        []ID
}

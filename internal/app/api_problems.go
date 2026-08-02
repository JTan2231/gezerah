package app

import (
	"encoding/json"
	"time"
)

type problemTargetDTO struct {
	ID                     string   `json:"id,omitempty"`
	Key                    string   `json:"key"`
	Label                  string   `json:"label"`
	Description            *string  `json:"description,omitempty"`
	Cardinality            string   `json:"cardinality"`
	MinimumBindings        int      `json:"minimum_bindings"`
	MaximumBindings        *int     `json:"maximum_bindings,omitempty"`
	BindingSource          string   `json:"binding_source"`
	RequiredOwnerSchemaIDs []string `json:"required_owner_schema_ids"`
}

type conditionInvocationArgumentDTO struct {
	ParameterID        string `json:"parameter_id"`
	TargetDefinitionID string `json:"target_definition_id"`
}

type conditionInvocationDTO struct {
	ID             string                           `json:"id,omitempty"`
	ConditionSetID string                           `json:"condition_set_id"`
	Arguments      []conditionInvocationArgumentDTO `json:"arguments"`
}

// stateEffectDTO represents the operation-tagged effect union. Mapping rejects
// operands that do not belong to the selected operation.
type stateEffectDTO struct {
	ID                 string         `json:"id,omitempty"`
	Type               string         `json:"type"`
	TargetDefinitionID string         `json:"target_definition_id"`
	StateVariableID    string         `json:"state_variable_id"`
	Value              *stateValueDTO `json:"value,omitempty"`
	Amount             *json.Number   `json:"amount,omitempty"`
}

type consequenceSetDTO struct {
	ID      string           `json:"id,omitempty"`
	Effects []stateEffectDTO `json:"effects"`
}

type choiceOutcomeDTO struct {
	ID           string            `json:"id,omitempty"`
	Label        string            `json:"label"`
	Consequences consequenceSetDTO `json:"consequences"`
}

type choiceResolutionDTO struct {
	Type       string                  `json:"type"`
	Outcome    *choiceOutcomeDTO       `json:"outcome,omitempty"`
	Invocation *conditionInvocationDTO `json:"invocation,omitempty"`
	Met        *choiceOutcomeDTO       `json:"met,omitempty"`
	Unmet      *choiceOutcomeDTO       `json:"unmet,omitempty"`
}

type problemChoiceDTO struct {
	ID            string                  `json:"id,omitempty"`
	Key           string                  `json:"key"`
	Name          string                  `json:"name"`
	Description   *string                 `json:"description,omitempty"`
	AvailableWhen *conditionInvocationDTO `json:"available_when,omitempty"`
	Resolution    choiceResolutionDTO     `json:"resolution"`
}

type problemDefinitionResponse struct {
	ID                     string                  `json:"id"`
	Key                    string                  `json:"key"`
	Name                   string                  `json:"name"`
	Description            *string                 `json:"description,omitempty"`
	InstanceOwnerSchemaIDs []string                `json:"instance_owner_schema_ids"`
	Targets                []problemTargetDTO      `json:"targets"`
	AvailableWhen          *conditionInvocationDTO `json:"available_when,omitempty"`
	Choices                []problemChoiceDTO      `json:"choices"`
	Archived               bool                    `json:"archived"`
	CreatedAt              time.Time               `json:"created_at"`
	UpdatedAt              time.Time               `json:"updated_at"`
}

type saveProblemDefinitionRequest struct {
	ID                     string                  `json:"id,omitempty"`
	Key                    string                  `json:"key"`
	Name                   string                  `json:"name"`
	Description            *string                 `json:"description,omitempty"`
	InstanceOwnerSchemaIDs []string                `json:"instance_owner_schema_ids"`
	Targets                []problemTargetDTO      `json:"targets"`
	AvailableWhen          *conditionInvocationDTO `json:"available_when,omitempty"`
	Choices                []problemChoiceDTO      `json:"choices"`
	Archived               bool                    `json:"archived"`
}

type duplicateProblemRequest struct {
	Key  *string `json:"key,omitempty"`
	Name *string `json:"name,omitempty"`
}

type problemTargetBindingDTO struct {
	TargetDefinitionID string   `json:"target_definition_id"`
	EntityIDs          []string `json:"entity_ids"`
}

type createProblemInstanceRequest struct {
	ID                  string                    `json:"id,omitempty"`
	ProblemDefinitionID string                    `json:"problem_definition_id"`
	Key                 *string                   `json:"key,omitempty"`
	DisplayName         string                    `json:"display_name"`
	Bindings            []problemTargetBindingDTO `json:"bindings"`
}

type replaceProblemBindingsRequest struct {
	ExpectedBindingRevision *int64                    `json:"expected_binding_revision"`
	Bindings                []problemTargetBindingDTO `json:"bindings"`
}

type problemInstanceResponse struct {
	ID                  string                    `json:"id"`
	ProblemDefinitionID string                    `json:"problem_definition_id"`
	Key                 *string                   `json:"key,omitempty"`
	DisplayName         string                    `json:"display_name"`
	BindingRevision     int64                     `json:"binding_revision"`
	Bindings            []problemTargetBindingDTO `json:"bindings"`
	StateRevision       int64                     `json:"state_revision"`
	CreatedAt           time.Time                 `json:"created_at"`
	UpdatedAt           time.Time                 `json:"updated_at"`
}

type resolveChoiceRequest struct {
	ExpectedBindingRevision *int64           `json:"expected_binding_revision,omitempty"`
	ExpectedStateRevisions  map[string]int64 `json:"expected_state_revisions,omitempty"`
}

type appliedEffectDTO struct {
	EffectID           string         `json:"effect_id"`
	TargetDefinitionID string         `json:"target_definition_id"`
	EntityID           string         `json:"entity_id"`
	StateVariableID    string         `json:"state_variable_id"`
	Before             *stateValueDTO `json:"before,omitempty"`
	After              *stateValueDTO `json:"after,omitempty"`
	Changed            bool           `json:"changed"`
}

type resolutionStateDTO struct {
	Records map[string]stateRecordResponse `json:"records"`
}

type choiceResolutionResultDTO struct {
	Status                  string                   `json:"status"`
	Preview                 bool                     `json:"preview,omitempty"`
	ProblemDefinitionID     string                   `json:"problem_definition_id"`
	ProblemInstanceID       string                   `json:"problem_instance_id"`
	ChoiceID                string                   `json:"choice_id"`
	OutcomeID               string                   `json:"outcome_id,omitempty"`
	BindingRevision         *int64                   `json:"binding_revision,omitempty"`
	AvailabilityEvaluations []conditionEvaluationDTO `json:"availability_evaluations"`
	ResolutionEvaluation    *conditionEvaluationDTO  `json:"resolution_evaluation,omitempty"`
	Evaluations             []conditionEvaluationDTO `json:"evaluations"`
	AppliedEffects          []appliedEffectDTO       `json:"applied_effects"`
	State                   *resolutionStateDTO      `json:"state,omitempty"`
}

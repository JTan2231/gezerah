package app

import (
	"encoding/json"
	"time"
)

type conditionParameterDTO struct {
	ID                     string   `json:"id,omitempty"`
	Key                    string   `json:"key"`
	Label                  string   `json:"label"`
	Cardinality            string   `json:"cardinality"`
	RequiredOwnerSchemaIDs []string `json:"required_owner_schema_ids"`
}

type predicateDTO struct {
	Kind     string          `json:"kind"`
	Operator string          `json:"operator"`
	Value    json.RawMessage `json:"value,omitempty"`
	Minimum  *json.Number    `json:"minimum,omitempty"`
	Maximum  *json.Number    `json:"maximum,omitempty"`
	Values   []string        `json:"values,omitempty"`
}

// conditionExpressionDTO is one transport struct for the expression tagged
// union. Validation rejects fields that do not belong to the selected Type.
type conditionExpressionDTO struct {
	ID              string                   `json:"id,omitempty"`
	Type            string                   `json:"type"`
	Count           *int                     `json:"count,omitempty"`
	Children        []conditionExpressionDTO `json:"children,omitempty"`
	ParameterID     string                   `json:"parameter_id,omitempty"`
	Quantifier      string                   `json:"quantifier,omitempty"`
	StateVariableID string                   `json:"state_variable_id,omitempty"`
	Predicate       *predicateDTO            `json:"predicate,omitempty"`
}

type conditionSetResponse struct {
	ID          string                  `json:"id"`
	Key         string                  `json:"key"`
	Name        string                  `json:"name"`
	Description *string                 `json:"description,omitempty"`
	Parameters  []conditionParameterDTO `json:"parameters"`
	Root        conditionExpressionDTO  `json:"root"`
	Archived    bool                    `json:"archived"`
	CreatedAt   time.Time               `json:"created_at"`
	UpdatedAt   time.Time               `json:"updated_at"`
}

type saveConditionSetRequest struct {
	ID          string                  `json:"id,omitempty"`
	Key         string                  `json:"key"`
	Name        string                  `json:"name"`
	Description *string                 `json:"description,omitempty"`
	Parameters  []conditionParameterDTO `json:"parameters"`
	Root        conditionExpressionDTO  `json:"root"`
	Archived    bool                    `json:"archived"`
}

type evaluateConditionRequest struct {
	Arguments []conditionEvaluationArgumentDTO `json:"arguments"`
}

type conditionEvaluationArgumentDTO struct {
	ParameterID string   `json:"parameter_id"`
	EntityIDs   []string `json:"entity_ids"`
}

type stateAddressDTO struct {
	EntityID        string `json:"entity_id"`
	StateVariableID string `json:"state_variable_id"`
}

type conditionEntityResultDTO struct {
	EntityID string          `json:"entity_id"`
	Status   string          `json:"status"`
	Address  stateAddressDTO `json:"address"`
	Actual   *stateValueDTO  `json:"actual,omitempty"`
}

type conditionEvaluationNodeDTO struct {
	ExpressionID  string                       `json:"expression_id"`
	Status        string                       `json:"status"`
	Message       string                       `json:"message"`
	ParameterID   *string                      `json:"parameter_id,omitempty"`
	EntityResults []conditionEntityResultDTO   `json:"entity_results,omitempty"`
	Children      []conditionEvaluationNodeDTO `json:"children,omitempty"`
}

type conditionEvaluationDTO struct {
	ConditionSetID string                     `json:"condition_set_id"`
	Status         string                     `json:"status"`
	Root           conditionEvaluationNodeDTO `json:"root"`
	MissingValues  []stateAddressDTO          `json:"missing_values"`
}

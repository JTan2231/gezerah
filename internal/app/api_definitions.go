package app

import (
	"encoding/json"
	"time"
)

type choiceOptionDTO struct {
	ID    string `json:"id,omitempty"`
	Key   string `json:"key"`
	Label string `json:"label"`
}

type measurementUnitDTO struct {
	ID   string `json:"id,omitempty"`
	Unit string `json:"unit"`
}

type valueSchemaDTO struct {
	Kind                 string               `json:"kind"`
	Options              []choiceOptionDTO    `json:"options,omitempty"`
	Units                []measurementUnitDTO `json:"units,omitempty"`
	Minimum              *json.Number         `json:"minimum,omitempty"`
	Maximum              *json.Number         `json:"maximum,omitempty"`
	Step                 *json.Number         `json:"step,omitempty"`
	Unit                 *string              `json:"unit,omitempty"`
	TargetOwnerSchemaIDs []string             `json:"target_owner_schema_ids,omitempty"`
}

func (schema valueSchemaDTO) MarshalJSON() ([]byte, error) {
	switch schema.Kind {
	case "text", "boolean":
		return json.Marshal(struct {
			Kind string `json:"kind"`
		}{Kind: schema.Kind})
	case "choice":
		return json.Marshal(struct {
			Kind    string            `json:"kind"`
			Options []choiceOptionDTO `json:"options"`
		}{Kind: schema.Kind, Options: schema.Options})
	case "measurement":
		return json.Marshal(struct {
			Kind    string               `json:"kind"`
			Units   []measurementUnitDTO `json:"units"`
			Minimum *json.Number         `json:"minimum,omitempty"`
			Maximum *json.Number         `json:"maximum,omitempty"`
			Step    *json.Number         `json:"step,omitempty"`
		}{schema.Kind, schema.Units, schema.Minimum, schema.Maximum, schema.Step})
	case "number":
		return json.Marshal(struct {
			Kind    string       `json:"kind"`
			Minimum *json.Number `json:"minimum,omitempty"`
			Maximum *json.Number `json:"maximum,omitempty"`
			Step    *json.Number `json:"step,omitempty"`
			Unit    *string      `json:"unit,omitempty"`
		}{schema.Kind, schema.Minimum, schema.Maximum, schema.Step, schema.Unit})
	case "reference":
		ids := schema.TargetOwnerSchemaIDs
		if ids == nil {
			ids = []string{}
		}
		return json.Marshal(struct {
			Kind                 string   `json:"kind"`
			TargetOwnerSchemaIDs []string `json:"target_owner_schema_ids"`
		}{Kind: schema.Kind, TargetOwnerSchemaIDs: ids})
	default:
		type plain valueSchemaDTO
		return json.Marshal(plain(schema))
	}
}

type missingValueDTO struct {
	Kind           string         `json:"kind"`
	Value          *stateValueDTO `json:"value,omitempty"`
	OmitWhenStored bool           `json:"omit_when_stored,omitempty"`
}

func (missing missingValueDTO) MarshalJSON() ([]byte, error) {
	switch missing.Kind {
	case "unknown":
		return json.Marshal(struct {
			Kind string `json:"kind"`
		}{Kind: missing.Kind})
	case "default":
		return json.Marshal(struct {
			Kind           string         `json:"kind"`
			Value          *stateValueDTO `json:"value"`
			OmitWhenStored bool           `json:"omit_when_stored"`
		}{Kind: missing.Kind, Value: missing.Value, OmitWhenStored: missing.OmitWhenStored})
	default:
		type plain missingValueDTO
		return json.Marshal(plain(missing))
	}
}

type presentationDTO struct {
	Group    *string `json:"group,omitempty"`
	Control  *string `json:"control,omitempty"`
	HelpText *string `json:"help_text,omitempty"`
}

type stateVariableResponse struct {
	ID                      string           `json:"id"`
	Key                     string           `json:"key"`
	Label                   string           `json:"label"`
	Description             *string          `json:"description,omitempty"`
	OwnerSchemaIDs          []string         `json:"owner_schema_ids"`
	Cardinality             string           `json:"cardinality"`
	ValueSchema             valueSchemaDTO   `json:"value_schema"`
	MissingValue            missingValueDTO  `json:"missing_value"`
	Presentation            *presentationDTO `json:"presentation,omitempty"`
	ConditionAddressable    bool             `json:"condition_addressable"`
	AllowedEffectOperations []string         `json:"allowed_effect_operations"`
	DisplayOrder            int              `json:"display_order"`
	Archived                bool             `json:"archived"`
	CreatedAt               time.Time        `json:"created_at"`
	UpdatedAt               time.Time        `json:"updated_at"`
}

type saveStateVariableRequest struct {
	ID                      string           `json:"id,omitempty"`
	Key                     string           `json:"key"`
	Label                   string           `json:"label"`
	Description             *string          `json:"description,omitempty"`
	OwnerSchemaIDs          []string         `json:"owner_schema_ids"`
	Cardinality             string           `json:"cardinality"`
	ValueSchema             valueSchemaDTO   `json:"value_schema"`
	MissingValue            missingValueDTO  `json:"missing_value"`
	Presentation            *presentationDTO `json:"presentation,omitempty"`
	ConditionAddressable    bool             `json:"condition_addressable"`
	AllowedEffectOperations []string         `json:"allowed_effect_operations"`
	DisplayOrder            int              `json:"display_order"`
	Archived                bool             `json:"archived"`
}

type stateRecordResponse struct {
	OwnerEntityID          string                   `json:"owner_entity_id"`
	Revision               int64                    `json:"revision"`
	Values                 map[string]stateValueDTO `json:"values"`
	DefaultedDefinitionIDs []string                 `json:"defaulted_definition_ids"`
	UnknownDefinitionIDs   []string                 `json:"unknown_definition_ids"`
	UpdatedAt              time.Time                `json:"updated_at"`
}

type replaceStateRequest struct {
	ExpectedRevision *int64                   `json:"expected_revision"`
	Values           map[string]stateValueDTO `json:"values"`
}

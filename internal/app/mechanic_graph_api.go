package app

import (
	"time"
)

// expressionDTO is a recursive, typed transport tree. References carry stable
// mechanic IDs; authored names remain presentation only.
type expressionDTO struct {
	Operation  string            `json:"operation"`
	MechanicID string            `json:"mechanic_id,omitempty"`
	Value      *mechanicValueDTO `json:"value,omitempty"`
	Operands   []expressionDTO   `json:"operands,omitempty"`
}

type statusModifierResponse struct {
	ID         string           `json:"id"`
	MechanicID string           `json:"mechanic_id"`
	Operation  string           `json:"operation"`
	Value      mechanicValueDTO `json:"value"`
	Priority   int              `json:"priority"`
	Position   int              `json:"position"`
}

type saveStatusModifierRequest struct {
	ID         string           `json:"id,omitempty"`
	MechanicID string           `json:"mechanic_id"`
	Operation  string           `json:"operation"`
	Value      mechanicValueDTO `json:"value"`
	Priority   int              `json:"priority"`
}

type inlineStatusDTO struct {
	Name        string                      `json:"name"`
	Description *string                     `json:"description,omitempty"`
	Modifiers   []saveStatusModifierRequest `json:"modifiers"`
}

type statusLifecycleEffectTargetDTO struct {
	EntityID         string `json:"entity_id"`
	StatusInstanceID string `json:"status_instance_id,omitempty"`
}

type statusInstanceResponse struct {
	ID                  string                   `json:"id"`
	Name                string                   `json:"name"`
	Description         *string                  `json:"description,omitempty"`
	SourceInteractionID string                   `json:"source_interaction_id,omitempty"`
	SourceResolutionID  string                   `json:"source_resolution_id,omitempty"`
	SourceEffectID      string                   `json:"source_effect_id"`
	AppliedOrder        int64                    `json:"applied_order"`
	AppliedAt           time.Time                `json:"applied_at"`
	Modifiers           []statusModifierResponse `json:"modifiers"`
}

type appliedModifierResponse struct {
	StatusInstanceID string           `json:"status_instance_id"`
	StatusName       string           `json:"status_name"`
	ModifierID       string           `json:"modifier_id"`
	Operation        string           `json:"operation"`
	Priority         int              `json:"priority"`
	Operand          mechanicValueDTO `json:"operand"`
	Before           mechanicValueDTO `json:"before"`
	After            mechanicValueDTO `json:"after"`
}

type evaluatedMechanicResponse struct {
	SourceKind string                    `json:"source_kind"`
	Presence   string                    `json:"presence"`
	Intrinsic  mechanicValueDTO          `json:"intrinsic"`
	Effective  mechanicValueDTO          `json:"effective"`
	Modifiers  []appliedModifierResponse `json:"modifiers"`
}

type effectiveChangeResponse struct {
	EntityID   string           `json:"entity_id"`
	MechanicID string           `json:"mechanic_id"`
	Before     mechanicValueDTO `json:"before"`
	After      mechanicValueDTO `json:"after"`
}
